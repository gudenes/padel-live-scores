// apps/ops/src/lib/fip-twin-finder.ts
//
// Finds a candidate FIP twin tournament for a target that has no fip_id.
// "Twin" = a separately-discovered FIP row that's actually the same event.
// Operators link them with one click. Logic ported from
// src/app/api/ops/tournament-fip-twin/route.ts and src/app/api/ops/link-fip-id/route.ts.

import { pgPool } from './db'

interface TournamentRow {
  id: string
  name: string
  slug: string | null
  fip_id: string | null
  starts_at: string | null
}

export interface FipTwinCandidate {
  id: string
  name: string
  slug: string | null
  fip_id: string | null
}

export interface FipTwinHit {
  candidate: FipTwinCandidate
  confidence: 'high' | 'medium' | 'low'
  matchedTokens: string[]
  reasons: string[]
}

const NOISE_TOKENS = new Set([
  'premier', 'padel', 'tour', 'open', 'championship', 'cup',
  'major', 'p1', 'p2', 'fip', 'finals', 'circuit',
])

function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[0-9]{4}/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !NOISE_TOKENS.has(t))
}

export async function findFipTwin(targetTournamentId: string): Promise<FipTwinHit | null> {
  const pool = pgPool()
  const targetRes = await pool.query<TournamentRow>(
    `select id, name, slug, fip_id, starts_at
       from public.tournaments where id = $1`,
    [targetTournamentId],
  )
  const target = targetRes.rows[0]
  if (!target) return null
  if (target.fip_id) return null // already linked

  const targetTokens = new Set(tokenize(target.name))
  if (targetTokens.size === 0) return null
  const targetYear = target.starts_at ? new Date(target.starts_at).getUTCFullYear() : null

  const candRes = await pool.query<TournamentRow>(
    `select id, name, slug, fip_id, starts_at
       from public.tournaments
      where id <> $1 and fip_id is not null`,
    [targetTournamentId],
  )

  let best: FipTwinHit | null = null
  for (const c of candRes.rows) {
    const candTokens = new Set(tokenize(c.name))
    const overlap: string[] = []
    for (const t of targetTokens) if (candTokens.has(t)) overlap.push(t)
    if (overlap.length === 0) continue
    if (overlap.length < targetTokens.size) continue // every target token must appear
    const candYear = c.starts_at ? new Date(c.starts_at).getUTCFullYear() : null
    if (targetYear !== null && candYear !== null && targetYear !== candYear) continue

    const reasons = [`tokens: ${overlap.join(', ')}`]
    if (targetYear) reasons.push(`same year: ${targetYear}`)
    // Confidence note: the subset rule above forces overlap.length to equal
    // targetTokens.size, so a "2-token match" already means every meaningful
    // token in the target name matched (e.g. "Platinum Albania" after noise
    // filtering). That's strong evidence of a twin — treat as `high`. Targets
    // that tokenize to just 1 meaningful token are weaker and stay `medium`.
    const confidence = overlap.length >= 2 ? 'high' : overlap.length === 1 ? 'medium' : 'low'

    const hit: FipTwinHit = {
      candidate: { id: c.id, name: c.name, slug: c.slug, fip_id: c.fip_id },
      confidence,
      matchedTokens: overlap,
      reasons,
    }
    if (!best || rank(confidence) > rank(best.confidence)) best = hit
  }
  return best
}

function rank(c: 'high' | 'medium' | 'low'): number {
  return c === 'high' ? 3 : c === 'medium' ? 2 : 1
}

export async function linkFipTwin(input: { targetTournamentId: string; sourceTournamentId: string }): Promise<void> {
  const pool = pgPool()
  const client = await pool.connect()
  try {
    await client.query('begin')
    const srcRes = await client.query<{ fip_id: string | null; slug: string | null }>(
      `select fip_id, slug from public.tournaments where id = $1 for update`,
      [input.sourceTournamentId],
    )
    const src = srcRes.rows[0]
    if (!src || !src.fip_id) {
      await client.query('rollback')
      throw new Error('source tournament has no fip_id to link')
    }
    await client.query(
      `update public.tournaments set fip_id = null, slug = null, updated_at = now() where id = $1`,
      [input.sourceTournamentId],
    )
    await client.query(
      `update public.tournaments set fip_id = $1, slug = $2, updated_at = now() where id = $3`,
      [src.fip_id, src.slug, input.targetTournamentId],
    )
    await client.query('commit')
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

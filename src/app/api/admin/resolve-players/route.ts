// src/app/api/admin/resolve-players/route.ts
// Player deduplication service.
//
// Finds duplicate player records and merges them.
// Matching strategy:
//   1. Exact: normalized name + country + category
//   2. Fuzzy: token overlap ≥ 0.6 + same category
//
// GET /api/admin/resolve-players           — dry-run: list duplicate candidates
// GET /api/admin/resolve-players?apply=true — merge duplicates and update FKs

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

// ── Name normalization ───────────────────────────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(name: string): Set<string> {
  return new Set(normalize(name).split(' ').filter(t => t.length > 1))
}

// Jaccard-like token overlap score
function tokenSimilarity(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let overlap = 0
  for (const t of ta) if (tb.has(t)) overlap++
  return overlap / Math.max(ta.size, tb.size)
}

// ── Scoring: pick the "best" record to keep ──────────────────────────────

interface Player {
  id: string
  external_id: string | null
  fip_id: string | null
  name: string
  country: string | null
  category: string | null
  ranking: number | null
  points: number | null
  avatar_url: string | null
  profile_url: string | null
  side: string | null
  height: number | null
  birthplace: string | null
  birthdate: string | null
  hand: string | null
  win_rate: number | null
  total_matches: number | null
  titles: number | null
  finals: number | null
  semifinals: number | null
  ranking_move: number | null
  race_ranking: number | null
  race_points: number | null
  race_move: number | null
  updated_at: string | null
}

function richness(p: Player): number {
  let score = 0
  if (p.ranking) score += 3
  if (p.avatar_url) score += 2
  if (p.country) score += 1
  if (p.side) score += 1
  if (p.height) score += 1
  if (p.birthdate) score += 1
  if (p.win_rate) score += 1
  if (p.total_matches) score += 1
  if (p.titles) score += 1
  if (p.profile_url) score += 1
  if (p.points) score += 1
  // Prefer padelapi external_id (numeric) over fip-* for match FK stability
  if (p.external_id && !p.external_id.startsWith('fip-')) score += 5
  return score
}

// ── Merge logic ──────────────────────────────────────────────────────────

function mergeFields(keep: Player, dupe: Player): Record<string, any> {
  const updates: Record<string, any> = {}

  // Fill nulls from duplicate
  const fields: (keyof Player)[] = [
    'country', 'avatar_url', 'profile_url', 'side', 'height',
    'birthplace', 'birthdate', 'hand', 'win_rate', 'total_matches',
    'titles', 'finals', 'semifinals', 'ranking', 'points',
    'ranking_move', 'race_ranking', 'race_points', 'race_move',
  ]
  for (const f of fields) {
    if (keep[f] == null && dupe[f] != null) {
      updates[f] = dupe[f]
    }
  }

  // Absorb fip_id if keep doesn't have one
  if (!keep.fip_id && dupe.fip_id) {
    updates.fip_id = dupe.fip_id
  }
  // Absorb external_id if keep has fip-* and dupe has numeric
  if (keep.external_id?.startsWith('fip-') && dupe.external_id && !dupe.external_id.startsWith('fip-')) {
    // Keep's external_id becomes fip_id, take dupe's as external_id
    if (!keep.fip_id) updates.fip_id = keep.external_id
    updates.external_id = dupe.external_id
  }

  return updates
}

// Match FK columns that reference players
const MATCH_FK_COLUMNS = [
  'pair1_player1_id',
  'pair1_player2_id',
  'pair2_player1_id',
  'pair2_player2_id',
] as const

async function applyMerge(keep: Player, dupe: Player): Promise<{ fksUpdated: number }> {
  let fksUpdated = 0

  // 1. Update match FKs from dupe → keep
  for (const col of MATCH_FK_COLUMNS) {
    const { data, error } = await supabase
      .from('matches')
      .update({ [col]: keep.id })
      .eq(col, dupe.id)
      .select('id')

    if (error) {
      console.error(`[resolve] FK update error ${col}:`, error.message)
    } else {
      fksUpdated += data?.length ?? 0
    }
  }

  // 2. Enrich keep with dupe's data
  const updates = mergeFields(keep, dupe)
  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString()
    const { error } = await supabase
      .from('players')
      .update(updates)
      .eq('id', keep.id)
    if (error) console.error(`[resolve] enrich error:`, error.message)
  }

  // 3. Delete duplicate
  const { error: delErr } = await supabase
    .from('players')
    .delete()
    .eq('id', dupe.id)
  if (delErr) console.error(`[resolve] delete error:`, delErr.message)

  return { fksUpdated }
}

// ── Main handler ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams
  const apply = params.get('apply') === 'true'
  const methodFilter = params.get('method') // 'exact', 'fuzzy', or null (both)

  // Fetch all players
  const { data: allPlayers, error } = await supabase
    .from('players')
    .select('id, external_id, fip_id, name, country, category, ranking, points, avatar_url, profile_url, side, height, birthplace, birthdate, hand, win_rate, total_matches, titles, finals, semifinals, ranking_move, race_ranking, race_points, race_move, updated_at')
    .order('name')

  if (error || !allPlayers) {
    return NextResponse.json({ error: 'Failed to fetch players' }, { status: 500 })
  }

  // Group by category
  const byCategory = new Map<string, Player[]>()
  for (const p of allPlayers as Player[]) {
    const cat = p.category ?? 'unknown'
    if (!byCategory.has(cat)) byCategory.set(cat, [])
    byCategory.get(cat)!.push(p)
  }

  const duplicates: Array<{
    keep: { id: string; name: string; external_id: string | null }
    dupe: { id: string; name: string; external_id: string | null }
    similarity: number
    method: 'exact' | 'fuzzy'
  }> = []

  const merged = new Set<string>()

  for (const [, players] of byCategory) {
    // Build normalized name index
    const byNorm = new Map<string, Player[]>()
    for (const p of players) {
      const n = normalize(p.name)
      if (!byNorm.has(n)) byNorm.set(n, [])
      byNorm.get(n)!.push(p)
    }

    // Phase 1: Exact name matches
    for (const [, group] of byNorm) {
      if (group.length < 2) continue
      // Sort by richness — best record first
      group.sort((a, b) => richness(b) - richness(a))
      const keep = group[0]
      for (let i = 1; i < group.length; i++) {
        if (merged.has(group[i].id)) continue
        duplicates.push({
          keep: { id: keep.id, name: keep.name, external_id: keep.external_id },
          dupe: { id: group[i].id, name: group[i].name, external_id: group[i].external_id },
          similarity: 1.0,
          method: 'exact',
        })
        merged.add(group[i].id)
      }
    }

    // Phase 2: Fuzzy matches (token overlap ≥ 0.6) — only for unmerged players
    const remaining = players.filter(p => !merged.has(p.id))
    for (let i = 0; i < remaining.length; i++) {
      for (let j = i + 1; j < remaining.length; j++) {
        if (merged.has(remaining[j].id)) continue
        const sim = tokenSimilarity(remaining[i].name, remaining[j].name)
        if (sim < 0.6) continue
        // Must share country if both have one
        if (remaining[i].country && remaining[j].country && remaining[i].country !== remaining[j].country) continue

        const a = remaining[i], b = remaining[j]
        const [keep, dupe] = richness(a) >= richness(b) ? [a, b] : [b, a]
        duplicates.push({
          keep: { id: keep.id, name: keep.name, external_id: keep.external_id },
          dupe: { id: dupe.id, name: dupe.name, external_id: dupe.external_id },
          similarity: Math.round(sim * 100) / 100,
          method: 'fuzzy',
        })
        merged.add(dupe.id)
      }
    }
  }

  // Filter by method if requested
  const filtered = methodFilter
    ? duplicates.filter(d => d.method === methodFilter)
    : duplicates

  // Apply merges if requested
  let totalFksUpdated = 0
  if (apply) {
    const playerById = new Map(allPlayers.map(p => [p.id, p as Player]))
    for (const d of filtered) {
      const keep = playerById.get(d.keep.id)
      const dupe = playerById.get(d.dupe.id)
      if (!keep || !dupe) continue
      const { fksUpdated } = await applyMerge(keep, dupe)
      totalFksUpdated += fksUpdated
    }
  }

  return NextResponse.json({
    ok: true,
    mode: apply ? 'applied' : 'dry-run',
    ...(methodFilter ? { methodFilter } : {}),
    totalPlayers: allPlayers.length,
    duplicatesFound: filtered.length,
    ...(apply ? { fksUpdated: totalFksUpdated } : {}),
    duplicates: filtered,
  })
}

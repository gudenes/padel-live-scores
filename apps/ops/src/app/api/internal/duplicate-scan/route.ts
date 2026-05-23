// apps/ops/src/app/api/internal/duplicate-scan/route.ts
// Scans the players table for potential duplicates.
// Two modes:
//   ?mode=rules (default) — fast rule-based scan
//   ?mode=ai — sends players to Claude grouped by country for full AI-driven dedup
// Auth: session cookie (isOperator)

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}

function nameTokens(name: string): { first: string; surname: string } {
  const parts = normalize(name).split(' ').filter(t => t.length > 1)
  if (parts.length === 0) return { first: '', surname: '' }
  if (parts.length === 1) return { first: parts[0], surname: '' }
  return { first: parts[0], surname: parts[parts.length - 1] }
}

interface PlayerRow {
  id: string
  name: string
  country: string | null
  ranking: number | null
  points: number | null
  category: string | null
  avatar_url: string | null
  fip_id: string | null
  external_id: string | null
}

interface DuplicateGroup {
  reasons: string[]
  players: PlayerRow[]
  aiVerified?: boolean
  mergeGuidance?: string // AI recommendation on which to keep and why
}

// ── Rule-based scan ─────────────────────────────────────────────

function findRuleBasedDuplicates(players: PlayerRow[]): DuplicateGroup[] {
  const seen = new Set<string>()
  const groups: DuplicateGroup[] = []

  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i]
      const b = players[j]
      const pairKey = [a.id, b.id].sort().join('|')
      if (seen.has(pairKey)) continue

      const tokA = nameTokens(a.name)
      const tokB = nameTokens(b.name)

      const sameFirstLetter = tokA.first && tokB.first && tokA.first[0] === tokB.first[0]
      if (!sameFirstLetter) continue
      const sameSurname = tokA.surname && tokB.surname && tokA.surname === tokB.surname
      if (!sameSurname) continue
      const sameCountry = a.country && b.country && a.country === b.country
      if (!sameCountry) continue

      const bothRanked = a.ranking !== null && b.ranking !== null
      if (bothRanked) {
        const rankDiff = Math.abs(a.ranking! - b.ranking!)
        if (rankDiff > 10) continue
        groups.push({ reasons: [`Same surname + country (rank diff: ${rankDiff})`], players: [a, b] })
      } else {
        groups.push({ reasons: ['Same surname + country'], players: [a, b] })
      }
      seen.add(pairKey)
    }
  }

  return groups
}

// ── AI-driven scan ──────────────────────────────────────────────

async function findAiDuplicates(players: PlayerRow[]): Promise<DuplicateGroup[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return [{ reasons: ['ERROR: ANTHROPIC_API_KEY not set'], players: [] }]
  }

  const anthropic = new Anthropic({ apiKey })

  // Group players by country for manageable batches
  const byCountry = new Map<string, PlayerRow[]>()
  for (const p of players) {
    const key = p.country ?? '_unknown'
    const list = byCountry.get(key) || []
    list.push(p)
    byCountry.set(key, list)
  }

  const allGroups: DuplicateGroup[] = []

  // Process each country group (skip if only 1 player)
  for (const [country, countryPlayers] of byCountry) {
    if (countryPlayers.length < 2) continue

    // Batch: send up to 150 players per Claude call
    const batchSize = 150
    for (let offset = 0; offset < countryPlayers.length; offset += batchSize) {
      const batch = countryPlayers.slice(offset, offset + batchSize)
      if (batch.length < 2) continue

      const playerList = batch.map((p, i) => (
        `${i + 1}. "${p.name}" | ID: ${p.id.slice(0, 8)} | Rank: ${p.ranking ?? '-'} | Pts: ${p.points ?? '-'} | Cat: ${p.category ?? '-'} | FIP: ${p.fip_id ?? '-'}`
      )).join('\n')

      console.log(`[Dup AI] Scanning ${batch.length} players from ${country}`)

      try {
        const message = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          system: `You are a padel player database deduplication expert. You will receive a list of players from the same country. Find ALL pairs that are likely the SAME real person appearing as duplicate entries.

Look for:
- Name variations: nicknames (Ale = Alejandro, Bela = Fernando Belasteguin), abbreviations (J. = Juan), initials
- Reversed name order: "Garcia Juan" vs "Juan Garcia"
- Middle names included/omitted: "Juan Pablo Garcia" vs "Juan Garcia"
- Accent/spelling variations: "González" vs "Gonzalez"
- Compound surnames: "De la Fuente" vs "Fuente"
- Same FIP ID = definitely same person
- Different categories (men vs women) = definitely different people, never flag these

For each duplicate pair, explain:
- WHY you think they're the same person
- WHICH record to KEEP (the one with more data: ranking, FIP ID, points) and why
- What fields to preserve from the record being deleted

Return ONLY valid JSON, no markdown:
{ "duplicates": [
  {
    "playerA_index": number,
    "playerB_index": number,
    "confidence": "high" | "medium" | "low",
    "reason": "brief explanation",
    "keep": "A" | "B",
    "mergeGuidance": "Keep B (has ranking #45 + FIP ID). Preserve name spelling from A."
  }
] }

If no duplicates found, return: { "duplicates": [] }`,
          messages: [{
            role: 'user',
            content: `Find duplicate players in this list (country: ${country}, ${batch.length} players):\n\n${playerList}`,
          }],
        })

        const raw = message.content[0].type === 'text' ? message.content[0].text : '{"duplicates":[]}'

        const parsed = JSON.parse(raw) as {
          duplicates: {
            playerA_index: number
            playerB_index: number
            confidence: string
            reason: string
            keep: 'A' | 'B'
            mergeGuidance: string
          }[]
        }

        for (const dup of parsed.duplicates) {
          const idxA = dup.playerA_index - 1
          const idxB = dup.playerB_index - 1
          if (idxA < 0 || idxA >= batch.length || idxB < 0 || idxB >= batch.length) continue

          // Order players so the recommended "keep" is first
          const keepFirst = dup.keep === 'A'
            ? [batch[idxA], batch[idxB]]
            : [batch[idxB], batch[idxA]]

          allGroups.push({
            reasons: [`AI (${dup.confidence}): ${dup.reason}`],
            players: keepFirst,
            aiVerified: true,
            mergeGuidance: dup.mergeGuidance,
          })
        }
      } catch (err) {
        console.error(`[Dup AI] Error processing ${country}:`, err)
      }
    }
  }

  return allGroups
}

// ── Main handler ────────────────────────────────────────────────

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()

  const url = new URL(request.url)
  const category = url.searchParams.get('category')
  const mode = url.searchParams.get('mode') || 'rules'

  let query = supabase
    .from('players')
    .select('id, name, country, ranking, points, category, avatar_url, fip_id, external_id')
    .order('ranking', { ascending: true, nullsFirst: false })
    .limit(5000)

  if (category === 'men' || category === 'women') {
    query = query.eq('category', category)
  }

  const { data: players, error } = await query
  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }
  if (!players || players.length === 0) {
    return Response.json({ groups: [], scanned: 0, mode })
  }

  const groups = mode === 'ai'
    ? await findAiDuplicates(players)
    : findRuleBasedDuplicates(players)

  // Sort by ranking
  groups.sort((a, b) => {
    const bestRankA = Math.min(...a.players.map(p => p.ranking ?? 99999))
    const bestRankB = Math.min(...b.players.map(p => p.ranking ?? 99999))
    return bestRankA - bestRankB
  })

  return Response.json({ groups, scanned: players.length, mode })
}

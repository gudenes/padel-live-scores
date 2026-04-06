// src/app/api/admin/dedup-players/route.ts
// Finds duplicate players and merges them into the canonical record.
// Canonical = the one with a numeric external_id (from padelapi.org) or the one with ranking data.
// Duplicates = name-generated external_ids (e.g., "m-di-nenno", "martín-di-nenno")
//
// Usage:
//   GET  /api/admin/dedup-players              → dry run, shows duplicates found
//   GET  /api/admin/dedup-players?run=true      → merge duplicates + reassign match FKs
//   GET  /api/admin/dedup-players?tournament=ID  → scope to one tournament's matches
//
// Auth: CRON_SECRET header

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

interface PlayerRow {
  id: string
  name: string
  external_id: string
  country: string | null
  category: string | null
  ranking: number | null
  points: number | null
  avatar_url: string | null
}

// Normalize a name for grouping: lowercase, strip accents, collapse whitespace
function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // strip punctuation
    .replace(/\s+/g, ' ')
    .trim()
}

// Score a player record — higher = more canonical
function canonicalScore(p: PlayerRow): number {
  let score = 0
  // Numeric external_id (from padelapi.org) = strongest signal
  if (/^\d+$/.test(p.external_id)) score += 100
  // Has ranking data
  if (p.ranking != null && p.ranking > 0) score += 50
  // Has points data
  if (p.points != null && p.points > 0) score += 20
  // Has avatar
  if (p.avatar_url) score += 10
  // Has category
  if (p.category) score += 5
  // Longer name = more complete (e.g., "Martin Di Nenno" > "M Di Nenno")
  score += Math.min(p.name.length, 30)
  return score
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const run = request.nextUrl.searchParams.get('run') === 'true'
  const tournamentFilter = request.nextUrl.searchParams.get('tournament')

  const supabase = createServerClient()

  // 1. Fetch all players
  const { data: allPlayers, error } = await supabase
    .from('players')
    .select('id, name, external_id, country, category, ranking, points, avatar_url')
    .order('ranking', { ascending: true, nullsFirst: false })

  if (error || !allPlayers) {
    return NextResponse.json({ error: 'Failed to fetch players', details: error }, { status: 500 })
  }

  // 2. Group by normalized name + category
  const groups: Record<string, PlayerRow[]> = {}
  for (const p of allPlayers) {
    const key = `${normalizeName(p.name)}|${p.category ?? 'unknown'}`
    if (!groups[key]) groups[key] = []
    groups[key].push(p)
  }

  // 3. Find groups with duplicates (2+ records)
  const duplicateGroups: {
    normalized: string
    category: string
    canonical: PlayerRow
    duplicates: PlayerRow[]
  }[] = []

  for (const [key, players] of Object.entries(groups)) {
    if (players.length < 2) continue
    const [normalized, category] = key.split('|')

    // Sort by canonical score descending — best record first
    players.sort((a, b) => canonicalScore(b) - canonicalScore(a))
    const canonical = players[0]
    const dupes = players.slice(1)

    duplicateGroups.push({
      normalized,
      category,
      canonical,
      duplicates: dupes,
    })
  }

  // 4. Also find near-duplicates by last name (for abbreviated first names)
  // e.g., "M Di Nenno" (category men) should match "Martin Di Nenno" (category men)
  const byLastNameCategory: Record<string, PlayerRow[]> = {}
  for (const p of allPlayers) {
    const parts = normalizeName(p.name).split(' ')
    if (parts.length < 2) continue
    const lastName = parts.slice(1).join(' ')
    if (lastName.length < 3) continue
    const key = `${lastName}|${p.category ?? 'unknown'}`
    if (!byLastNameCategory[key]) byLastNameCategory[key] = []
    byLastNameCategory[key].push(p)
  }

  for (const [key, players] of Object.entries(byLastNameCategory)) {
    if (players.length < 2) continue
    // Check if any of these are already in duplicateGroups (by exact name)
    const exactGroupKeys = new Set(duplicateGroups.flatMap(g => [g.canonical.id, ...g.duplicates.map(d => d.id)]))
    const unhandled = players.filter(p => !exactGroupKeys.has(p.id))
    if (unhandled.length < 2) {
      // Some might be handled already — check if we have one canonical + unhandled dupes
      const handled = players.filter(p => exactGroupKeys.has(p.id))
      if (handled.length > 0 && unhandled.length > 0) {
        // Find the canonical from the existing group
        const existingGroup = duplicateGroups.find(g =>
          g.canonical.id === handled[0].id || g.duplicates.some(d => d.id === handled[0].id)
        )
        if (existingGroup) {
          for (const u of unhandled) {
            if (!existingGroup.duplicates.some(d => d.id === u.id) && u.id !== existingGroup.canonical.id) {
              existingGroup.duplicates.push(u)
            }
          }
        }
      }
      continue
    }

    // New group of near-duplicates
    const [, category] = key.split('|')
    unhandled.sort((a, b) => canonicalScore(b) - canonicalScore(a))
    const canonical = unhandled[0]
    const dupes = unhandled.slice(1)

    // Only add if canonical is clearly better (numeric external_id or has ranking)
    if (canonicalScore(canonical) > canonicalScore(dupes[0]) + 10) {
      duplicateGroups.push({
        normalized: key.split('|')[0],
        category,
        canonical,
        duplicates: dupes,
      })
    }
  }

  if (!run) {
    // Dry run — show what would be merged
    return NextResponse.json({
      mode: 'dry-run',
      total_players: allPlayers.length,
      duplicate_groups: duplicateGroups.length,
      total_duplicates: duplicateGroups.reduce((s, g) => s + g.duplicates.length, 0),
      groups: duplicateGroups.map(g => ({
        canonical: { id: g.canonical.id, name: g.canonical.name, external_id: g.canonical.external_id, ranking: g.canonical.ranking, score: canonicalScore(g.canonical) },
        duplicates: g.duplicates.map(d => ({ id: d.id, name: d.name, external_id: d.external_id, ranking: d.ranking, score: canonicalScore(d) })),
      })),
    })
  }

  // 5. Merge duplicates
  let matchesUpdated = 0
  let drawsUpdated = 0
  let playersDeleted = 0

  for (const group of duplicateGroups) {
    const canonicalId = group.canonical.id
    const dupeIds = group.duplicates.map(d => d.id)

    for (const dupeId of dupeIds) {
      // Update matches — reassign all 4 player FK columns
      for (const col of ['pair1_player1_id', 'pair1_player2_id', 'pair2_player1_id', 'pair2_player2_id']) {
        let query = supabase
          .from('matches')
          .update({ [col]: canonicalId })
          .eq(col, dupeId)

        if (tournamentFilter) {
          query = query.eq('tournament_id', tournamentFilter)
        }

        const { data } = await query.select('id')
        matchesUpdated += data?.length ?? 0
      }

      // Update tournament_draws
      for (const col of ['player1_id', 'player2_id']) {
        const { data } = await supabase
          .from('tournament_draws')
          .update({ [col]: canonicalId })
          .eq(col, dupeId)
          .select('id')
        drawsUpdated += data?.length ?? 0
      }

      // Update user_bookmarks (player follows)
      await supabase
        .from('user_bookmarks')
        .update({ target_id: canonicalId })
        .eq('bookmark_type', 'player')
        .eq('target_id', dupeId)

      // Delete the duplicate player (only if not scoped to tournament)
      if (!tournamentFilter) {
        const { error: delError } = await supabase
          .from('players')
          .delete()
          .eq('id', dupeId)

        if (!delError) {
          playersDeleted++
          console.log(`[Dedup] Deleted duplicate: "${group.duplicates.find(d => d.id === dupeId)?.name}" (${dupeId}) → merged into "${group.canonical.name}" (${canonicalId})`)
        } else {
          console.warn(`[Dedup] Failed to delete ${dupeId}: ${delError.message}`)
        }
      }
    }
  }

  return NextResponse.json({
    mode: 'executed',
    duplicate_groups: duplicateGroups.length,
    matches_updated: matchesUpdated,
    draws_updated: drawsUpdated,
    players_deleted: playersDeleted,
    groups: duplicateGroups.map(g => ({
      canonical: { id: g.canonical.id, name: g.canonical.name, external_id: g.canonical.external_id },
      merged: g.duplicates.map(d => d.name),
    })),
  })
}

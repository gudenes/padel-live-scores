// src/app/api/admin/resolve-from-draws/route.ts
// Re-resolves match player IDs using tournament_draws data.
// For each match in a tournament, looks up player names against the draw
// entries and updates player FK columns with the correct pre-resolved IDs.
//
// Usage:
//   GET .../resolve-from-draws?tournament=UUID           → dry run
//   GET .../resolve-from-draws?tournament=UUID&run=true   → execute updates
//
// Auth: CRON_SECRET header

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

/**
 * Match a scraped/stored player name against a draw entry name.
 * Handles abbreviated first names: "M Di Nenno" vs "Martin Di Nenno"
 */
function nameMatch(matchName: string, drawName: string): boolean {
  if (!matchName || !drawName) return false

  const m = matchName.toLowerCase().trim()
  const d = drawName.toLowerCase().trim()

  // Exact match
  if (m === d) return true

  const mParts = m.split(/\s+/)
  const dParts = d.split(/\s+/)
  if (mParts.length < 2 || dParts.length < 2) return false

  // Compare last name tokens (everything after first word)
  const mLast = mParts.slice(1).join(' ')
  const dLast = dParts.slice(1).join(' ')

  if (mLast !== dLast) {
    // Try overlapping last name tokens
    const mLastTokens = new Set(mParts.slice(1))
    const dLastTokens = new Set(dParts.slice(1))
    const overlap = [...mLastTokens].filter(t => dLastTokens.has(t)).length
    const maxLen = Math.max(mLastTokens.size, dLastTokens.size)
    if (maxLen === 0 || overlap / maxLen < 0.8) return false
  }

  // Check first name match or abbreviation
  const mFirst = mParts[0].replace(/\./g, '')
  const dFirst = dParts[0].replace(/\./g, '')

  if (mFirst === dFirst) return true
  if (mFirst.length <= 2 && dFirst.startsWith(mFirst)) return true
  if (dFirst.length <= 2 && mFirst.startsWith(dFirst)) return true

  return false
}

/**
 * Try to find a player ID from draws by matching name, with last-name fallback.
 */
function findPlayerInDraws(
  playerName: string,
  draws: { player1_name: string; player1_id: string | null; player2_name: string; player2_id: string | null }[],
): string | null {
  if (!playerName) return null

  // 1. Try full name match (with abbreviation support)
  for (const d of draws) {
    if (d.player1_id && nameMatch(playerName, d.player1_name)) return d.player1_id
    if (d.player2_id && nameMatch(playerName, d.player2_name)) return d.player2_id
  }

  // 2. Try last-name-only match (but only if exactly one match found)
  const lastName = playerName.toLowerCase().trim().split(/\s+/).slice(1).join(' ')
  if (lastName && lastName.length > 2) {
    const matches: string[] = []
    for (const d of draws) {
      if (d.player1_id && d.player1_name.toLowerCase().includes(lastName)) {
        if (!matches.includes(d.player1_id)) matches.push(d.player1_id)
      }
      if (d.player2_id && d.player2_name.toLowerCase().includes(lastName)) {
        if (!matches.includes(d.player2_id)) matches.push(d.player2_id)
      }
    }
    // Only use last-name match if exactly ONE player found (avoids sibling confusion)
    if (matches.length === 1) return matches[0]
  }

  return null
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tournamentId = request.nextUrl.searchParams.get('tournament')
  if (!tournamentId) {
    return NextResponse.json({ error: 'tournament parameter required' }, { status: 400 })
  }

  const run = request.nextUrl.searchParams.get('run') === 'true'
  const supabase = createServerClient()

  // 1. Load draw entries for this tournament
  const { data: drawEntries, error: drawError } = await supabase
    .from('tournament_draws')
    .select('category, player1_name, player1_id, player2_name, player2_id')
    .eq('tournament_id', tournamentId)

  if (drawError || !drawEntries || drawEntries.length === 0) {
    return NextResponse.json({
      error: 'No draw data found for this tournament',
      details: drawError,
    }, { status: 404 })
  }

  const menDraws = drawEntries.filter(d => d.category === 'men')
  const womenDraws = drawEntries.filter(d => d.category === 'women')

  // 2. Load matches for this tournament with player names
  const { data: matches, error: matchError } = await supabase
    .from('matches')
    .select(`
      id, category,
      pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id,
      pair1_player1:players!matches_pair1_player1_id_fkey(id, name),
      pair1_player2:players!matches_pair1_player2_id_fkey(id, name),
      pair2_player1:players!matches_pair2_player1_id_fkey(id, name),
      pair2_player2:players!matches_pair2_player2_id_fkey(id, name)
    `)
    .eq('tournament_id', tournamentId)

  if (matchError || !matches) {
    return NextResponse.json({ error: 'Failed to load matches', details: matchError }, { status: 500 })
  }

  // 3. For each match, try to resolve players from draws
  const results: {
    matchId: string
    updates: { column: string; playerName: string; oldId: string | null; newId: string; drawName: string }[]
  }[] = []

  let totalUpdates = 0

  for (const match of matches) {
    const draws = (match as any).category === 'women' ? womenDraws : menDraws
    const updates: { column: string; playerName: string; oldId: string | null; newId: string; drawName: string }[] = []

    const playerSlots = [
      { column: 'pair1_player1_id', player: (match as any).pair1_player1, currentId: match.pair1_player1_id },
      { column: 'pair1_player2_id', player: (match as any).pair1_player2, currentId: match.pair1_player2_id },
      { column: 'pair2_player1_id', player: (match as any).pair2_player1, currentId: match.pair2_player1_id },
      { column: 'pair2_player2_id', player: (match as any).pair2_player2, currentId: match.pair2_player2_id },
    ]

    for (const slot of playerSlots) {
      const playerName = slot.player?.name
      if (!playerName) continue

      const drawId = findPlayerInDraws(playerName, draws)
      if (!drawId) continue

      // Only update if the draw ID is different from current
      if (drawId === slot.currentId) continue

      // Find which draw name matched for logging
      let drawName = ''
      for (const d of draws) {
        if (d.player1_id === drawId) { drawName = d.player1_name; break }
        if (d.player2_id === drawId) { drawName = d.player2_name; break }
      }

      updates.push({
        column: slot.column,
        playerName,
        oldId: slot.currentId,
        newId: drawId,
        drawName,
      })
    }

    if (updates.length > 0) {
      results.push({ matchId: match.id, updates })
      totalUpdates += updates.length

      if (run) {
        // Execute the updates
        const updateObj: Record<string, string> = {}
        for (const u of updates) {
          updateObj[u.column] = u.newId
        }
        await supabase
          .from('matches')
          .update(updateObj)
          .eq('id', match.id)
      }
    }
  }

  return NextResponse.json({
    mode: run ? 'executed' : 'dry-run',
    tournament: tournamentId,
    draw_entries: drawEntries.length,
    draw_men: menDraws.length,
    draw_women: womenDraws.length,
    matches_checked: matches.length,
    matches_with_updates: results.length,
    total_player_updates: totalUpdates,
    details: results,
  })
}

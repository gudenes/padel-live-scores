// src/app/api/cron/fip-scores/route.ts
// FIP Score Scraper — fetches match results from matchscorerlive.com for active FIP tournaments
// Schedule: every 2 hours (vercel.json)

import { createClient } from '@supabase/supabase-js'
import { PlayerResolver, tokenSimilarity } from '@/lib/player-resolver'
import { logOpsEvent } from '@/lib/ops-logger'
import { fetchDrawMatches, toIso2, type ParsedMatch } from '@/lib/fip-scraper'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// ── Round name normalization ──────────────────────────────────────
function normalizeRound(round: string): string {
  const r = round.toLowerCase().trim()
  if (r.includes('final') && !r.includes('quarter') && !r.includes('semi')) return 'F'
  if (r.includes('semi')) return 'SF'
  if (r.includes('quarter')) return 'QF'
  if (r.includes('16') || r.includes('r16')) return 'R16'
  if (r.includes('32') || r.includes('r32')) return 'R32'
  if (r.includes('64') || r.includes('r64')) return 'R64'
  return round
}

// ── Inline winner inference (best-of-3) ────────────────────────────
function inferWinner(sets: Array<{ team1Games: number; team2Games: number }>): 1 | 2 | null {
  let t1 = 0, t2 = 0
  for (const s of sets) {
    if (s.team1Games > s.team2Games) t1++
    else if (s.team2Games > s.team1Games) t2++
  }
  if (t1 >= 2) return 1
  if (t2 >= 2) return 2
  return null
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const result = await logOpsEvent('cron:fip-scores', async () => {
      console.log('[FIP Scores] Starting score sync...')

      const today = new Date().toISOString().slice(0, 10)
      const yesterday = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

      // Allow forcing a specific tournament via ?tournament_id=X (bypasses date window)
      const url = new URL(request.url)
      const forcedId = url.searchParams.get('tournament_id')

      let query = supabase
        .from('tournaments')
        .select('id, name, matchscorer_url, starts_at, ends_at, level')
        .eq('source', 'fip')
        .not('matchscorer_url', 'is', null)

      if (forcedId) {
        query = query.eq('id', forcedId)
      } else {
        query = query.lte('starts_at', today).gte('ends_at', yesterday)
      }

      const { data: tournaments } = await query

      if (!tournaments || tournaments.length === 0) {
        console.log('[FIP Scores] No active FIP tournaments')
        return { active_tournaments: 0, matches_upserted: 0, matches_skipped: 0 }
      }

      console.log(`[FIP Scores] ${tournaments.length} active tournament(s)`)

      const resolver = new PlayerResolver(supabase)
      await resolver.load()

      // Load draw data for active tournaments (for pre-resolved player IDs)
      const tournamentIds = tournaments.map(t => t.id)
      const { data: drawEntries } = await supabase
        .from('tournament_draws')
        .select('tournament_id, category, player1_name, player1_id, player2_name, player2_id')
        .in('tournament_id', tournamentIds)
      const draws = drawEntries ?? []

      let totalUpserted = 0
      let totalSkipped = 0
      let totalErrors = 0

      for (const tournament of tournaments) {
        try {
          console.log(`[FIP Scores] Processing: ${tournament.name} (${tournament.matchscorer_url})`)

          const matches = await fetchDrawMatches(tournament.matchscorer_url)
          const finished = matches.filter(m => m.status === 'finished').length
          const scheduled = matches.filter(m => m.status === 'scheduled').length
          const men = matches.filter(m => m.category === 'men').length
          const women = matches.filter(m => m.category === 'women').length
          console.log(`[FIP Scores] Found ${matches.length} matches for ${tournament.name} (${finished} finished, ${scheduled} scheduled, ${men} men, ${women} women)`)

          for (let i = 0; i < matches.length; i++) {
            const match = matches[i]
            try {
              const matchResult = await upsertFipMatch(match, tournament.id, resolver, i, draws)
              if (matchResult === 'upserted') totalUpserted++
              else totalSkipped++
            } catch (e) {
              console.error(`[FIP Scores] Failed to upsert match:`, e)
              totalErrors++
            }
          }
        } catch (e) {
          console.error(`[FIP Scores] Failed to process ${tournament.name}:`, e)
          totalErrors++
        }
      }

      console.log(`[FIP Scores] Done. Upserted: ${totalUpserted}, Skipped: ${totalSkipped}, Errors: ${totalErrors}`)

      return {
        active_tournaments: tournaments.length,
        matches_upserted: totalUpserted,
        matches_skipped: totalSkipped,
        errors: totalErrors,
      }
    })

    return Response.json({ ok: true, ...result })
  } catch (e) {
    console.error('[FIP Scores] Fatal error:', e)
    return Response.json({ error: String(e) }, { status: 500 })
  }
}

type DrawRow = {
  tournament_id: string
  category: string
  player1_name: string
  player1_id: string | null
  player2_name: string
  player2_id: string | null
}

async function upsertFipMatch(
  match: ParsedMatch,
  tournamentId: string,
  resolver: PlayerResolver,
  matchIndex: number,
  draws: DrawRow[],
): Promise<'upserted' | 'skipped'> {
  const externalId = buildMatchExternalId(tournamentId, match, matchIndex)

  const { data: existing } = await supabase
    .from('matches')
    .select('id, status, winner_pair, finished_at, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id')
    .eq('external_id', externalId)
    .single()

  // Skip only if fully complete: finished + has winner + has finished_at + all 4 players resolved
  const hasAllPlayers = existing?.pair1_player1_id && existing?.pair1_player2_id &&
    existing?.pair2_player1_id && existing?.pair2_player2_id
  if (existing?.status === 'finished' && existing.winner_pair !== null && existing.finished_at !== null && hasAllPlayers) {
    return 'skipped'
  }

  const [p1p1, p1p2, p2p1, p2p2] = await Promise.all([
    resolvePlayer(resolver, match.team1.player1, match.category, tournamentId, draws),
    resolvePlayer(resolver, match.team1.player2, match.category, tournamentId, draws),
    resolvePlayer(resolver, match.team2.player1, match.category, tournamentId, draws),
    resolvePlayer(resolver, match.team2.player2, match.category, tournamentId, draws),
  ])

  // Determine winner: from HTML first, then infer from sets
  let winnerPair = match.winnerTeam
  if (!winnerPair && match.sets.length >= 2) {
    winnerPair = inferWinner(match.sets)
  }

  const matchData: Record<string, unknown> = {
    external_id: externalId,
    tournament_id: tournamentId,
    status: match.status,
    category: match.category,
    round: normalizeRound(match.round),
    court: match.court,
    winner_pair: winnerPair,
    pair1_player1_id: p1p1,
    pair1_player2_id: p1p2,
    pair2_player1_id: p2p1,
    pair2_player2_id: p2p2,
    coverage: null,
    pusher_channel: null,
    updated_at: new Date().toISOString(),
  }

  if (match.status === 'finished') {
    // Set finished_at when transitioning to finished (new match or was scheduled)
    if (!existing || existing.status !== 'finished') {
      matchData.finished_at = new Date().toISOString()
    }
  }

  const { data: matchRow, error: matchError } = await supabase
    .from('matches')
    .upsert(matchData, { onConflict: 'external_id' })
    .select('id')
    .single()

  if (matchError || !matchRow) {
    throw new Error(`Failed to upsert match ${externalId}: ${matchError?.message}`)
  }

  for (const set of match.sets) {
    const setScore = `${set.team1Games}-${set.team2Games}`
    await supabase
      .from('sets')
      .upsert(
        {
          match_id: matchRow.id,
          set_number: set.setNumber,
          set_score: setScore,
          pair1_games: set.team1Games,
          pair2_games: set.team2Games,
          is_current: false,
          score_source: 'fip',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'match_id, set_number' }
      )
  }

  return 'upserted'
}

function buildMatchExternalId(tournamentId: string, match: ParsedMatch, matchIndex: number): string {
  const cat = match.category === 'men' ? 'm' : 'w'
  const round = normalizeRound(match.round).toLowerCase()
  // Use player names when available for stability across re-orders,
  // fall back to index when names are empty (BYE/TBD matches)
  const t1 = match.team1.player1.lastName.toLowerCase().replace(/[^a-z]/g, '').slice(0, 10)
  const t2 = match.team2.player1.lastName.toLowerCase().replace(/[^a-z]/g, '').slice(0, 10)
  if (t1 && t2) {
    return `fip-${tournamentId}-${cat}-${round}-${t1}-${t2}`
  }
  return `fip-${tournamentId}-${cat}-${round}-${matchIndex}`
}

/**
 * Match a scraped player name against a draw entry name.
 * Handles abbreviated first names: "M. Di Nenno" vs "Martin Di Nenno"
 * Returns true if the last name tokens match AND the first name matches or is an abbreviation.
 */
function drawNameMatch(scrapedName: string, drawName: string): boolean {
  const s = scrapedName.toLowerCase().trim()
  const d = drawName.toLowerCase().trim()

  // Exact token similarity (original check)
  if (tokenSimilarity(s, d) >= 0.7) return true

  // Abbreviated first name check:
  // Scraped: "M Di Nenno" or "M. Di Nenno"
  // Draw: "Martin Di Nenno"
  const sParts = s.split(/\s+/)
  const dParts = d.split(/\s+/)

  if (sParts.length < 2 || dParts.length < 2) return false

  // Compare last name tokens (everything after first word)
  const sLast = sParts.slice(1).join(' ')
  const dLast = dParts.slice(1).join(' ')

  if (sLast !== dLast) {
    // Try: last name is the same but in different positions
    // e.g., "Di Nenno" in both
    const sLastTokens = new Set(sParts.slice(1))
    const dLastTokens = new Set(dParts.slice(1))
    const overlap = [...sLastTokens].filter(t => dLastTokens.has(t)).length
    const maxLen = Math.max(sLastTokens.size, dLastTokens.size)
    if (maxLen === 0 || overlap / maxLen < 0.8) return false
  }

  // Check if first name is an abbreviation (1-2 chars, possibly with period)
  const sFirst = sParts[0].replace(/\./g, '')
  const dFirst = dParts[0].replace(/\./g, '')

  // Full match
  if (sFirst === dFirst) return true

  // Abbreviation: "m" matches "martin" (first letter)
  if (sFirst.length <= 2 && dFirst.startsWith(sFirst)) return true
  if (dFirst.length <= 2 && sFirst.startsWith(dFirst)) return true

  return false
}

async function resolvePlayer(
  resolver: PlayerResolver,
  player: { firstName: string; lastName: string; country: string | null; seed: number | null },
  category: 'men' | 'women',
  tournamentId: string,
  draws: DrawRow[],
): Promise<string | null> {
  const fullName = `${player.firstName} ${player.lastName}`.trim()
  if (!fullName || fullName === '-') return null

  // 1. Check draw table for pre-resolved player (with abbreviated name support)
  const tournamentDraws = draws.filter(d => d.tournament_id === tournamentId && d.category === category)
  for (const d of tournamentDraws) {
    if (d.player1_id && drawNameMatch(fullName, d.player1_name)) {
      console.log(`[FIP Scores] Draw match: "${fullName}" → "${d.player1_name}" (${d.player1_id})`)
      return d.player1_id
    }
    if (d.player2_id && drawNameMatch(fullName, d.player2_name)) {
      console.log(`[FIP Scores] Draw match: "${fullName}" → "${d.player2_name}" (${d.player2_id})`)
      return d.player2_id
    }
  }

  // 2. Also try matching by last name only against draws (even more permissive fallback)
  if (player.lastName && player.lastName.length > 2) {
    const lastName = player.lastName.toLowerCase()
    for (const d of tournamentDraws) {
      if (d.player1_id && d.player1_name.toLowerCase().includes(lastName)) {
        console.log(`[FIP Scores] Draw last-name match: "${fullName}" → "${d.player1_name}" (${d.player1_id})`)
        return d.player1_id
      }
      if (d.player2_id && d.player2_name.toLowerCase().includes(lastName)) {
        console.log(`[FIP Scores] Draw last-name match: "${fullName}" → "${d.player2_name}" (${d.player2_id})`)
        return d.player2_id
      }
    }
  }

  // 3. Fall back to PlayerResolver (only if draw lookup failed)
  try {
    const { playerId } = await resolver.resolve({
      name: fullName,
      country: toIso2(player.country),
      category,
    })
    return playerId
  } catch (e) {
    console.error(`[FIP Scores] Failed to resolve player ${fullName}:`, e)
    return null
  }
}

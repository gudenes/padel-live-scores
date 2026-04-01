// src/app/api/cron/fip-scores/route.ts
// FIP Score Scraper — fetches match results from matchscorerlive.com for active FIP tournaments
// Schedule: every 2 hours (vercel.json)

import { createClient } from '@supabase/supabase-js'
import { PlayerResolver } from '@/lib/player-resolver'
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

      const { data: tournaments } = await supabase
        .from('tournaments')
        .select('id, name, matchscorer_url, starts_at, ends_at, level')
        .eq('source', 'fip')
        .not('matchscorer_url', 'is', null)
        .lte('starts_at', today)
        .gte('ends_at', yesterday)

      if (!tournaments || tournaments.length === 0) {
        console.log('[FIP Scores] No active FIP tournaments')
        return { active_tournaments: 0, matches_upserted: 0, matches_skipped: 0 }
      }

      console.log(`[FIP Scores] ${tournaments.length} active tournament(s)`)

      const resolver = new PlayerResolver(supabase)
      await resolver.load()

      let totalUpserted = 0
      let totalSkipped = 0
      let totalErrors = 0

      for (const tournament of tournaments) {
        try {
          console.log(`[FIP Scores] Processing: ${tournament.name} (${tournament.matchscorer_url})`)

          const matches = await fetchDrawMatches(tournament.matchscorer_url)
          console.log(`[FIP Scores] Found ${matches.length} matches for ${tournament.name}`)

          for (const match of matches) {
            try {
              const matchResult = await upsertFipMatch(match, tournament.id, resolver)
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

async function upsertFipMatch(
  match: ParsedMatch,
  tournamentId: string,
  resolver: PlayerResolver,
): Promise<'upserted' | 'skipped'> {
  const externalId = buildMatchExternalId(tournamentId, match)

  const { data: existing } = await supabase
    .from('matches')
    .select('id, status, winner_pair')
    .eq('external_id', externalId)
    .single()

  if (existing?.status === 'finished' && existing.winner_pair !== null) {
    return 'skipped'
  }

  const [p1p1, p1p2, p2p1, p2p2] = await Promise.all([
    resolvePlayer(resolver, match.team1.player1, match.category),
    resolvePlayer(resolver, match.team1.player2, match.category),
    resolvePlayer(resolver, match.team2.player1, match.category),
    resolvePlayer(resolver, match.team2.player2, match.category),
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

  if (match.status === 'finished' && !existing) {
    matchData.finished_at = new Date().toISOString()
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

function buildMatchExternalId(tournamentId: string, match: ParsedMatch): string {
  const cat = match.category === 'men' ? 'm' : 'w'
  const round = normalizeRound(match.round).toLowerCase()
  const t1 = match.team1.player1.lastName.toLowerCase().replace(/[^a-z]/g, '').slice(0, 10)
  const t2 = match.team2.player1.lastName.toLowerCase().replace(/[^a-z]/g, '').slice(0, 10)
  return `fip-${tournamentId}-${cat}-${round}-${t1}-${t2}`
}

async function resolvePlayer(
  resolver: PlayerResolver,
  player: { firstName: string; lastName: string; country: string | null; seed: number | null },
  category: 'men' | 'women',
): Promise<string | null> {
  const fullName = `${player.firstName} ${player.lastName}`.trim()
  if (!fullName || fullName === '-') return null

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

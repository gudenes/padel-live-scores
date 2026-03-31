// src/app/api/admin/resync/route.ts
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)
const PADELAPI = 'https://padelapi.org/api'
function apiHeaders() {
  return { Authorization: `Bearer ${process.env.PADELAPI_TOKEN}`, 'Content-Type': 'application/json' }
}
async function fetchMatchDetail(id: number) {
  const r = await fetch(`${PADELAPI}/matches/${id}`, { headers: apiHeaders() })
  return r.ok ? r.json() : null
}
async function fetchLiveDetail(id: number) {
  const r = await fetch(`${PADELAPI}/matches/${id}/live`, { headers: apiHeaders() })
  return r.ok ? r.json() : null
}
async function fetchPlayerDetail(id: number) {
  const r = await fetch(`${PADELAPI}/players/${id}`, { headers: apiHeaders() })
  return r.ok ? r.json() : null
}
async function fetchPlayerStats(id: number) {
  const r = await fetch(`${PADELAPI}/players/${id}/stats`, { headers: apiHeaders() })
  return r.ok ? r.json() : null
}

function gamesFromScore(setScore: string): { p1: number; p2: number } | null {
  if (!setScore) return null
  const parts = setScore.split('-')
  if (parts.length !== 2) return null
  return { p1: parseInt(parts[0]) || 0, p2: parseInt((parts[1].match(/^\d+/) ?? ['0'])[0]) || 0 }
}

async function resyncMatch(dbMatch: any): Promise<{ status: string; external_id: string; changes: string[] }> {
  const externalId = dbMatch.external_id
  const changes: string[] = []
  try {
    const [matchDetail, liveDetail] = await Promise.all([
      fetchMatchDetail(parseInt(externalId)),
      fetchLiveDetail(parseInt(externalId)),
    ])
    if (!matchDetail) return { status: 'skipped', external_id: externalId, changes: ['no API data'] }

    const statusMap: Record<string, string> = { finished: 'finished', scheduled: 'scheduled', live: 'live', retired: 'finished' }
    const newStatus = statusMap[matchDetail.status] ?? matchDetail.status
    const winnerPair = matchDetail.winner === 'team_1' ? 1 : matchDetail.winner === 'team_2' ? 2 : null

    // Refresh players
    for (const p of [...(matchDetail.players?.team_1 ?? []), ...(matchDetail.players?.team_2 ?? [])]) {
      const [detail, stats] = await Promise.all([fetchPlayerDetail(p.id), fetchPlayerStats(p.id)])
      if (detail || stats) {
        await supabase.from('players').update({
          country: detail?.nationality ?? undefined,
          ranking: detail?.ranking ? parseInt(detail.ranking) : undefined,
          // Don't overwrite avatar_url — we host avatars on Supabase Storage
          win_rate: stats?.win_percentage ? Math.round(parseFloat(stats.win_percentage)) : undefined,
          total_matches: stats?.matches_played ?? undefined,
        }).eq('external_id', String(p.id))
      }
    }
    changes.push('players refreshed')

    // Update match
    await supabase.from('matches').update({
      status: newStatus, winner_pair: winnerPair, duration: matchDetail.duration ?? null,
      court: matchDetail.court ?? null, court_order: matchDetail.court_order ?? null,
      started_at: matchDetail.started_time ?? null, schedule_label: matchDetail.schedule_label ?? null,
      scheduled_at: matchDetail.played_at ?? null,
    }).eq('external_id', externalId)
    changes.push(`status=${newStatus}, winner=${winnerPair}`)

    const { data: matchRow } = await supabase.from('matches').select('id').eq('external_id', externalId).single()
    if (!matchRow) return { status: 'error', external_id: externalId, changes: ['not found in DB'] }
    const matchDbId = matchRow.id

    const liveSets = liveDetail?.sets ?? []

    if (liveSets.length > 0) {
      // For finished matches: only process sets with scores
      const validSets = newStatus === 'finished'
        ? liveSets.filter((s: any) => s.set_score !== null)
        : liveSets

      const maxSetNumber = validSets.length > 0 ? Math.max(...validSets.map((s: any) => s.set_number)) : 0

      for (const set of validSets) {
        const isCurrentSet = set.set_score === null && set.set_number === maxSetNumber && newStatus === 'live'
        const pg = set.set_score ? gamesFromScore(set.set_score) : null

        const { data: setRow } = await supabase.from('sets').upsert({
          match_id: matchDbId, set_number: set.set_number, set_score: set.set_score,
          is_current: isCurrentSet,
          ...(pg ? { pair1_games: pg.p1, pair2_games: pg.p2 } : {}),
        }, { onConflict: 'match_id, set_number' }).select('id').single()
        if (!setRow) continue

        // If no set_score, compute pair_games from last game_score
        if (!pg) {
          const games = set.games ?? []
          const lastGame = games.filter((g: any) => g.game_score && g.game_score !== '0-0')
            .sort((a: any, b: any) => a.game_number - b.game_number).at(-1)
          if (lastGame?.game_score) {
            const [p1, p2] = lastGame.game_score.split('-').map(Number)
            await supabase.from('sets').update({ pair1_games: p1 ?? 0, pair2_games: p2 ?? 0 }).eq('id', setRow.id)
          }
        }

        // Upsert games — merge points: keep the longer array
        const games = set.games ?? []
        const maxGame = games.length > 0 ? Math.max(...games.map((g: any) => g.game_number)) : 0
        for (const game of games) {
          const newPoints = (game.points ?? []).filter((p: string) => p !== '0:0')

          // Check if existing game has more points — if so, keep them
          const { data: existingGame } = await supabase.from('games')
            .select('points')
            .eq('set_id', setRow.id)
            .eq('game_number', game.game_number)
            .maybeSingle()
          const existingPoints = (existingGame?.points as string[]) ?? []
          const mergedPoints = existingPoints.length > newPoints.length ? existingPoints : newPoints

          await supabase.from('games').upsert({
            set_id: setRow.id, match_id: matchDbId, game_number: game.game_number,
            game_score: game.game_score, points: mergedPoints,
            is_current: isCurrentSet && game.game_number === maxGame,
          }, { onConflict: 'set_id, game_number' })
        }
      }

      // Clean up orphan null sets for finished matches
      if (newStatus === 'finished') {
        await supabase.from('sets').delete().eq('match_id', matchDbId).is('set_score', null)
      }

      const orphans = liveSets.length - validSets.length
      changes.push(`${validSets.length} sets resynced (merge)${orphans > 0 ? `, ${orphans} orphan null set(s) removed` : ''}`)

    } else if (matchDetail.score?.length > 0) {
      await supabase.from('sets').delete().eq('match_id', matchDbId)
      for (let i = 0; i < matchDetail.score.length; i++) {
        const s = matchDetail.score[i]
        const setScore = `${s.team_1}-${s.team_2}`
        const pg = gamesFromScore(setScore)
        await supabase.from('sets').upsert({
          match_id: matchDbId, set_number: i + 1, set_score: setScore, is_current: false,
          pair1_games: pg?.p1 ?? 0, pair2_games: pg?.p2 ?? 0,
        }, { onConflict: 'match_id, set_number', ignoreDuplicates: false })
      }
      changes.push(`${matchDetail.score.length} sets from score array`)
    }

    return { status: 'ok', external_id: externalId, changes }
  } catch (err: any) {
    return { status: 'error', external_id: externalId, changes: [err.message ?? String(err)] }
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const hours = parseInt(url.searchParams.get('hours') ?? '24')
  const tournamentFilter = url.searchParams.get('tournament')
  const matchFilter = url.searchParams.get('match')

  try {
    let query = supabase.from('matches').select('id, external_id, status, updated_at')
    if (matchFilter) {
      query = query.eq('external_id', matchFilter)
    } else if (tournamentFilter) {
      const { data: t } = await supabase.from('tournaments').select('id').eq('external_id', tournamentFilter).single()
      if (!t) return Response.json({ error: `Tournament ${tournamentFilter} not found` }, { status: 404 })
      query = query.eq('tournament_id', t.id)
    } else {
      query = query.gte('updated_at', new Date(Date.now() - hours * 60 * 60 * 1000).toISOString())
    }

    const { data: matches, error } = await query
    if (error || !matches) return Response.json({ error: 'Failed to fetch matches' }, { status: 500 })

    console.log(`[resync] Processing ${matches.length} matches...`)
    const results = []
    let ok = 0, skipped = 0, errors = 0
    for (const match of matches) {
      const result = await resyncMatch(match)
      results.push(result)
      if (result.status === 'ok') ok++
      else if (result.status === 'skipped') skipped++
      else errors++
      await new Promise(r => setTimeout(r, 300))
    }

    return Response.json({ total: matches.length, ok, skipped, errors, results })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

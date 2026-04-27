/**
 * One-shot tournament analysis dump for social-content writers.
 *
 *   npx tsx scripts/analyze-tournament.ts <tournamentId>
 *
 * Outputs JSON with non-obvious narratives operators can pitch to IG/TikTok
 * once "X won" is already saturated everywhere else. Things this surfaces:
 *
 *   - biggest upsets (winner ranked lower than loser at match time)
 *   - biggest comebacks (won match after losing first set)
 *   - longest + shortest matches (by duration_minutes)
 *   - closest matches (deciders that went to a tiebreak)
 *   - bagel + breadstick scorelines
 *   - by-round duration averages
 *   - per-player run summaries
 *   - tournament totals (matches, hours, sets, etc.)
 *
 * Reads from prod Supabase via .env.local SUPABASE_SERVICE_KEY (same
 * client every other admin script in this repo uses).
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Lightweight .env.local loader (we don't import next/env in scripts).
function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"(.*)"$/, '$1')
    }
  } catch { /* fine — env may already be set */ }
}
loadEnv()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const tournamentId = process.argv[2]
if (!tournamentId) {
  console.error('Usage: npx tsx scripts/analyze-tournament.ts <tournamentId>')
  process.exit(1)
}

const FINISHED = new Set(['finished', 'retired', 'walkover'])

interface PlayerRow {
  id: string
  name: string
  display_name: string | null
  ranking: number | null
  country: string | null
}

interface MatchRow {
  id: string
  round: string | null
  category: string | null
  status: string
  winner_pair: number | null
  scheduled_at: string | null
  finished_at: string | null
  started_at: string | null
  /** Authoritative match duration from the upstream feed in HH:MM
   *  format (e.g. "01:37"). Always prefer this over (finished_at -
   *  started_at) which includes suspensions and court-change delays. */
  duration: string | null
  court: string | null
  pair1_player1: PlayerRow | null
  pair1_player2: PlayerRow | null
  pair2_player1: PlayerRow | null
  pair2_player2: PlayerRow | null
}

/** Parse "HH:MM" → minutes. Returns null on malformed input. */
function parseHhMm(s: string | null): number | null {
  if (!s) return null
  const m = s.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = parseInt(m[1]!, 10)
  const min = parseInt(m[2]!, 10)
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null
  return h * 60 + min
}

interface SetRow {
  match_id: string
  set_number: number
  set_score: string | null
  pair1_games: number | null
  pair2_games: number | null
}

/**
 * Render the score string from numeric pair1_games / pair2_games values
 * in WINNER-first orientation. The text `set_score` field stored with each
 * set is unreliable across data sources (padelapi vs FIP vs Premier each
 * use different conventions for which team appears first), so always
 * recompute from the numbers.
 *
 * Returns e.g. "7-5 6-2" when winner_pair=1 won 7-5 and 6-2, regardless
 * of which side was pair1 or pair2.
 */
function buildScoreStringFromGames(
  sets: SetRow[],
  winnerPair: number,
): string {
  const parts: string[] = []
  for (const s of sets) {
    if (s.pair1_games == null || s.pair2_games == null) continue
    const winnerGames = winnerPair === 1 ? s.pair1_games : s.pair2_games
    const loserGames = winnerPair === 1 ? s.pair2_games : s.pair1_games
    parts.push(`${winnerGames}-${loserGames}`)
  }
  return parts.join(' ')
}

function shortName(p: PlayerRow | null): string {
  if (!p) return '?'
  const full = (p.display_name?.trim() || p.name || '').trim()
  const last = full.split(/\s+/).slice(-1)[0]
  return last || full || '?'
}

function pairLabel(p1: PlayerRow | null, p2: PlayerRow | null): string {
  return `${shortName(p1)}/${shortName(p2)}`
}

function pairAvgRanking(p1: PlayerRow | null, p2: PlayerRow | null): number | null {
  const ranks = [p1?.ranking, p2?.ranking].filter((r): r is number => typeof r === 'number')
  if (ranks.length === 0) return null
  return ranks.reduce((a, b) => a + b, 0) / ranks.length
}

function readableRound(r: string | null): string {
  if (!r) return '?'
  const t = r.trim()
  if (/^f$|^final$|^finals$/i.test(t)) return 'F'
  if (/^sf$|semi/i.test(t)) return 'SF'
  if (/^qf$|quarter/i.test(t)) return 'QF'
  if (/round of 16|^r16$/i.test(t)) return 'R16'
  if (/round of 32|^r32$/i.test(t)) return 'R32'
  if (/round of 64|^r64$/i.test(t)) return 'R64'
  return t
}

async function main() {
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, name, level, country, location, starts_at, ends_at, prize_money, prize_money_fip, draw_size_md')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!tournament) {
    console.error('Tournament not found')
    process.exit(2)
  }

  // Pull every match with winners + players' rankings as snapshot of "now".
  // This is good enough for narrative: "Coello (#1) lost to Stupaczuk (#5)"
  // is meaningful even if the gap was tighter at match time.
  const { data: matches, error } = await supabase
    .from('matches')
    .select(`
      id, round, category, status, winner_pair, scheduled_at, finished_at,
      started_at, duration, court,
      pair1_player1:players!matches_pair1_player1_id_fkey(id, name, display_name, ranking, country),
      pair1_player2:players!matches_pair1_player2_id_fkey(id, name, display_name, ranking, country),
      pair2_player1:players!matches_pair2_player1_id_fkey(id, name, display_name, ranking, country),
      pair2_player2:players!matches_pair2_player2_id_fkey(id, name, display_name, ranking, country)
    `)
    .eq('tournament_id', tournamentId)
    .order('scheduled_at', { ascending: true })

  if (error) {
    console.error(`matches read failed: ${error.message}`)
    process.exit(3)
  }

  const ms = (matches ?? []) as unknown as MatchRow[]

  const { data: setsData } = await supabase
    .from('sets')
    .select('match_id, set_number, set_score, pair1_games, pair2_games')
    .in('match_id', ms.map(m => m.id))
    .order('match_id', { ascending: true })

  const setsByMatch = new Map<string, SetRow[]>()
  for (const s of (setsData ?? []) as unknown as SetRow[]) {
    if (!setsByMatch.has(s.match_id)) setsByMatch.set(s.match_id, [])
    setsByMatch.get(s.match_id)!.push(s)
  }
  for (const list of setsByMatch.values()) list.sort((a, b) => a.set_number - b.set_number)

  // Only finished, with a winner — comeback/upset analysis needs a result.
  const completed = ms.filter(m =>
    FINISHED.has(m.status) && m.winner_pair != null,
  )

  // ── Upsets ──────────────────────────────────────────────────
  const upsetsList = completed.map(m => {
    const winnerPair = m.winner_pair === 1
      ? { p1: m.pair1_player1, p2: m.pair1_player2 }
      : { p1: m.pair2_player1, p2: m.pair2_player2 }
    const loserPair = m.winner_pair === 1
      ? { p1: m.pair2_player1, p2: m.pair2_player2 }
      : { p1: m.pair1_player1, p2: m.pair1_player2 }
    const winRank = pairAvgRanking(winnerPair.p1, winnerPair.p2)
    const loseRank = pairAvgRanking(loserPair.p1, loserPair.p2)
    if (winRank == null || loseRank == null) return null
    const gap = winRank - loseRank // positive = upset
    return {
      matchId: m.id,
      round: readableRound(m.round),
      category: m.category,
      winner: pairLabel(winnerPair.p1, winnerPair.p2),
      winnerAvgRanking: Math.round(winRank),
      loser: pairLabel(loserPair.p1, loserPair.p2),
      loserAvgRanking: Math.round(loseRank),
      rankingGap: Math.round(gap),
      score: buildScoreStringFromGames(setsByMatch.get(m.id) ?? [], m.winner_pair as number),
    }
  }).filter((x): x is NonNullable<typeof x> => x !== null)
   .filter(u => u.rankingGap > 0)
   .sort((a, b) => b.rankingGap - a.rankingGap)

  // ── Comebacks ──────────────────────────────────────────────
  const comebacks = completed.flatMap(m => {
    const sets = setsByMatch.get(m.id) ?? []
    if (sets.length < 3) return [] // need 3 sets minimum
    const set1 = sets[0]!
    if (set1.pair1_games == null || set1.pair2_games == null) return []
    const set1Winner = set1.pair1_games > set1.pair2_games ? 1 : 2
    if (set1Winner === m.winner_pair) return [] // not a comeback
    const winnerPair = m.winner_pair === 1
      ? { p1: m.pair1_player1, p2: m.pair1_player2 }
      : { p1: m.pair2_player1, p2: m.pair2_player2 }
    const loserPair = m.winner_pair === 1
      ? { p1: m.pair2_player1, p2: m.pair2_player2 }
      : { p1: m.pair1_player1, p2: m.pair1_player2 }
    const dur = parseHhMm(m.duration)
    return [{
      matchId: m.id,
      round: readableRound(m.round),
      category: m.category,
      winner: pairLabel(winnerPair.p1, winnerPair.p2),
      loser: pairLabel(loserPair.p1, loserPair.p2),
      score: buildScoreStringFromGames(sets, m.winner_pair as number),
      durationMinutes: dur && dur > 10 && dur < 360 ? dur : null,
    }]
  })

  // ── Duration extremes ─────────────────────────────────────
  // Use the authoritative `matches.duration` (HH:MM from the upstream
  // feed) — NOT (finished_at - started_at). The latter includes court
  // suspensions, weather delays, and scheduling reshuffles, which
  // wildly distort match length. Brussels P2 R16 women had a match
  // with a 232-min gap between started/finished but only 95 min of
  // actual play (7-6, 6-2).
  const withDuration = completed
    .map(m => {
      const dur = parseHhMm(m.duration)
      if (dur == null || dur < 10 || dur > 360) return null
      return { ...m, _durationMinutes: dur }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .map(m => {
      const winnerPair = m.winner_pair === 1
        ? { p1: m.pair1_player1, p2: m.pair1_player2 }
        : { p1: m.pair2_player1, p2: m.pair2_player2 }
      const loserPair = m.winner_pair === 1
        ? { p1: m.pair2_player1, p2: m.pair2_player2 }
        : { p1: m.pair1_player1, p2: m.pair1_player2 }
      return {
        matchId: m.id,
        round: readableRound(m.round),
        category: m.category,
        winner: pairLabel(winnerPair.p1, winnerPair.p2),
        loser: pairLabel(loserPair.p1, loserPair.p2),
        score: buildScoreStringFromGames(setsByMatch.get(m.id) ?? [], m.winner_pair as number),
        durationMinutes: m._durationMinutes,
      }
    })

  const longest = [...withDuration].sort((a, b) => b.durationMinutes - a.durationMinutes).slice(0, 5)
  const shortest = [...withDuration]
    .filter(m => m.durationMinutes >= 30) // filter walkovers
    .sort((a, b) => a.durationMinutes - b.durationMinutes).slice(0, 5)
  const totalMinutes = withDuration.reduce((acc, m) => acc + m.durationMinutes, 0)

  // ── Tiebreak deciders ─────────────────────────────────────
  const tiebreakDeciders = completed.filter(m => {
    const sets = setsByMatch.get(m.id) ?? []
    if (sets.length < 3) return false
    const decider = sets[sets.length - 1]!
    if (decider.pair1_games == null || decider.pair2_games == null) return false
    return Math.abs(decider.pair1_games - decider.pair2_games) === 1
      && Math.max(decider.pair1_games, decider.pair2_games) >= 7
  }).map(m => {
    const dur = parseHhMm(m.duration)
    return {
      matchId: m.id,
      round: readableRound(m.round),
      category: m.category,
      score: buildScoreStringFromGames(setsByMatch.get(m.id) ?? [], m.winner_pair as number),
      durationMinutes: dur && dur > 10 && dur < 360 ? dur : null,
    }
  })

  // ── Bagels ────────────────────────────────────────────────
  const bagels = completed.flatMap(m => {
    const sets = setsByMatch.get(m.id) ?? []
    return sets
      .filter(s => s.pair1_games === 0 || s.pair2_games === 0)
      .map(s => ({
        matchId: m.id,
        round: readableRound(m.round),
        category: m.category,
        score: s.set_score,
        setNumber: s.set_number,
      }))
  })

  // ── Round duration averages ──────────────────────────────
  const byRound: Record<string, { count: number; totalMin: number }> = {}
  for (const m of withDuration) {
    const k = m.round
    if (!byRound[k]) byRound[k] = { count: 0, totalMin: 0 }
    byRound[k].count++
    byRound[k].totalMin += m.durationMinutes
  }
  const roundAverages = Object.entries(byRound).map(([round, d]) => ({
    round,
    matches: d.count,
    avgMinutes: Math.round(d.totalMin / d.count),
  })).sort((a, b) => b.avgMinutes - a.avgMinutes)

  // ── Per-player runs ──────────────────────────────────────
  const playerStats = new Map<string, {
    name: string
    country: string | null
    ranking: number | null
    matchesPlayed: number
    matchesWon: number
    setsWon: number
    setsLost: number
  }>()
  for (const m of completed) {
    const allPlayers = [m.pair1_player1, m.pair1_player2, m.pair2_player1, m.pair2_player2]
      .filter((p): p is PlayerRow => !!p)
    const winnersIds = new Set(
      m.winner_pair === 1
        ? [m.pair1_player1, m.pair1_player2].filter(Boolean).map(p => p!.id)
        : [m.pair2_player1, m.pair2_player2].filter(Boolean).map(p => p!.id),
    )
    const sets = setsByMatch.get(m.id) ?? []
    const winnerSetCount = sets.filter(s => {
      if (s.pair1_games == null || s.pair2_games == null) return false
      const w = s.pair1_games > s.pair2_games ? 1 : 2
      return w === m.winner_pair
    }).length
    const loserSetCount = sets.length - winnerSetCount

    for (const p of allPlayers) {
      if (!playerStats.has(p.id)) {
        playerStats.set(p.id, {
          name: shortName(p),
          country: p.country,
          ranking: p.ranking,
          matchesPlayed: 0, matchesWon: 0,
          setsWon: 0, setsLost: 0,
        })
      }
      const s = playerStats.get(p.id)!
      s.matchesPlayed++
      if (winnersIds.has(p.id)) {
        s.matchesWon++
        s.setsWon += winnerSetCount
        s.setsLost += loserSetCount
      } else {
        s.setsWon += loserSetCount
        s.setsLost += winnerSetCount
      }
    }
  }
  const topRunners = Array.from(playerStats.values())
    .sort((a, b) => b.matchesWon - a.matchesWon || b.matchesPlayed - a.matchesPlayed)
    .slice(0, 12)

  // ── Tournament totals ────────────────────────────────────
  const totals = {
    matchesScheduled: ms.length,
    matchesPlayed: completed.length,
    walkovers: ms.filter(m => m.status === 'walkover').length,
    retirements: ms.filter(m => m.status === 'retired').length,
    totalHoursOfTennis: Math.round((totalMinutes / 60) * 10) / 10,
    setsPlayed: Array.from(setsByMatch.values()).flat().filter(s => s.pair1_games != null && s.pair2_games != null).length,
    threeSetMatches: completed.filter(m => (setsByMatch.get(m.id)?.length ?? 0) >= 3).length,
  }

  // Output
  console.log(JSON.stringify({
    tournament: {
      id: tournament.id,
      name: tournament.name,
      level: tournament.level,
      country: tournament.country,
      location: tournament.location,
      dates: `${tournament.starts_at?.slice(0, 10)} → ${tournament.ends_at?.slice(0, 10)}`,
      drawSizeMD: tournament.draw_size_md,
    },
    totals,
    upsets: upsetsList.slice(0, 8),
    comebacks: comebacks.slice(0, 6),
    longestMatches: longest,
    shortestMatches: shortest,
    tiebreakDeciders: tiebreakDeciders.slice(0, 8),
    bagels: bagels.slice(0, 8),
    roundAverages,
    topRunners,
  }, null, 2))
}

main().catch(err => {
  console.error('analyze-tournament error:', err)
  process.exit(99)
})

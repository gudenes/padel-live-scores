/**
 * Elo + Monte Carlo tournament simulation — v0 proof of concept.
 *
 *   # Default targets (Albania, Italy Major)
 *   npx tsx scripts/simulate-elo-tournaments.ts
 *
 *   # Specific tournaments by UUID
 *   npx tsx scripts/simulate-elo-tournaments.ts <uuid> <uuid> ...
 *
 *   # Force entry round (default: latest assigned round)
 *   npx tsx scripts/simulate-elo-tournaments.ts <uuid> --from=R32
 *
 * What this does:
 *  1. Trains a player-level Elo on ALL finished matches in the DB before each
 *     target tournament's start_at (no peeking at in-tournament results).
 *     - K-factor varies by tournament tier.
 *     - Cold-start prior comes from FIP ranking (top-ranked players seeded high).
 *  2. For the target tournament, pulls the surviving pairs from the chosen entry
 *     round (R32 for a fresh-draw backtest, R16/latest for a mid-tournament
 *     forecast) and runs a random-bracket Monte Carlo: 20k draws, each one
 *     shuffles the alive pairs into a knockout bracket and plays it out using
 *     Elo win probabilities.
 *  3. Reports each pair's championship %, finalist %, and semifinalist %.
 *  4. If the tournament has actually finished, also prints the real winner /
 *     finalists / semifinalists and where they ranked in our forecast — i.e.
 *     a simple calibration check.
 *
 * Why random-bracket: we don't have reliable bracket-slot linkage between
 * rounds in our matches table. Averaging over random bracket configurations
 * smooths out draw-luck and gives a clean, defensible probability we can quote.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  fipPriorElo,
  pairWinProbability,
  trainElo,
  toDecimal,
  toAmerican,
  toFractional,
  type TrainingMatch,
  type PlayerSnapshot,
  type TrainResult,
} from '../padelgod/src/lib/elo-model'

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"(.*)"$/, '$1')
    }
  } catch {}
}
loadEnv()

const supabase: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_TARGETS = [
  '8a47598a-579b-4503-88c2-135306d274fb', // FIP PLATINUM ALBANIA
  '7d331efb-82e4-40d5-9b51-5109cb9dff04', // ITALY MAJOR
]

const MC_RUNS = 20_000

// Time decay: matches halflife days old contribute 50% as much to Elo updates.
// 180d is in the same ballpark as published tennis Elos (Sackmann, FiveThirtyEight).
// Set to a huge number (e.g. 99999) via --halflife=99999 to disable decay.
const DEFAULT_HALFLIFE_DAYS = 180

// Form window for the "form delta" column lives in the shared lib
// (FORM_WINDOW_DAYS in padelgod/src/lib/elo-model). trainElo applies it
// internally — the script just consumes the snapshot returned in TrainResult.

// Parse CLI args
const argv = process.argv.slice(2)
const forceRound = argv.find((a) => a.startsWith('--from='))?.split('=')[1] ?? null
const halflifeArg = argv.find((a) => a.startsWith('--halflife='))?.split('=')[1]
const HALFLIFE_DAYS = halflifeArg ? Number(halflifeArg) : DEFAULT_HALFLIFE_DAYS
const modeArg = (argv.find((a) => a.startsWith('--mode='))?.split('=')[1] ?? 'tournament') as
  | 'tournament'
  | 'matches'
const dateArg = argv.find((a) => a.startsWith('--date='))?.split('=')[1] ?? null
const tournamentIds = argv.filter((a) => !a.startsWith('--'))
const TARGET_IDS = tournamentIds.length > 0 ? tournamentIds : DEFAULT_TARGETS

// (fipPriorElo / kFactor / pairWinProbability now imported from
// padelgod/src/lib/elo-model — see top of file.)

// ---------------------------------------------------------------------------
// Pagination helper (defensive against 10k cap)
// ---------------------------------------------------------------------------
async function paginated<T>(fn: (start: number, end: number) => any, batch = 1000): Promise<T[]> {
  const out: T[] = []
  let start = 0
  while (true) {
    const { data, error } = await fn(start, start + batch - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < batch) break
    start += batch
  }
  return out
}

// ---------------------------------------------------------------------------
// Elo training — types + trainElo imported from padelgod/src/lib/elo-model
// ---------------------------------------------------------------------------

async function loadPlayers(): Promise<Map<string, PlayerSnapshot>> {
  const rows = await paginated<PlayerSnapshot>((s, e) =>
    supabase.from('players').select('id, name, ranking, category').range(s, e),
  )
  return new Map(rows.map((r) => [r.id, r]))
}

async function loadTrainingMatches(beforeIso: string): Promise<TrainingMatch[]> {
  const rows = await paginated<TrainingMatch>((s, e) =>
    supabase
      .from('matches')
      .select(
        'id, tournament_id, finished_at, scheduled_at, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, winner_pair',
      )
      .eq('status', 'finished')
      .not('winner_pair', 'is', null)
      .not('pair1_player1_id', 'is', null)
      .not('pair1_player2_id', 'is', null)
      .not('pair2_player1_id', 'is', null)
      .not('pair2_player2_id', 'is', null)
      .lt('scheduled_at', beforeIso)
      .order('scheduled_at', { ascending: true })
      .range(s, e),
  )
  return rows
}

async function loadTournamentLevels(): Promise<Map<string, string>> {
  const rows = await paginated<{ id: string; level: string | null }>((s, e) =>
    supabase.from('tournaments').select('id, level').range(s, e),
  )
  return new Map(rows.map((r) => [r.id, r.level ?? '']))
}

// ---------------------------------------------------------------------------
// Bracket discovery + Monte Carlo
// ---------------------------------------------------------------------------

interface SurvivingPair {
  pair_id: string                       // synthetic, stable per (p1,p2) sorted
  player_ids: [string, string]
  names: [string, string]
  seed: number | null
  team_elo: number
  team_form: number                     // current_team_elo - team_elo_30d_ago
}

const ROUND_ORDER = ['R32', 'R16', 'QF', 'SF', 'F'] as const

function canonicalRound(r: string | null): string {
  if (!r) return ''
  const x = r.toLowerCase()
  if (x.includes('round of 32') || x === 'r32') return 'R32'
  if (x.includes('round of 16') || x === 'r16') return 'R16'
  if (x === 'qf' || x.includes('quarter')) return 'QF'
  if (x === 'sf' || x.includes('semi')) return 'SF'
  if (x === 'f' || x.includes('final')) return 'F'
  return x.toUpperCase()
}

async function loadSurvivingPairs(
  tournamentId: string,
  category: 'men' | 'women',
  players: Map<string, PlayerSnapshot>,
  trainResult: TrainResult,
  forcedRound: string | null,
): Promise<{ pairs: SurvivingPair[]; entryRound: string }> {
  const { elo, eloFormStart } = trainResult
  const { data: rows } = await supabase
    .from('matches')
    .select(
      'id, round, round_canonical, status, scheduled_at, winner_pair, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, pair1_seed, pair2_seed',
    )
    .eq('tournament_id', tournamentId)
    .eq('category', category)

  if (!rows || rows.length === 0) return { pairs: [], entryRound: '' }

  // Group by canonical round
  const byRound: Record<string, typeof rows> = {}
  for (const m of rows) {
    const r = canonicalRound(m.round_canonical ?? m.round)
    if (!ROUND_ORDER.includes(r as any)) continue
    byRound[r] = byRound[r] ?? []
    byRound[r].push(m)
  }

  // Choose entry round.
  //  - If forcedRound is provided (e.g. --from=R32), collect pairs from THAT
  //    round PLUS all subsequent main-draw rounds. Subsequent rounds capture
  //    bye-recipients (top seeds who don't appear in R32 when the draw is <32
  //    teams). De-dup handles overlap — a pair that played R32 and advanced to
  //    R16 only counts once.
  //  - Otherwise pick the LATEST round that has at least 4 pairs with full IDs
  //    (typical mid-tournament forecast — only that round's pairs).
  let entryRound = ''
  let collectFromRounds: string[] = []
  if (forcedRound) {
    entryRound = canonicalRound(forcedRound)
    const startIdx = ROUND_ORDER.indexOf(entryRound as any)
    if (startIdx < 0 || !byRound[entryRound] || byRound[entryRound].length === 0) {
      return { pairs: [], entryRound: '' }
    }
    collectFromRounds = ROUND_ORDER.slice(startIdx) as string[]
  } else {
    for (const r of ROUND_ORDER) {
      const ms = byRound[r] ?? []
      if (ms.length === 0) continue
      let assigned = 0
      for (const m of ms) {
        if (m.pair1_player1_id && m.pair1_player2_id) assigned++
        if (m.pair2_player1_id && m.pair2_player2_id) assigned++
      }
      if (assigned >= 4) entryRound = r
    }
    if (!entryRound) return { pairs: [], entryRound: '' }
    collectFromRounds = [entryRound]
  }

  const matches = collectFromRounds.flatMap((r) => byRound[r] ?? [])
  const pairs: SurvivingPair[] = []
  const seen = new Set<string>()

  const addPair = (ids: [string, string], seed: number | null) => {
    const sorted = [...ids].sort() as [string, string]
    const key = sorted.join('::')
    if (seen.has(key)) return
    seen.add(key)
    const p1 = players.get(ids[0])
    const p2 = players.get(ids[1])
    const e1 = elo.get(ids[0]) ?? fipPriorElo(p1?.ranking)
    const e2 = elo.get(ids[1]) ?? fipPriorElo(p2?.ranking)
    const team_elo = (e1 + e2) / 2
    // Form = how much the team's Elo moved over the last FORM_WINDOW_DAYS.
    const e1Prev = eloFormStart.get(ids[0]) ?? e1
    const e2Prev = eloFormStart.get(ids[1]) ?? e2
    const team_elo_prev = (e1Prev + e2Prev) / 2
    pairs.push({
      pair_id: key,
      player_ids: ids,
      names: [p1?.name ?? ids[0], p2?.name ?? ids[1]],
      seed,
      team_elo,
      team_form: team_elo - team_elo_prev,
    })
  }

  for (const m of matches) {
    if (m.pair1_player1_id && m.pair1_player2_id) {
      addPair([m.pair1_player1_id, m.pair1_player2_id], m.pair1_seed ?? null)
    }
    if (m.pair2_player1_id && m.pair2_player2_id) {
      addPair([m.pair2_player1_id, m.pair2_player2_id], m.pair2_seed ?? null)
    }
  }

  return { pairs, entryRound }
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

function pickWinner(a: SurvivingPair, b: SurvivingPair): SurvivingPair {
  const pA = pairWinProbability(a.team_elo, b.team_elo)
  return Math.random() < pA ? a : b
}

interface SimResult {
  pair: SurvivingPair
  champ: number
  finalist: number
  semi: number
}

function monteCarlo(pairs: SurvivingPair[], runs: number): SimResult[] {
  if (pairs.length < 2) return []
  // Round up to nearest power of 2 with "bye" placeholders (rare in our case)
  let bracketSize = 1
  while (bracketSize < pairs.length) bracketSize *= 2

  const tally = new Map<string, { champ: number; finalist: number; semi: number }>()
  for (const p of pairs) tally.set(p.pair_id, { champ: 0, finalist: 0, semi: 0 })

  for (let run = 0; run < runs; run++) {
    let alive: (SurvivingPair | null)[] = shuffle(pairs)
    while (alive.length < bracketSize) alive.push(null)
    // SF tracking
    const semiTrackers: string[] = []
    const finalTrackers: string[] = []
    let depth = 0
    while (alive.length > 1) {
      const next: (SurvivingPair | null)[] = []
      for (let i = 0; i < alive.length; i += 2) {
        const a = alive[i]!
        const b = alive[i + 1]!
        if (a && !b) next.push(a)
        else if (!a && b) next.push(b)
        else if (!a && !b) next.push(null)
        else next.push(pickWinner(a, b))
      }
      alive = next
      depth++
      // capture semifinalists (4 left) and finalists (2 left)
      if (alive.length === 4) {
        for (const p of alive) if (p) semiTrackers.push(p.pair_id)
      }
      if (alive.length === 2) {
        for (const p of alive) if (p) finalTrackers.push(p.pair_id)
      }
    }
    const winner = alive[0]
    if (winner) tally.get(winner.pair_id)!.champ++
    for (const id of finalTrackers) tally.get(id)!.finalist++
    for (const id of semiTrackers) tally.get(id)!.semi++
  }

  return pairs
    .map((p) => {
      const t = tally.get(p.pair_id)!
      return {
        pair: p,
        champ: t.champ / runs,
        finalist: t.finalist / runs,
        semi: t.semi / runs,
      }
    })
    .sort((a, b) => b.champ - a.champ)
}

function fmtPct(x: number): string {
  const v = x * 100
  if (v < 0.05) return '<0.1%'
  return `${v.toFixed(1)}%`
}

// ---------------------------------------------------------------------------
// Odds conversion (toDecimal / toAmerican / toFractional) imported from
// padelgod/src/lib/elo-model — see docs/superpowers/specs/2026-05-27-elo-odds-model-design.md
// ---------------------------------------------------------------------------

function fmtAmerican(american: number): string {
  return american > 0 ? `+${american}` : `${american}`
}

function fmtDecimal(d: number): string {
  if (d >= 100) return d.toFixed(0)
  return d.toFixed(2)
}

// ---------------------------------------------------------------------------
// Actual outcome lookup — for backtesting
// ---------------------------------------------------------------------------

interface ActualOutcome {
  winner: string | null              // "Name1 / Name2" of the F winner
  finalists: string[]                // both pairs in the F
  semifinalists: string[]            // 4 pairs in the SFs
  winnerPairKey: string | null       // sorted player_ids joined :: for matching to sim
  finalistKeys: string[]
  semiKeys: string[]
}

async function loadActualOutcome(
  tournamentId: string,
  category: 'men' | 'women',
  players: Map<string, PlayerSnapshot>,
): Promise<ActualOutcome | null> {
  const { data } = await supabase
    .from('matches')
    .select(
      'round, round_canonical, status, winner_pair, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id',
    )
    .eq('tournament_id', tournamentId)
    .eq('category', category)
  if (!data) return null

  const pairKey = (ids: (string | null)[]): string | null => {
    if (!ids[0] || !ids[1]) return null
    return [ids[0], ids[1]].sort().join('::')
  }
  const pairName = (ids: (string | null)[]): string => {
    if (!ids[0] || !ids[1]) return '?/?'
    return `${players.get(ids[0])?.name ?? '?'} / ${players.get(ids[1])?.name ?? '?'}`
  }

  const out: ActualOutcome = {
    winner: null,
    finalists: [],
    semifinalists: [],
    winnerPairKey: null,
    finalistKeys: [],
    semiKeys: [],
  }

  for (const m of data) {
    const r = canonicalRound(m.round_canonical ?? m.round)
    const isFinished = m.status === 'finished' || m.status === 'retired' || m.status === 'walkover'
    if (!isFinished) continue
    const p1 = [m.pair1_player1_id, m.pair1_player2_id]
    const p2 = [m.pair2_player1_id, m.pair2_player2_id]
    const winnerIds = m.winner_pair === 1 ? p1 : m.winner_pair === 2 ? p2 : null

    if (r === 'F' && winnerIds) {
      out.winner = pairName(winnerIds)
      out.winnerPairKey = pairKey(winnerIds)
      const p1Name = pairName(p1)
      const p2Name = pairName(p2)
      out.finalists = [p1Name, p2Name]
      out.finalistKeys = [pairKey(p1), pairKey(p2)].filter((k): k is string => k != null)
    }
    if (r === 'SF') {
      const p1Name = pairName(p1)
      const p2Name = pairName(p2)
      if (p1Name !== '?/?') out.semifinalists.push(p1Name)
      if (p2Name !== '?/?') out.semifinalists.push(p2Name)
      const k1 = pairKey(p1)
      const k2 = pairKey(p2)
      if (k1) out.semiKeys.push(k1)
      if (k2) out.semiKeys.push(k2)
    }
  }
  if (!out.winner && out.semifinalists.length === 0) return null
  return out
}

// ---------------------------------------------------------------------------
// Per-match odds mode
// ---------------------------------------------------------------------------

async function listMatchesWithOdds(
  tournamentId: string,
  players: Map<string, PlayerSnapshot>,
  trainResult: TrainResult,
  dateIso: string | null, // YYYY-MM-DD; null = today
) {
  const target = dateIso ?? new Date().toISOString().slice(0, 10)
  const dayStart = `${target}T00:00:00`
  const dayEnd = `${target}T23:59:59`

  const { data: matches } = await supabase
    .from('matches')
    .select(
      'id, category, round, round_canonical, status, scheduled_at, court, court_order, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, pair1_seed, pair2_seed',
    )
    .eq('tournament_id', tournamentId)
    .gte('scheduled_at', dayStart)
    .lte('scheduled_at', dayEnd)
    .order('scheduled_at', { ascending: true })
    .order('court_order', { ascending: true })

  if (!matches || matches.length === 0) {
    console.log(`  no matches scheduled on ${target}`)
    return
  }

  console.log(`\n  Per-match odds for ${target} (fair probabilities, no vig):`)
  console.log(
    `  ${'Time'.padEnd(7)} ${'Court'.padEnd(8)} ${'Cat'.padEnd(6)} ${'Rd'.padEnd(5)} ${'Status'.padEnd(10)}  Pair vs Pair                                    Prob   Decimal  Fract   American`,
  )
  console.log(`  ${'─'.repeat(140)}`)

  const { elo } = trainResult
  for (const m of matches) {
    const cat = m.category ?? '?'
    const round = canonicalRound(m.round_canonical ?? m.round) || (m.round ?? '?')
    const time = m.scheduled_at?.slice(11, 16) ?? '?'
    const court = (m.court ?? '?').toString().slice(0, 8)
    const status = (m.status ?? '?').slice(0, 10)

    const p1Ids: [string, string] | null =
      m.pair1_player1_id && m.pair1_player2_id ? [m.pair1_player1_id, m.pair1_player2_id] : null
    const p2Ids: [string, string] | null =
      m.pair2_player1_id && m.pair2_player2_id ? [m.pair2_player1_id, m.pair2_player2_id] : null

    const pairName = (ids: [string, string] | null, seed: number | null) => {
      if (!ids) return 'TBD'
      const n1 = players.get(ids[0])?.name ?? '?'
      const n2 = players.get(ids[1])?.name ?? '?'
      const s = seed ? `[${seed}] ` : ''
      return `${s}${n1.split(' ').slice(-1)[0]}/${n2.split(' ').slice(-1)[0]}`
    }
    const n1 = pairName(p1Ids, m.pair1_seed)
    const n2 = pairName(p2Ids, m.pair2_seed)

    if (!p1Ids || !p2Ids) {
      console.log(
        `  ${time.padEnd(7)} ${court.padEnd(8)} ${cat.padEnd(6)} ${round.padEnd(5)} ${status.padEnd(10)}  ${(n1 + ' vs ' + n2).padEnd(46)}  (pairs not yet assigned)`,
      )
      continue
    }

    const e1 = (elo.get(p1Ids[0]) ?? fipPriorElo(players.get(p1Ids[0])?.ranking)) +
               (elo.get(p1Ids[1]) ?? fipPriorElo(players.get(p1Ids[1])?.ranking))
    const e2 = (elo.get(p2Ids[0]) ?? fipPriorElo(players.get(p2Ids[0])?.ranking)) +
               (elo.get(p2Ids[1]) ?? fipPriorElo(players.get(p2Ids[1])?.ranking))
    const elo1 = e1 / 2
    const elo2 = e2 / 2
    const p1 = pairWinProbability(elo1, elo2)
    const p2 = 1 - p1

    const fmtLine = (name: string, p: number) =>
      `  ${' '.repeat(7)} ${' '.repeat(8)} ${' '.repeat(6)} ${' '.repeat(5)} ${' '.repeat(10)}  ${name.padEnd(46)}  ${fmtPct(p).padStart(5)}  ${fmtDecimal(toDecimal(p)).padStart(6)}  ${toFractional(p).padStart(5)}  ${fmtAmerican(toAmerican(p)).padStart(7)}`

    console.log(
      `  ${time.padEnd(7)} ${court.padEnd(8)} ${cat.padEnd(6)} ${round.padEnd(5)} ${status.padEnd(10)}  ${'—'.padEnd(46)}`,
    )
    console.log(fmtLine(n1, p1))
    console.log(fmtLine(n2, p2))
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  console.log('Loading players...')
  const players = await loadPlayers()
  console.log(`  ${players.size} players in DB`)

  console.log('Loading tournament levels...')
  const tournamentLevels = await loadTournamentLevels()
  console.log(`  ${tournamentLevels.size} tournaments`)

  console.log(`Mode: ${modeArg}`)
  console.log(`Forced entry round: ${forceRound ?? '(auto)'}`)
  console.log(`Halflife: ${HALFLIFE_DAYS}d`)
  if (modeArg === 'matches') console.log(`Date filter: ${dateArg ?? '(today)'}`)
  console.log(`Targets: ${TARGET_IDS.join(', ')}`)

  const { data: targetRows } = await supabase
    .from('tournaments')
    .select('id, name, starts_at, ends_at, status, level')
    .in('id', TARGET_IDS)

  for (const tid of TARGET_IDS) {
    const meta = targetRows?.find((t) => t.id === tid)
    console.log(`\n=================================================`)
    console.log(`${meta?.name ?? tid} (${tid})`)
    console.log(`  starts_at=${meta?.starts_at} level=${meta?.level} status=${meta?.status}`)

    if (!meta?.starts_at) {
      console.log('  ! missing starts_at — skipping')
      continue
    }

    console.log('  Loading training matches (finished before tournament start)...')
    const training = await loadTrainingMatches(meta.starts_at)
    console.log(`  ${training.length} finished matches available pre-tournament`)
    const trainResult = trainElo(training, players, tournamentLevels, meta.starts_at, HALFLIFE_DAYS)
    const skipped = training.length - trainResult.trainedCount
    console.log(
      `  trained on ${trainResult.trainedCount} matches (skipped ${skipped}, halflife=${HALFLIFE_DAYS}d)`,
    )

    // --- Per-match odds mode short-circuits before the tournament-MC block ---
    if (modeArg === 'matches') {
      await listMatchesWithOdds(tid, players, trainResult, dateArg)
      continue
    }

    for (const category of ['men', 'women'] as const) {
      const { pairs, entryRound } = await loadSurvivingPairs(
        tid,
        category,
        players,
        trainResult,
        forceRound,
      )
      console.log(`\n  --- ${category.toUpperCase()} ---`)
      if (pairs.length === 0) {
        console.log('    no surviving pairs found (draw not populated or no completed round)')
        continue
      }
      console.log(`    entry round: ${entryRound} (${pairs.length} pairs)`)
      console.log(`    running ${MC_RUNS.toLocaleString()} Monte Carlo iterations...`)
      const results = monteCarlo(pairs, MC_RUNS)
      console.log(`    Rank Seed Champ%  Final% Semi%  Elo   Form  Pair`)
      results.forEach((r, i) => {
        const rank = (i + 1).toString().padStart(2)
        const seed = (r.pair.seed ? `[${r.pair.seed}]` : '   ').padEnd(4)
        const elo = Math.round(r.pair.team_elo).toString().padStart(5)
        const form = Math.round(r.pair.team_form)
        const formStr = (form > 0 ? `+${form}` : `${form}`).padStart(5)
        const name = `${r.pair.names[0]} / ${r.pair.names[1]}`
        console.log(
          `    ${rank}   ${seed} ${fmtPct(r.champ).padStart(6)} ${fmtPct(r.finalist).padStart(6)} ${fmtPct(r.semi).padStart(6)} ${elo} ${formStr}  ${name}`,
        )
      })

      // Backtest: if the tournament actually finished, show how the forecast did.
      const actual = await loadActualOutcome(tid, category, players)
      if (actual && (actual.winner || actual.semifinalists.length > 0)) {
        console.log(`\n    actual outcome:`)
        if (actual.winner) console.log(`      champion : ${actual.winner}`)
        if (actual.finalists.length) console.log(`      final    : ${actual.finalists.join('  vs  ')}`)
        if (actual.semifinalists.length) console.log(`      semis    : ${actual.semifinalists.join(' | ')}`)

        // Calibration: where did the actual winner / finalists / semifinalists rank?
        const findRank = (key: string | null): { rank: number; r: SimResult } | null => {
          if (!key) return null
          const idx = results.findIndex((r) => r.pair.pair_id === key)
          return idx >= 0 ? { rank: idx + 1, r: results[idx]! } : null
        }
        if (actual.winnerPairKey) {
          const w = findRank(actual.winnerPairKey)
          if (w) {
            console.log(
              `    forecast for actual champion: rank #${w.rank} of ${results.length}, champ%=${fmtPct(w.r.champ)} (elo ${Math.round(w.r.pair.team_elo)})`,
            )
          } else {
            console.log(`    actual champion not present in entry-round field (qualifier?)`)
          }
        }
        let inTop3 = 0
        for (const k of actual.finalistKeys) {
          const w = findRank(k)
          if (w && w.rank <= 3) inTop3++
        }
        console.log(`    finalists in forecast top 3: ${inTop3}/${actual.finalistKeys.length}`)
        let semiInTop8 = 0
        for (const k of actual.semiKeys) {
          const w = findRank(k)
          if (w && w.rank <= 8) semiInTop8++
        }
        console.log(`    semifinalists in forecast top 8: ${semiInTop8}/${actual.semiKeys.length}`)
      }
    }
  }
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})

// apps/ops/src/lib/readiness.ts
//
// Pure rules engine for the Data Readiness view. No I/O. Given a
// per-tournament rollup (assembled by the route from set-based queries),
// it derives the lifecycle stage, evaluates each of the 7 dimensions
// against status- & tier-aware expectations, and rolls up a verdict.
// Design: docs/superpowers/specs/2026-06-03-tournament-data-readiness-design.md

export type Stage = 'upcoming' | 'ongoing' | 'completed'
export type CellState = 'ok' | 'partial' | 'missing' | 'na' | 'divergent'
export type Verdict = 'ok' | 'gaps' | 'broken'
export type DimensionKey =
  | 'matches' | 'players' | 'oop' | 'results' | 'entry' | 'stats' | 'streams'

export const IN_SCOPE_TIERS = [
  'major', 'p1', 'p2', 'finals',
  'fip_platinum', 'fip_gold', 'fip_silver', 'fip_bronze',
] as const

export function isPremierTier(level: string | null): boolean {
  return level === 'major' || level === 'p1' || level === 'p2' || level === 'finals'
}

export interface TournamentRollup {
  id: string
  level: string | null
  startsAt: string | null
  endsAt: string | null
  registrationStatus: string | null
  finalPlayed: boolean
  matchCount: number
  liveOrScheduledCount: number
  finishedCount: number
  finishedWithWinner: number
  playerSlotsTotal: number
  playerSlotsResolved: number
  oopPopulated: number
  hasMatchStats: boolean
  entryListResolved: boolean
  hasStreams: boolean
  drawSnapshotAt: string | null
  oopSnapshotAt: string | null
  resultsSnapshotAt: string | null
}

export interface DimensionResult { key: DimensionKey; state: CellState; detail: string }
export interface ReadinessResult {
  stage: Stage
  verdict: Verdict
  divergent: boolean
  dimensions: DimensionResult[]
}

type Expect = 'required' | 'partial' | 'optional' | 'na'

const RESOLVED_OK = 0.95
const RESULTS_OK = 0.99

export function deriveStage(r: TournamentRollup, today: string): Stage {
  const t = today.slice(0, 10)
  const starts = r.startsAt ? r.startsAt.slice(0, 10) : null
  const ends = r.endsAt ? r.endsAt.slice(0, 10) : null
  if (r.finalPlayed || (ends && ends < t)) return 'completed'
  const inWindow = !!(starts && ends && starts <= t && t <= ends)
  if (inWindow || r.liveOrScheduledCount > 0) return 'ongoing'
  return 'upcoming'
}

const EXPECT: Record<Stage, Record<DimensionKey, Expect>> = {
  upcoming:  { matches: 'optional', players: 'na',       oop: 'na',       results: 'na',       entry: 'required', stats: 'na',     streams: 'optional' },
  ongoing:   { matches: 'required', players: 'required', oop: 'required', results: 'partial',  entry: 'required', stats: 'partial', streams: 'partial'  },
  completed: { matches: 'required', players: 'required', oop: 'optional', results: 'required', entry: 'optional', stats: 'partial', streams: 'na'       },
}

function expectFor(stage: Stage, key: DimensionKey, premier: boolean, registrationStatus: string | null): Expect {
  const base = EXPECT[stage][key]
  if (key === 'stats' && !premier) return 'na'
  if (key === 'streams' && premier) return 'na'
  if (key === 'entry' && stage === 'upcoming' && registrationStatus !== 'closed') return 'optional'
  return base
}

function ratioState(num: number, denom: number, okAt: number): CellState {
  if (denom <= 0) return 'missing'
  const r = num / denom
  if (r >= okAt) return 'ok'
  if (r > 0) return 'partial'
  return 'missing'
}

function actualState(key: DimensionKey, r: TournamentRollup, premier: boolean): CellState {
  const anyMatchSnapshot = !!(r.drawSnapshotAt || r.oopSnapshotAt || r.resultsSnapshotAt)
  switch (key) {
    case 'matches':
      if (anyMatchSnapshot && r.matchCount === 0) return 'divergent'
      return r.matchCount > 0 ? 'ok' : 'missing'
    case 'players':
      return ratioState(r.playerSlotsResolved, r.playerSlotsTotal, RESOLVED_OK)
    case 'oop':
      if (r.oopSnapshotAt && r.matchCount > 0 && r.oopPopulated === 0) return 'divergent'
      return ratioState(r.oopPopulated, r.matchCount, RESOLVED_OK)
    case 'results':
      if (r.resultsSnapshotAt && (r.matchCount === 0 || (r.finishedCount > 0 && r.finishedWithWinner === 0))) return 'divergent'
      return ratioState(r.finishedWithWinner, r.finishedCount, RESULTS_OK)
    case 'entry':
      return r.entryListResolved ? 'ok' : 'missing'
    case 'stats':
      if (!premier) return 'na'
      return r.hasMatchStats ? 'ok' : 'missing'
    case 'streams':
      if (premier) return 'na'
      return r.hasStreams ? 'ok' : 'missing'
    default:
      return 'missing'
  }
}

function severity(expect: Expect, state: CellState): Verdict {
  if (state === 'divergent') return 'broken'
  if (state === 'na') return 'ok'
  switch (expect) {
    case 'required': return state === 'missing' ? 'broken' : state === 'partial' ? 'gaps' : 'ok'
    case 'partial':  return state === 'missing' ? 'gaps' : 'ok'
    case 'optional': return 'ok'
    case 'na':       return 'ok'
    default:         return 'ok'
  }
}

const RANK: Record<Verdict, number> = { ok: 0, gaps: 1, broken: 2 }

const DETAIL: Record<DimensionKey, (r: TournamentRollup) => string> = {
  matches: r => `${r.matchCount} matches`,
  players: r => r.playerSlotsTotal ? `${Math.round((r.playerSlotsResolved / r.playerSlotsTotal) * 100)}% resolved` : 'no matches',
  oop:     r => r.matchCount ? `${Math.round((r.oopPopulated / r.matchCount) * 100)}% scheduled` : 'no matches',
  results: r => r.finishedCount ? `${r.finishedWithWinner}/${r.finishedCount} scored` : 'no finished matches',
  entry:   r => (r.entryListResolved ? 'resolved' : 'no entry/draw data'),
  stats:   r => (r.hasMatchStats ? 'present' : 'none'),
  streams: r => (r.hasStreams ? 'present' : 'none'),
}

const ALL_DIMS: DimensionKey[] = ['matches', 'players', 'oop', 'results', 'entry', 'stats', 'streams']

export function computeReadiness(r: TournamentRollup, today: string): ReadinessResult {
  const stage = deriveStage(r, today)
  const premier = isPremierTier(r.level)

  const dimensions: DimensionResult[] = ALL_DIMS.map(key => {
    const expect = expectFor(stage, key, premier, r.registrationStatus)
    const state: CellState = expect === 'na' ? 'na' : actualState(key, r, premier)
    return { key, state, detail: state === 'na' ? 'N/A' : DETAIL[key](r) }
  })

  const verdict = dimensions
    .map(d => severity(expectFor(stage, d.key, premier, r.registrationStatus), d.state))
    .reduce<Verdict>((worst, v) => (RANK[v] > RANK[worst] ? v : worst), 'ok')

  const divergent = dimensions.some(d => d.state === 'divergent')
  return { stage, verdict, divergent, dimensions }
}

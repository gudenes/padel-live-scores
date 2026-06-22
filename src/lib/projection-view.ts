import type { Match, Player } from '@/types/match'
import type { ProjectionRow, ProjectionRoundJson, ProjRound } from '@/lib/projection-types'

export interface RoadPlayerVM {
  id: string
  name: string
  country: string | null
  avatarUrl: string | null
}

export interface RoadOpponentVM {
  pairKey: string
  players: RoadPlayerVM[]
  faceProb: number
  winProb: number
  /** 'won'|'lost' for an already-played round; null for a projected round. */
  result: 'won' | 'lost' | null
}

export interface RoadRoundVM {
  round: ProjRound
  dateIso: string | null
  reachProb: number
  expected: RoadOpponentVM | null
  opponents: RoadOpponentVM[]
}

export interface RoadVM {
  pairKey: string
  players: RoadPlayerVM[]
  status: 'active' | 'eliminated' | 'champion'
  eliminatedRound: string | null
  championProb: number
  finalistProb: number
  semifinalProb: number
  rounds: RoadRoundVM[]
}

export const ROUND_LABEL_KEY: Record<ProjRound, string> = {
  R64: 'roundR64', R32: 'roundR32', R16: 'roundR16', QF: 'roundQF', SF: 'roundSF', F: 'roundF',
}

const LIME = '#7ED321'
const GOLD = '#F5A623'
const LIVE = '#FF4655'

/** Win-probability → accent color (matches the Projection tab). */
export function winColor(p: number): string {
  return p >= 0.65 ? LIME : p >= 0.45 ? GOLD : LIVE
}

/** "Chozas / Libaak" — last-name tokens joined, the app's pair display rule. */
export function pairSurnames(players: RoadPlayerVM[]): string {
  return players.map((p) => p.name.split(' ').slice(-1)[0] || p.name).join(' / ')
}

export function buildPlayerLookup(matches: Match[]): Map<string, Player> {
  const map = new Map<string, Player>()
  for (const m of matches) {
    for (const p of [m.pair1_player1, m.pair1_player2, m.pair2_player1, m.pair2_player2]) {
      if (p?.id && !map.has(p.id)) map.set(p.id, p)
    }
  }
  return map
}

/** Minimal player identity from `usePairImages` (id-keyed name/country/avatar). */
export interface PlayerImageLite {
  name: string | null
  country: string | null
  avatarUrl: string | null
}

/**
 * Returns a new lookup that fills in any ids missing from the matches-derived
 * `lookup` with player identity fetched by id (e.g. usePairImages). Matches data
 * wins where present (it's richer). This lets `buildRoadVM` resolve the selected
 * pair's names even when no `matches` were supplied (the projection routes pass
 * `matches={[]}`) — otherwise the selected pair falls back to its raw
 * `pair_player_ids` (UUIDs) as the displayed names.
 */
export function mergeImagesIntoLookup(
  lookup: Map<string, Player>,
  images: Map<string, PlayerImageLite>,
): Map<string, Player> {
  const merged = new Map(lookup)
  for (const [id, img] of images) {
    if (merged.has(id)) continue
    merged.set(id, {
      id,
      external_id: '',
      name: img.name ?? '',
      display_name: img.name ?? null,
      country: img.country ?? null,
      avatar_url: img.avatarUrl ?? null,
    })
  }
  return merged
}

export function roundDateFor(
  round: ProjRound,
  schedule: Record<string, string> | null | undefined,
): string | null {
  if (!schedule) return null
  return schedule[round.toLowerCase()] ?? null
}

export function pickDefaultProjectionPair(
  rows: ProjectionRow[],
  bookmarkedPlayerIds: string[],
): string | null {
  if (rows.length === 0) return null
  const sorted = [...rows].sort((a, b) => b.champion_prob - a.champion_prob)
  const booked = new Set(bookmarkedPlayerIds)
  const withBookmark = sorted.find((r) => r.pair_player_ids.some((id) => booked.has(id)))
  return (withBookmark ?? sorted[0]).pair_key
}

function resolvePlayers(
  ids: string[],
  names: string[],
  lookup: Map<string, Player>,
): RoadPlayerVM[] {
  return ids.map((id, i) => {
    const p = lookup.get(id)
    return {
      id,
      name: p?.display_name ?? p?.name ?? names[i] ?? '',
      country: p?.country ?? null,
      avatarUrl: p?.avatar_url ?? null,
    }
  })
}

function opponentVM(
  o: ProjectionRoundJson['opponents'][number],
  lookup: Map<string, Player>,
): RoadOpponentVM {
  return {
    pairKey: o.pair_key,
    players: resolvePlayers(o.player_ids, o.names, lookup),
    faceProb: o.reach_prob,
    winProb: o.win_prob,
    result: o.result ?? null,
  }
}

export function buildRoadVM(
  row: ProjectionRow,
  lookup: Map<string, Player>,
  schedule: Record<string, string> | null | undefined,
): RoadVM {
  return {
    pairKey: row.pair_key,
    players: resolvePlayers(row.pair_player_ids, row.pair_player_ids, lookup),
    status: row.status ?? 'active',
    eliminatedRound: row.eliminated_round ?? null,
    championProb: row.champion_prob,
    finalistProb: row.finalist_prob,
    semifinalProb: row.semifinal_prob,
    rounds: row.rounds.map((r) => {
      const opponents = r.opponents
        .map((o) => opponentVM(o, lookup))
        .sort((a, b) => b.faceProb - a.faceProb)
      const expected = opponents[0] ?? null
      return { round: r.round, dateIso: roundDateFor(r.round, schedule), reachProb: r.reach_prob, expected, opponents }
    }),
  }
}

/** The pair's projected finish: the DEEPEST round they're more likely than not
 *  to reach (reachProb ≥ 0.5). Falls back to the shallowest round present when
 *  none is favoured; null for an empty list. Used for the road's plain-language
 *  prediction ("Projected to reach the {round}"). */
export function projectedFinishRound(rounds: RoadRoundVM[]): ProjRound | null {
  if (rounds.length === 0) return null
  let deepest = rounds[0]!.round
  for (const r of rounds) {
    if (r.reachProb >= 0.5) deepest = r.round
  }
  return deepest
}

/** Shallow→deep round order, for comparing how far a pair got. */
const ROUND_ORDER: ProjRound[] = ['R64', 'R32', 'R16', 'QF', 'SF', 'F']

/** A pair is a "contender" when its title odds are high enough that the
 *  champion % is the meaningful headline. Below this, the champion % is noise
 *  (e.g. 1%) and the hero leads with the projected round instead. */
export const CONTENDER_CHAMPION_PROB = 0.1

export function isContender(championProb: number): boolean {
  return championProb >= CONTENDER_CHAMPION_PROB
}

export type PredictionVerdict = 'called' | 'better' | 'missed'

/** Grade the frozen pre-tournament prediction ("reach {predicted}") against the
 *  pair's actual run. Resolves only once the pair is done — eliminated (reached
 *  their elimination round) or champion (reached the final) — and returns null
 *  while still active or when there's nothing to grade. Model-only: the user's
 *  vote isn't considered.
 *
 *  - 'called'  — finished exactly at the predicted round
 *  - 'better'  — went deeper than predicted
 *  - 'missed'  — knocked out before the predicted round */
export function predictionVerdict(
  predicted: ProjRound | null | undefined,
  vm: Pick<RoadVM, 'status' | 'eliminatedRound'>,
): PredictionVerdict | null {
  if (!predicted || vm.status === 'active') return null
  const predIdx = ROUND_ORDER.indexOf(predicted)
  if (predIdx < 0) return null
  const reachedIdx =
    vm.status === 'champion'
      ? ROUND_ORDER.indexOf('F')
      : vm.eliminatedRound
      ? ROUND_ORDER.indexOf(vm.eliminatedRound as ProjRound)
      : -1
  if (reachedIdx < 0) return null
  if (reachedIdx === predIdx) return 'called'
  return reachedIdx > predIdx ? 'better' : 'missed'
}

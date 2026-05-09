// src/types/match.ts

export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'cancelled' | 'retired' | 'walkover' | 'suspended'
export type Coverage = 'full' | 'partial' | 'tracking' | null

export interface Player {
  id: string
  external_id: string
  name: string
  display_name?: string | null
  country: string | null
  avatar_url: string | null
  ranking?: number | null
  win_rate?: number | null
  total_matches?: number | null
  side?: string | null
}

/** Returns the preferred display name for a player, falling back to canonical name. */
export function playerDisplayName(p: { name: string; display_name?: string | null }): string {
  return p.display_name?.trim() || p.name
}

export interface Game {
  id: string
  match_id: string
  set_id: string
  game_number: number
  game_score: string | null
  points: string[]
  is_current: boolean
  winner_pair: number | null
  /**
   * Player who served this entire game. Populated by padelgod's live-scoring
   * pipeline (Crionet widget tracks the ball-icon per row to identify the
   * server). NULL for games that ran before padelgod was wired in or for
   * matches without a Crionet mapping.
   */
  server_player_id: string | null
}

export interface Set {
  id: string
  match_id: string
  set_number: number
  set_score: string | null
  pair1_games: number
  pair2_games: number
  is_current: boolean
  games?: Game[]
}

export interface Match {
  id: string
  external_id: string
  status: MatchStatus
  coverage: Coverage
  pusher_channel: string | null
  round: string | null
  court: string | null
  scheduled_at: string | null
  started_at: string | null
  finished_at: string | null
  winner_pair: number | null
  /** Computed schedule hint written by padelgod's schedule-hints-writer.
   *  'may_be_late' = the previous match on this court is running over or
   *  itself delayed. 'starting_soon' = previous match has finished and this
   *  is the immediate next still scheduled. NULL = no hint. Only meaningful
   *  while status === 'scheduled' — UI shows existing chips for other states. */
  late_hint?: 'may_be_late' | 'starting_soon' | null
  serving_player_id?: string | null
  pair1_player1: Player | null
  pair1_player2: Player | null
  pair2_player1: Player | null
  pair2_player2: Player | null
  /** Seed number for pair 1 (1, 2, 3, …). Null when not seeded — only
   *  top 8/16 pairs in the draw get seeded. Sourced from FIP draw page
   *  via padelgod's fip-draw-populator. */
  pair1_seed?: number | null
  pair2_seed?: number | null
  /** 0-based position of this match within its round (0 = top of bracket).
   *  Optional — most rows don't carry this field today; the bracket
   *  builder falls back to sorting matches by widget_id_composite +
   *  external_id when missing. Reserved for future use if a future
   *  migration adds a dedicated column. */
  draw_position?: number | null
  sets?: Set[]
  viewer_count?: number
  avg_rating?: number | null
  rating_count?: number
  // Optional: populated server-side by resolveStreamForMatch for FIP-tier
  // matches that have a YouTube stream (any tier 1-4). Undefined / null on
  // non-FIP matches and on FIP matches we couldn't resolve.
  streamTier?: import('@/lib/fip-stream-resolver').StreamTier | null
}

// ── Warmup detection ──────────────────────────────────────────
// A match is "warming up" when EITHER:
//   (a) Padelgod's live-poller explicitly flagged it `status='on_court'`
//       — widget label is "On court" or "Warming up" (fan-visible signal
//       from the Crionet widget that the match is about to start), OR
//   (b) The match is `status='live'` but no real points have been scored yet
//       — inferred fallback for padelapi-sourced matches that skip straight
//       to 'live' without the on_court phase.
export function isWarmingUp(match: Match): boolean {
  if ((match.status as string) === 'on_court') return true
  if (match.status !== 'live') return false
  const sets = match.sets ?? []
  if (sets.length === 0) return true
  const allGames = sets.flatMap((s) => s.games ?? [])
  if (allGames.length === 0) return true
  const allPoints = allGames.flatMap((g) => g.points ?? [])
  if (allPoints.length === 0) return true
  const realPoints = allPoints.filter((p) => p !== '0:0')
  return realPoints.length === 0
}



// ── Current score state for a match ──────────────────────────
export function getCurrentScore(match: Match): {
  pair1Sets: number
  pair2Sets: number
  currentSet: Set | null
  currentGame: Game | null
} {
  const sets = match.sets ?? []
  const completedSets = sets.filter((s) => s.set_score !== null)
  const currentSet = sets.find((s) => s.is_current) ?? null

  const pair1Sets = completedSets.filter((s) => {
    const parsed = parseSetScore(s.set_score)
    return parsed ? parsed.p1 > parsed.p2 : false
  }).length

  const pair2Sets = completedSets.filter((s) => {
    const parsed = parseSetScore(s.set_score)
    return parsed ? parsed.p2 > parsed.p1 : false
  }).length

  const currentGame = currentSet?.games?.find((g) => g.is_current) ?? null

  return { pair1Sets, pair2Sets, currentSet, currentGame }
}

// ── Parse set score ───────────────────────────────────────────
// Handles multiple formats:
// "7-61" (from /live endpoint) → {p1: 7, p2: 6, tb: 1}
// "6(1)" style handled at match level via score array
export function parseSetScore(score: string | null): { p1: number; p2: number; tb: number | null } | null {
  // Handle literal string "null" from API as well as actual null/undefined/empty
  if (!score || score === 'null' || score === 'undefined') return null
  const parts = score.split('-')
  if (parts.length !== 2) return null
  const p1str = parts[0]
  const p2str = parts[1]

  // Format: "6(1)-7" or "7-6(1)" — tiebreak in brackets on either side
  const p1BracketMatch = p1str.match(/^(\d+)\((\d+)\)$/)
  if (p1BracketMatch) {
    return { p1: parseInt(p1BracketMatch[1]), p2: parseInt(p2str), tb: parseInt(p1BracketMatch[2]) }
  }
  const p2BracketMatch = p2str.match(/^(\d+)\((\d+)\)$/)
  if (p2BracketMatch) {
    return { p1: parseInt(p1str), p2: parseInt(p2BracketMatch[1]), tb: parseInt(p2BracketMatch[2]) }
  }

  const p1 = parseInt(p1str)
  const p2 = parseInt(p2str)

  // Format: "65-7" — tiebreak concatenated to p1 (e.g. p1 lost 6-7 with tb=5)
  if (p1str.length >= 2 && p2 <= 7 && p1str.length > String(p2 - 1 > 0 ? p2 - 1 : 0).length) {
    const realP1 = parseInt(p1str[0])
    const tb = parseInt(p1str.slice(1))
    if (realP1 >= 6 && realP1 <= 7 && tb >= 0) {
      return { p1: realP1, p2, tb }
    }
  }

  // Format: "7-61" — tiebreak concatenated to p2 (e.g. p2 lost 6-7 with tb=1)
  if (p2str.length >= 2 && p1 <= 7) {
    const realP2 = parseInt(p2str[0])
    const tb = parseInt(p2str.slice(1))
    if (realP2 >= 6 && realP2 <= 7 && tb >= 0) {
      return { p1, p2: realP2, tb }
    }
  }

  return { p1, p2, tb: null }
}

/**
 * Parse a set's display scores and heal invalid closed-set values in one
 * call. Wrapper around parseSetScore + parseSetFromGames + healClosedSetGames
 * so every call site renders the same numbers without duplicating the
 * (parsed ?? raw, then heal) dance.
 */
export function parseAndHealSet(set: {
  set_score: string | null
  pair1_games: number | null
  pair2_games: number | null
  is_current: boolean
}): { p1: number; p2: number; tb: number | null } {
  const parsed = parseSetScore(set.set_score) ?? parseSetFromGames(set.pair1_games, set.pair2_games)
  const rawP1 = parsed?.p1 ?? set.pair1_games ?? 0
  const rawP2 = parsed?.p2 ?? set.pair2_games ?? 0
  const healed = healClosedSetGames(rawP1, rawP2, !!set.is_current, !!set.set_score)
  return { p1: healed.p1, p2: healed.p2, tb: parsed?.tb ?? null }
}

/**
 * Heal a closed-set games count to a valid final score.
 *
 * Crionet's tournamentlive widget sometimes drops the final game tick — the
 * set goes from "5-3" (in progress, server's last game pending) straight to
 * the next set without us ever seeing "6-3". The padelgod live-poller writes
 * whatever it last saw, leaving the closed set frozen at an invalid score.
 *
 * Heuristic: if a set is no longer current AND set_score is empty AND the
 * games count is below the standard win threshold (6 with at least 2-game
 * margin, OR 7-5, OR 7-6 tiebreak), bump the side with more games to 6
 * (or to 7 if the loser already had 5+). Conservative — only fires when
 * the score is definitively invalid for a completed set.
 */
export function healClosedSetGames(
  p1Games: number,
  p2Games: number,
  isCurrent: boolean,
  hasSetScore: boolean,
): { p1: number; p2: number } {
  if (isCurrent || hasSetScore) return { p1: p1Games, p2: p2Games }
  const max = Math.max(p1Games, p2Games)
  const min = Math.min(p1Games, p2Games)
  // Valid completed sets: 6-{0..4}, 7-5, 7-6 (tb), 10-x (super-tiebreak),
  // or anything with max >= 6 and a 2-game margin.
  const valid =
    (max >= 6 && (max - min >= 2 || (max === 7 && (min === 5 || min === 6)))) ||
    max >= 10
  if (valid) return { p1: p1Games, p2: p2Games }
  // Heal: bump the winning side. If the trailing side already has 5,
  // jump to 7-5 (the other win condition); otherwise to 6.
  const winnerTarget = min >= 5 ? 7 : 6
  return p1Games > p2Games
    ? { p1: winnerTarget, p2: p2Games }
    : { p1: p1Games, p2: winnerTarget }
}

/**
 * Fallback parser when set_score string is unavailable but pair1_games/pair2_games
 * may contain concatenated tiebreak values (e.g. 78 = 7 games, tb 8 vs 66 = 6 games, tb 6).
 * Returns null if the games don't look like a tiebreak set.
 */
export function parseSetFromGames(
  p1Games: number | null | undefined,
  p2Games: number | null | undefined,
): { p1: number; p2: number; tb: number | null } | null {
  if (p1Games == null || p2Games == null) return null
  // Standard sets: both values are 0-7
  if (p1Games <= 7 && p2Games <= 7) return { p1: p1Games, p2: p2Games, tb: null }
  // Concatenated tiebreak: one value is 2 digits starting with 6 or 7
  // e.g. p1=78 → p1 won 7, tb=8; p2=66 → p2 lost 6, tb=6
  const decode = (v: number): { games: number; tb: number } | null => {
    if (v <= 9) return { games: v, tb: 0 }
    const str = String(v)
    const first = parseInt(str[0])
    const rest = parseInt(str.slice(1))
    if ((first === 6 || first === 7) && !isNaN(rest)) return { games: first, tb: rest }
    return null
  }
  const d1 = decode(p1Games)
  const d2 = decode(p2Games)
  if (!d1 || !d2) return null
  // The tb shown as superscript is the loser's tiebreak points (convention).
  // Winner had the higher games (7 vs 6) — the other side's encoded tb is what we display.
  const loserTb = d1.games > d2.games ? d2.tb : d1.tb
  return { p1: d1.games, p2: d2.games, tb: loserTb }
}

export function toShortName(name: string): string {
  const parts = name.trim().split(' ')
  if (parts.length <= 1) return name
  return parts[0][0] + '. ' + parts.slice(1).join(' ')
}

// Last name only for compact pair display — prefers display_name when set
export function pairName(p1: Player | null, p2: Player | null): string {
  if (!p1 && !p2) return 'TBD'
  const n1 = p1 ? (p1.display_name?.trim() || p1.name) : 'TBD'
  const n2 = p2 ? (p2.display_name?.trim() || p2.name) : null
  if (!n2) return toShortName(n1)
  return `${toShortName(n1)} / ${toShortName(n2)}`
}

// ── Unified match display calculation ────────────────────────
//
// Single function every card surface calls to derive what to render from
// a Match row. Consolidates: set ordering, parse + heal, winner inference
// from sets when winner_pair is null, current set/game lookup, last-point
// extraction with the established fallback chain (points[] → game_score →
// '0-0' for live, '' otherwise), serving-pair derivation, and a
// "looks-finished" detector for matches where the upstream pipeline wrote
// per-set scores but missed the status flip.
//
// Returns a flat, render-ready bag of values. By calling this from
// MatchCard, home LiveMatchCard, and match detail, all 4 surfaces stay
// in lock-step on every calculation that affects what fans see.

export interface ParsedSet {
  /** Original set row reference for keys + is_current. */
  raw: Set
  /** Healed games count for pair 1 (closed-set healing applied). */
  p1Games: number
  /** Healed games count for pair 2. */
  p2Games: number
  /** Tiebreak loser-points (superscript), or null when no tiebreak. */
  tb: number | null
  /** Was pair 1 the set winner? Derived from healed games. */
  pair1Won: boolean
  /** Was pair 2 the set winner? */
  pair2Won: boolean
}

export interface MatchDisplay {
  /** Sorted by set_number ascending. */
  sets: ParsedSet[]
  /** 0 = no winner (live/scheduled), 1 = pair 1 won, 2 = pair 2 won.
   *  Falls back to set-count comparison when match.winner_pair is null
   *  and the match looks finished. */
  winner: 0 | 1 | 2
  /** True for status='live' or status='on_court'. */
  isLive: boolean
  /** True for finished/retired/walkover/ended OR scheduled rows whose
   *  per-set scores already prove the match is decided (defensive
   *  detection — covers pipeline gaps where status flip is missed). */
  isFinished: boolean
  /** True only when status='scheduled' AND scores don't look finished. */
  isScheduled: boolean
  /** Currently in-progress set, or null. */
  currentSet: Set | null
  /** Currently in-progress game (within currentSet), or null. When more
   *  than one game briefly carries is_current (relay write race), the
   *  highest game_number wins. */
  currentGame: Game | null
  /** Last point in current game, with fallback chain:
   *    1. games.points[last]
   *    2. games.game_score
   *    3. '0-0' when match is live (so Pts column doesn't blink off
   *       between games), '' otherwise. */
  livePoint: string
  /** Pre-split: ['p1Pts', 'p2Pts'] from livePoint. Empty strings when
   *  not parseable. */
  livePointParts: [string, string]
  /** UUID of the player serving the current game, or null. */
  serverPlayerId: string | null
  /** True if the serving player belongs to pair 1. */
  pair1Serving: boolean
  /** True if the serving player belongs to pair 2. */
  pair2Serving: boolean
  /** Total games won across all sets, per pair (used by score-flash
   *  detection to spot game-level transitions). */
  pair1TotalGames: number
  pair2TotalGames: number
}

export function getMatchDisplay(match: Match): MatchDisplay {
  const isLive = match.status === 'live' || (match.status as string) === 'on_court'

  // Sort once.
  const rawSets = (match.sets ?? []).slice().sort((a, b) => a.set_number - b.set_number)

  // "Looks finished" — sometimes per-set scores land but the status flip
  // is missed. Count set-wins from raw games; if either pair has 2+ AND
  // no set is currently in progress, treat as finished for display.
  const setsLookFinished = (() => {
    if (rawSets.length < 2) return false
    if (rawSets.some((s) => s.is_current)) return false
    let p1 = 0
    let p2 = 0
    for (const s of rawSets) {
      const a = s.pair1_games ?? 0
      const b = s.pair2_games ?? 0
      if (a > b) p1++
      else if (b > a) p2++
    }
    return p1 >= 2 || p2 >= 2
  })()

  const dbScheduled = match.status === 'scheduled'
  const isScheduled = dbScheduled && !setsLookFinished
  const isFinished =
    ['finished', 'retired', 'walkover', 'ended'].includes(match.status as string) ||
    (dbScheduled && setsLookFinished)

  // Parse + heal each set in one pass.
  const sets: ParsedSet[] = rawSets.map((s) => {
    const { p1, p2, tb } = parseAndHealSet({
      set_score: s.set_score,
      pair1_games: s.pair1_games,
      pair2_games: s.pair2_games,
      is_current: s.is_current,
    })
    return {
      raw: s,
      p1Games: p1,
      p2Games: p2,
      tb,
      pair1Won: p1 > p2,
      pair2Won: p2 > p1,
    }
  })

  // Winner: trust the column first, fall back to set-count.
  const winner: 0 | 1 | 2 = (() => {
    if (match.winner_pair === 1) return 1
    if (match.winner_pair === 2) return 2
    if (!isFinished) return 0
    let p1 = 0
    let p2 = 0
    for (const s of sets) {
      if (s.pair1Won) p1++
      else if (s.pair2Won) p2++
    }
    if (p1 === p2) return 0
    return p1 > p2 ? 1 : 2
  })()

  const currentSet = rawSets.find((s) => s.is_current) ?? null

  // Multiple is_current games can briefly coexist during relay writes —
  // pick the highest game_number to skip the stale one.
  const currentGames = (currentSet?.games ?? []).filter((g) => g.is_current)
  const currentGame =
    currentGames.length > 0
      ? currentGames.reduce((latest, g) =>
          (g.game_number ?? 0) > (latest.game_number ?? 0) ? g : latest,
        )
      : null

  const livePointRaw = currentGame?.points?.length
    ? currentGame.points[currentGame.points.length - 1]
    : currentGame?.game_score ?? (isLive ? '0-0' : '')
  const livePoint = livePointRaw ?? (isLive ? '0-0' : '')
  const livePointParts: [string, string] = (() => {
    const parts = (livePoint ?? '').split(/[:\-]/)
    return [parts[0] ?? '', parts[1] ?? '']
  })()

  const serverPlayerId =
    isLive
      ? ((currentGame as { server_player_id?: string | null } | null)?.server_player_id ?? null)
      : null
  const pair1Serving =
    !!serverPlayerId &&
    (serverPlayerId === match.pair1_player1?.id ||
      serverPlayerId === match.pair1_player2?.id)
  const pair2Serving =
    !!serverPlayerId &&
    (serverPlayerId === match.pair2_player1?.id ||
      serverPlayerId === match.pair2_player2?.id)

  let pair1TotalGames = 0
  let pair2TotalGames = 0
  for (const s of rawSets) {
    pair1TotalGames += s.pair1_games ?? 0
    pair2TotalGames += s.pair2_games ?? 0
  }

  return {
    sets,
    winner,
    isLive,
    isFinished,
    isScheduled,
    currentSet,
    currentGame,
    livePoint,
    livePointParts,
    serverPlayerId,
    pair1Serving,
    pair2Serving,
    pair1TotalGames,
    pair2TotalGames,
  }
}

// Detects star point — 40:40 that follows at least one advantage point
export function isStarPoint(points: string[]): boolean {
  if (!points.length) return false
  const last = points[points.length - 1]
  if (last !== '40:40') return false
  const hadAdvantage = points.slice(0, -1).some(
    (p) => /^(A|AD):40$/.test(p) || /^40:(A|AD)$/.test(p)
  )
  return hadAdvantage
}

// Compute last N points won across all games in current set
export function getLastNPoints(
  currentSet: Set | null,
  n: number = 10
): { winner: 1 | 2 }[] {
  if (!currentSet) return []

  const allPoints: { winner: 1 | 2 }[] = []
  const games = [...(currentSet.games ?? [])].sort((a, b) => a.game_number - b.game_number)

  for (const game of games) {
    const pts = game.points ?? []
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1]
      const curr = pts[i]
      if (prev === curr) continue

      const prevParts = prev.split(':')
      const currParts = curr.split(':')

      const adv = (s: string) => s === 'A' || s === 'AD'
      const p1Prev = adv(prevParts[0]) ? 50 : prevParts[0] === '40' ? 40 : parseInt(prevParts[0])
      const p2Prev = adv(prevParts[1]) ? 50 : prevParts[1] === '40' ? 40 : parseInt(prevParts[1])
      const p1Curr = adv(currParts[0]) ? 50 : currParts[0] === '40' ? 40 : parseInt(currParts[0])
      const p2Curr = adv(currParts[1]) ? 50 : currParts[1] === '40' ? 40 : parseInt(currParts[1])

      if (p1Curr > p1Prev) allPoints.push({ winner: 1 })
      else if (p2Curr > p2Prev) allPoints.push({ winner: 2 })
    }

    if (pts.length > 0 && game.game_score && game.game_score !== '0-0' && !game.is_current) {
      const lastPt = pts[pts.length - 1]
      const parts = lastPt.split(':')
      const adv2 = (s: string) => s === 'A' || s === 'AD'
      const p1 = adv2(parts[0]) ? 50 : parseInt(parts[0])
      const p2 = adv2(parts[1]) ? 50 : parseInt(parts[1])
      if (p1 >= 40 && p2 < 40) allPoints.push({ winner: 1 })
      else if (p2 >= 40 && p1 < 40) allPoints.push({ winner: 2 })
      else if (adv2(parts[0])) allPoints.push({ winner: 1 })
      else if (adv2(parts[1])) allPoints.push({ winner: 2 })
    }
  }

  return allPoints.slice(-n)
}

// 3-letter ISO 3166-1 alpha-3 → 2-letter alpha-2. Kept inline here
// (not imported from player-resolver.ts) because match.ts is consumed
// by the browser bundle and we want the mapping tree-shakable. Covers
// the 3-letter codes that actually appear in our `players.country`
// column today, plus a handful of common non-ISO aliases that the FIP
// search API occasionally emits (POR, NED, DEN, SUI, CRO, RSA …).
const CC3_TO_CC2: Record<string, string> = {
  ESP: 'ES', ARG: 'AR', BRA: 'BR', PRT: 'PT', POR: 'PT', FRA: 'FR',
  ITA: 'IT', BEL: 'BE', NLD: 'NL', NED: 'NL', DEU: 'DE', GER: 'DE',
  GBR: 'GB', DNK: 'DK', DEN: 'DK', SWE: 'SE', URY: 'UY', URU: 'UY',
  PRY: 'PY', PAR: 'PY', CHL: 'CL', CHI: 'CL', MEX: 'MX', USA: 'US',
  AUS: 'AU', QAT: 'QA', ARE: 'AE', UAE: 'AE', EGY: 'EG', COL: 'CO',
  PER: 'PE', CRI: 'CR', CRC: 'CR', FIN: 'FI', NOR: 'NO', POL: 'PL',
  AUT: 'AT', CHE: 'CH', SUI: 'CH', GRC: 'GR', GRE: 'GR', SAU: 'SA',
  JPN: 'JP', KOR: 'KR', CHN: 'CN', IND: 'IN', MAR: 'MA', ZAF: 'ZA',
  RSA: 'ZA', IRL: 'IE', CZE: 'CZ', HRV: 'HR', CRO: 'HR', BHR: 'BH',
  KWT: 'KW', ECU: 'EC', ROU: 'RO', UKR: 'UA', BOL: 'BO',
}

// Country code → flag emoji. Accepts both 2-letter (alpha-2) and
// 3-letter (alpha-3) ISO codes — our `players.country` column today
// has a mix: padelapi sync writes alpha-2 ("ES"), FIP-search + FIP
// PDF pipeline write alpha-3 ("ESP"). Verified distribution at
// audit time: 13 alpha-2, 162 alpha-3 across 175 Brussels players.
// Before this change, only alpha-2 rendered flags — the alpha-3 rows
// fell through to '' and the MatchCard showed no flag.
export function countryFlag(country: string | null): string {
  if (!country) return ''
  const up = country.trim().toUpperCase()
  const cc2 = up.length === 2 ? up : CC3_TO_CC2[up] ?? up
  const flags: Record<string, string> = {
    ES: '🇪🇸', AR: '🇦🇷', BR: '🇧🇷', PT: '🇵🇹',
    FR: '🇫🇷', IT: '🇮🇹', BE: '🇧🇪', NL: '🇳🇱',
    DE: '🇩🇪', GB: '🇬🇧', DK: '🇩🇰', SE: '🇸🇪',
    UY: '🇺🇾', PY: '🇵🇾', CL: '🇨🇱', MX: '🇲🇽',
    US: '🇺🇸', AU: '🇦🇺', QA: '🇶🇦', AE: '🇦🇪',
    EG: '🇪🇬', CO: '🇨🇴', PE: '🇵🇪', CR: '🇨🇷',
    FI: '🇫🇮', NO: '🇳🇴', PL: '🇵🇱', AT: '🇦🇹',
    CH: '🇨🇭', GR: '🇬🇷', SA: '🇸🇦', JP: '🇯🇵',
    KR: '🇰🇷', CN: '🇨🇳', IN: '🇮🇳', MA: '🇲🇦',
    ZA: '🇿🇦', IE: '🇮🇪', CZ: '🇨🇿', HR: '🇭🇷',
    BH: '🇧🇭', KW: '🇰🇼', EC: '🇪🇨', RO: '🇷🇴',
    UA: '🇺🇦', BO: '🇧🇴',
  }
  return flags[cc2] ?? ''
}

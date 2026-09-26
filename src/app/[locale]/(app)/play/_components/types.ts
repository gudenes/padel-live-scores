// src/app/[locale]/(app)/play/_components/types.ts
//
// The Play API contract, as consumed by the UI.
//
// Every number that represents a probability or a share price is carried in
// 0..1 here — that is what `markets.seed_prob` and `market_trades.price` are
// in the database (both numeric(_,4) constrained to that range), and what
// src/lib/lmsr.ts::priceYes returns. The UI multiplies by 100 only at the
// point of display.
//
// `toProb` below is the one concession to defensive parsing: if an endpoint
// ever hands back 38 instead of 0.38 the card would otherwise render "3800%".
// It is a display guard, not a licence to invent values — a missing or
// unparseable price makes the market unusable and it gets dropped.

export type MarketHorizon = 'live' | 'match' | 'tourn' | 'season'
export type Side = 'yes' | 'no'
export type TradeDirection = 'buy' | 'sell'
export type LeaderPeriod = 'week' | 'season' | 'all'
export type PositionFilter = 'open' | 'resolved' | 'history'

/**
 * A player's recent record, from `GET /api/play/markets`.
 *
 * `streak` is one 'W' or 'L' per sampled match, NEWEST FIRST. `of` is the
 * sample size, not always 5 — a player with four matches in the window reports
 * four, and the copy names the real denominator.
 */
export interface PlayForm {
  wins: number
  of: number
  streak: string
}

/**
 * One of the four players on a card.
 *
 * `winRate` / `totalMatches` / `titles` are NULL for plenty of real players
 * (padelapi doesn't have them for everyone). Null means unknown — render
 * nothing. A 0 would be a claim we cannot make.
 */
export interface PlayPlayer {
  id: string | null
  /** Fan-facing full name, e.g. "Jessica Castello". */
  name: string
  /** Surname only. */
  surname: string
  avatarUrl: string | null
  /** ISO alpha-2. */
  country: string | null
  ranking: number | null
  raceRanking: number | null
  winRate: number | null
  totalMatches: number | null
  titles: number | null
  form: PlayForm | null
}

export interface PlayPlayers {
  pair1: PlayPlayer[]
  pair2: PlayPlayer[]
}

/** Head-to-head. `{0,0}` is the common, real answer: they have never met. */
export interface PlayHeadToHead {
  pair1Wins: number
  pair2Wins: number
}

/** One card in the deck. `GET /api/play/markets`. */
export interface PlayMarket {
  book?: { qYes: number; qNo: number; b: number } | null
  id: string
  publicId: string
  question: string
  horizon: MarketHorizon
  /** Short breadcrumb, e.g. "Madrid P1 · Men · Final". */
  context: string
  /** Second line under the question, e.g. the two pairs. */
  subtitle: string
  /** Crowd price for YES, 0..1. */
  priceYes: number
  /** Our Elo model's probability for YES, 0..1. */
  modelProb: number
  live: boolean
  /** e.g. "Set 1 · 4–4". Free text from the API. */
  stateLabel: string
  locksAt: string | null
  volumeGuacas: number
  monogram: { a: string; b: string }
  /**
   * Who is playing. Null on tournament/season markets, which have no match —
   * those cards fall back to the monogram.
   */
  players: PlayPlayers | null
  /** Null when not computed (no match, or the lookup failed) — omit the row. */
  h2h: PlayHeadToHead | null
  /**
   * Which pair the question names — the SUBJECT of "will they win".
   *
   * Drives the card's two-colour language: the subject pair (and the YES
   * block, which is a bet on them) is orange; the other pair (and NO) is lime.
   * A market whose template asks about pair two carries 2 here, and without it
   * the card would paint every such market's colours the wrong way round.
   */
  subjectPair: 1 | 2
  /**
   * Optional crowd-price series, oldest → newest, 0..1. The documented
   * contract does not include it today; when it is absent the sparkline
   * draws the single real price we do have rather than inventing a walk.
   */
  history?: number[]
}

/** One row of `GET /api/play/me` → `positions`. */
export interface PlayPosition {
  marketId: string
  publicId: string
  question: string
  context: string
  live: boolean
  /** Mirrors `markets.status`. */
  status: string
  side: Side
  shares: number
  /** Guacas spent. */
  costBasis: number
  /** Average entry price, 0..1. */
  avgPrice: number
  /** Latest market price for the held side, 0..1. */
  currentPrice: number
  /** Mark-to-market value in guacas. */
  valueNow: number
  /** Percentage P&L, already computed server-side. */
  deltaPct: number
}

/** `GET /api/play/me`. */
export interface PlayMe {
  balance: number
  locked: number
  netWorth: number
  positions: PlayPosition[]
}

/** One row of `GET /api/play/activity` → `trades`. */
export interface PlayTrade {
  id: string
  displayName: string
  side: Side
  direction: TradeDirection
  /** Execution price, 0..1. */
  price: number
  /** Guacas moved. */
  guacas: number
  question: string
  createdAt: string | null
}

/** One row of `GET /api/play/leaderboard` → `rows` / `me`. */
export interface PlayLeader {
  rank: number
  userId: string | null
  displayName: string
  netWorth: number
  /** Percent, 0..100. Null when the user has no resolved markets yet. */
  accuracy: number | null
  streak: number | null
  /** Rank change since the previous snapshot. */
  move: number | null
  isMe: boolean
}

export interface PlayLeaderboard {
  rows: PlayLeader[]
  me: PlayLeader | null
}

/** `POST /api/play/trade` success shape. */
export interface PlayTradeResult {
  ok: true
  shares: number
  cost: number
  avgPrice: number
  balance: number
  priceYes: number
}

// ── Parsing helpers ─────────────────────────────────────────────
//
// The endpoints are built by another agent against the same written
// contract. These normalisers accept the documented camelCase spelling
// first and the raw snake_case column name as a fallback, so a route that
// forwards a Supabase row verbatim still renders. Nothing here fabricates a
// value: a field that is absent stays absent, and a market missing a price
// is dropped rather than defaulted.

function pick(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = row[k]
    if (v !== undefined && v !== null) return v
  }
  return undefined
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

/** Coerce to a 0..1 probability. Accepts 0..100 percentages defensively. */
export function toProb(v: unknown): number | null {
  const n = asNumber(v)
  if (n === null) return null
  const p = n > 1 ? n / 100 : n
  if (!(p >= 0 && p <= 1)) return null
  return p
}

const HORIZONS: MarketHorizon[] = ['live', 'match', 'tourn', 'season']

/**
 * `market_templates.horizon` is constrained to
 * ('pre-match','tournament','season','roster') — a different vocabulary from
 * the four chips the design specifies. The chip answers "how long is my
 * money committed", so:
 *
 *   pre-match  → Match      (resolves when the match ends)
 *   tournament → Tournament
 *   roster     → Tournament (entry-list markets resolve with the event)
 *   season     → Season
 *
 * 'live' stays in the union for in-match templates, which the schema does
 * not yet have but the design already draws.
 */
function asHorizon(v: unknown): MarketHorizon {
  const s = asString(v).toLowerCase()
  if ((HORIZONS as string[]).includes(s)) return s as MarketHorizon
  if (s === 'tournament' || s === 'roster') return 'tourn'
  return 'match'
}

function asSide(v: unknown): Side {
  return asString(v).toLowerCase() === 'no' ? 'no' : 'yes'
}

/**
 * Which pair the question is about. Defaults to 1 — matching the server's own
 * reading of `resolver_params.pair`, where anything but an explicit 2 is a
 * pair-one market. Accepts the string "2" as well because this parser sits in
 * front of a JSON payload, not the jsonb column.
 */
function asSubjectPair(v: unknown): 1 | 2 {
  return asNumber(v) === 2 ? 2 : 1
}

/** A non-negative integer, or null. Never coerces null/absent to 0. */
function asCount(v: unknown): number | null {
  const n = asNumber(v)
  if (n === null || n < 0) return null
  return Math.round(n)
}

/**
 * Form is dropped wholesale unless the sample is coherent: `of` positive and
 * `wins` inside it. A half-parsed record would render a sentence about a
 * player that no query ever produced.
 */
function asForm(v: unknown): PlayForm | null {
  if (!v || typeof v !== 'object') return null
  const f = v as Record<string, unknown>
  const wins = asCount(pick(f, 'wins'))
  const of = asCount(pick(f, 'of'))
  if (wins === null || of === null || of < 1 || wins > of) return null
  return { wins, of, streak: asString(pick(f, 'streak')).toUpperCase() }
}

function asPlayer(v: unknown): PlayPlayer | null {
  if (!v || typeof v !== 'object') return null
  const p = v as Record<string, unknown>
  const name = asString(pick(p, 'name')).trim()
  if (!name) return null
  const surname = asString(pick(p, 'surname')).trim()
  return {
    id: asString(pick(p, 'id')) || null,
    name,
    // Falling back to the full name keeps the card readable if `surname` ever
    // goes missing; it never invents a shorter form of its own.
    surname: surname || name,
    avatarUrl: asString(pick(p, 'avatarUrl', 'avatar_url')).trim() || null,
    country: asString(pick(p, 'country')).trim().toUpperCase() || null,
    ranking: asCount(pick(p, 'ranking')),
    raceRanking: asCount(pick(p, 'raceRanking', 'race_ranking')),
    winRate: asCount(pick(p, 'winRate', 'win_rate')),
    totalMatches: asCount(pick(p, 'totalMatches', 'total_matches')),
    titles: asCount(pick(p, 'titles')),
    form: asForm(pick(p, 'form')),
  }
}

function asPlayers(v: unknown): PlayPlayers | null {
  if (!v || typeof v !== 'object') return null
  const raw = v as Record<string, unknown>
  const side = (key: string): PlayPlayer[] => {
    const arr = raw[key]
    if (!Array.isArray(arr)) return []
    return arr.map(asPlayer).filter((p): p is PlayPlayer => p !== null)
  }
  const pair1 = side('pair1')
  const pair2 = side('pair2')
  if (pair1.length === 0 && pair2.length === 0) return null
  return { pair1, pair2 }
}

function asHeadToHead(v: unknown): PlayHeadToHead | null {
  if (!v || typeof v !== 'object') return null
  const h = v as Record<string, unknown>
  const pair1Wins = asCount(pick(h, 'pair1Wins', 'pair1_wins'))
  const pair2Wins = asCount(pick(h, 'pair2Wins', 'pair2_wins'))
  // 0 survives `pick` and `asCount`, so a genuine 0/0 parses as "never met".
  // Both sides unreadable means the endpoint sent us something else entirely.
  if (pair1Wins === null && pair2Wins === null) return null
  return { pair1Wins: pair1Wins ?? 0, pair2Wins: pair2Wins ?? 0 }
}

function asBook(value: unknown): PlayMarket['book'] {
  if (!value || typeof value !== 'object') return null
  const r = value as Record<string, unknown>
  const qYes = asNumber(r.qYes), qNo = asNumber(r.qNo), b = asNumber(r.b)
  return qYes !== null && qNo !== null && b !== null && b > 0 ? { qYes, qNo, b } : null
}

export function parseMarkets(payload: unknown): PlayMarket[] {
  const raw = (payload as { markets?: unknown })?.markets
  if (!Array.isArray(raw)) return []
  const out: PlayMarket[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const id = asString(pick(r, 'id'))
    const priceYes = toProb(pick(r, 'priceYes', 'price_yes'))
    if (!id || priceYes === null) continue
    const mono = (pick(r, 'monogram') ?? {}) as Record<string, unknown>
    const historyRaw = pick(r, 'history', 'priceHistory', 'price_history')
    const history = Array.isArray(historyRaw)
      ? historyRaw.map(toProb).filter((n): n is number => n !== null)
      : undefined
    out.push({
      id,
      book: asBook(r.book),
      publicId: asString(pick(r, 'publicId', 'public_id'), id),
      question: asString(pick(r, 'question')),
      horizon: asHorizon(pick(r, 'horizon')),
      context: asString(pick(r, 'context')),
      subtitle: asString(pick(r, 'subtitle')),
      priceYes,
      modelProb: toProb(pick(r, 'modelProb', 'model_prob')) ?? priceYes,
      live: pick(r, 'live') === true,
      stateLabel: asString(pick(r, 'stateLabel', 'state_label')),
      locksAt: asString(pick(r, 'locksAt', 'locks_at')) || null,
      volumeGuacas: asNumber(pick(r, 'volumeGuacas', 'volume_guacas')) ?? 0,
      monogram: { a: asString(mono.a), b: asString(mono.b) },
      players: asPlayers(pick(r, 'players')),
      h2h: asHeadToHead(r.h2h ?? r.head_to_head),
      subjectPair: asSubjectPair(pick(r, 'subjectPair', 'subject_pair')),
      history: history && history.length > 1 ? history : undefined,
    })
  }
  return out
}

export function parseMe(payload: unknown): PlayMe {
  const r = (payload ?? {}) as Record<string, unknown>
  const rawPositions = pick(r, 'positions')
  const positions: PlayPosition[] = []
  if (Array.isArray(rawPositions)) {
    for (const item of rawPositions) {
      if (!item || typeof item !== 'object') continue
      const p = item as Record<string, unknown>
      const avgPrice = toProb(pick(p, 'avgPrice', 'avg_price'))
      const currentPrice = toProb(pick(p, 'currentPrice', 'current_price'))
      const marketId = asString(pick(p, 'marketId', 'market_id'))
      if (!marketId || avgPrice === null) continue
      positions.push({
        marketId,
        publicId: asString(pick(p, 'publicId', 'public_id'), marketId),
        question: asString(pick(p, 'question')),
        context: asString(pick(p, 'context')),
        live: pick(p, 'live') === true,
        status: asString(pick(p, 'status'), 'open'),
        side: asSide(pick(p, 'side')),
        shares: asNumber(pick(p, 'shares')) ?? 0,
        costBasis: asNumber(pick(p, 'costBasis', 'cost_basis')) ?? 0,
        avgPrice,
        currentPrice: currentPrice ?? avgPrice,
        valueNow: asNumber(pick(p, 'valueNow', 'value_now')) ?? 0,
        deltaPct: asNumber(pick(p, 'deltaPct', 'delta_pct')) ?? 0,
      })
    }
  }
  return {
    balance: asNumber(pick(r, 'balance')) ?? 0,
    locked: asNumber(pick(r, 'locked')) ?? 0,
    netWorth: asNumber(pick(r, 'netWorth', 'net_worth')) ?? 0,
    positions,
  }
}

export function parseActivity(payload: unknown): PlayTrade[] {
  const raw = (payload as { trades?: unknown })?.trades
  if (!Array.isArray(raw)) return []
  const out: PlayTrade[] = []
  raw.forEach((item, i) => {
    if (!item || typeof item !== 'object') return
    const r = item as Record<string, unknown>
    const price = toProb(pick(r, 'price'))
    if (price === null) return
    out.push({
      id: asString(pick(r, 'id'), `t${i}`),
      displayName: asString(pick(r, 'displayName', 'display_name', 'userName', 'user_name')),
      side: asSide(pick(r, 'side')),
      direction: asString(pick(r, 'direction')).toLowerCase() === 'sell' ? 'sell' : 'buy',
      price,
      guacas: Math.abs(asNumber(pick(r, 'guacas', 'costGuacas', 'cost_guacas')) ?? 0),
      question: asString(pick(r, 'question')),
      createdAt: asString(pick(r, 'createdAt', 'created_at')) || null,
    })
  })
  return out
}

export function parseLeaderboard(payload: unknown): PlayLeaderboard {
  const r = (payload ?? {}) as Record<string, unknown>

  const one = (item: unknown, fallbackRank: number, isMe: boolean): PlayLeader | null => {
    if (!item || typeof item !== 'object') return null
    const l = item as Record<string, unknown>
    return {
      rank: asNumber(pick(l, 'rank')) ?? fallbackRank,
      userId: asString(pick(l, 'userId', 'user_id')) || null,
      displayName: asString(pick(l, 'displayName', 'display_name')),
      netWorth: asNumber(pick(l, 'netWorth', 'net_worth')) ?? 0,
      accuracy: asNumber(pick(l, 'accuracy')),
      streak: asNumber(pick(l, 'streak')),
      move: asNumber(pick(l, 'move')),
      isMe: isMe || pick(l, 'isMe') === true,
    }
  }

  const rawRows = pick(r, 'rows')
  const rows: PlayLeader[] = []
  if (Array.isArray(rawRows)) {
    rawRows.forEach((item, i) => {
      const parsed = one(item, i + 1, false)
      if (parsed) rows.push(parsed)
    })
  }
  return { rows, me: one(pick(r, 'me'), rows.length + 1, true) }
}

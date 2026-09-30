// src/app/api/play/_shared.ts
//
// Shared plumbing for the /api/play/* user-facing routes: row shapes, the
// market SELECT, presentation derivation, and balance bootstrap.
//
// Underscore-prefixed so it is obvious this is not a route handler — same
// convention as src/app/api/_auth.ts.
//
// ── Three things to know before editing anything here ───────────────────
//
// 1. RLS IS DEAD for every per-user Play table. The app authenticates with
//    Auth.js, so `auth.uid()` is NULL and every own-rows policy in
//    20260923120200_play_market_ledger.sql denies. Everything runs on the
//    service-role client, which BYPASSES RLS. A missing `.eq('user_id', …)`
//    is therefore not a bug that returns nothing — it returns everyone.
//
// 2. `q_yes` / `q_no` ARE NOT SHARE COUNTS. seedShares() returns NEGATIVE q
//    for a seed probability below 0.5 (qYes = b·ln p). They are LMSR state,
//    never a holding. Ownership lives in `market_positions` and nowhere else.
//
// 3. PostgREST returns `numeric` as a STRING. Every numeric column below
//    (lmsr_b, seed_prob, q_yes, q_no, shares, price, pred_pair1_prob) arrives
//    as `string | number`. Coerce once, at the boundary, via num().

import type { EditorialView } from '../../../../shared/play-editorial-view'
import { editorialKind } from './_editorial'
import { priceYes } from '@/lib/lmsr'
import { roundKey, type RoundKey } from '@/lib/match-quality'
import { lastName } from '@/lib/player-name'
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Locale ─────────────────────────────────────────────────────────────

export const PLAY_LOCALES = ['en', 'es', 'pt', 'it', 'fr'] as const
export type PlayLocale = (typeof PLAY_LOCALES)[number]

export function parseLocale(raw: string | null): PlayLocale {
  return (PLAY_LOCALES as readonly string[]).includes(raw ?? '')
    ? (raw as PlayLocale)
    : 'en'
}

// ── Uniform "you cannot see this" response ─────────────────────────────

/**
 * The ONLY failure response a caller without access may receive.
 *
 * Never 401 and never 403: a distinguishable status tells a non-whitelisted
 * user that the feature exists and that they are merely excluded, which is
 * exactly what the allowlist is meant to hide. Logged out, flag off, and not
 * invited must be indistinguishable from "no such route".
 */
export function playNotFound(): Response {
  return Response.json({ error: 'not_found' }, { status: 404 })
}

// ── Numeric coercion ───────────────────────────────────────────────────

/** Coerce a PostgREST numeric (string | number | null) to a finite number. */
export function num(v: string | number | null | undefined, fallback = 0): number {
  if (v === null || v === undefined) return fallback
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

// ── Row shapes ─────────────────────────────────────────────────────────
//
// The Play tables postdate the generated Supabase types, so supabase-js
// resolves these selects to `GenericStringError`. We declare the shapes once
// and cast at the query boundary rather than scattering `any`.

export interface PlayerJoin {
  name: string | null
  display_name: string | null
  /**
   * Identity + decision-signal columns.
   *
   * Optional rather than required because `PlayerJoin` is also the shape the
   * unit tests build by hand, and because three of them are genuinely NULL in
   * production for real players (Agueda Perez has no win_rate / total_matches
   * / titles). MARKET_SELECT always asks for all of them; a NULL means "we do
   * not know", and the UI must render nothing rather than a zero.
   */
  id?: string | null
  country?: string | null
  ranking?: number | null
  race_ranking?: number | null
  win_rate?: number | null
  total_matches?: number | null
  titles?: number | null
  avatar_url?: string | null
}

export interface TournamentJoin {
  cover_image_url?: string | null
  name: string | null
  level: string | null
}

export interface MatchJoin {
  id: string
  status: string | null
  round: string | null
  scheduled_at: string | null
  category: string | null
  pred_pair1_prob: string | number | null
  /**
   * The four player FKs, selected alongside the embeds so the signal queries
   * in _signals.ts can build their id set from plain columns. Optional for the
   * same reason as the PlayerJoin additions above.
   */
  pair1_player1_id?: string | null
  pair1_player2_id?: string | null
  pair2_player1_id?: string | null
  pair2_player2_id?: string | null
  pair1_player1_name: string | null
  pair1_player2_name: string | null
  pair2_player1_name: string | null
  pair2_player2_name: string | null
  pair1_player1: PlayerJoin | null
  pair1_player2: PlayerJoin | null
  pair2_player1: PlayerJoin | null
  pair2_player2: PlayerJoin | null
  tournament: TournamentJoin | null
}

export interface TemplateJoin {
  question_i18n: Record<string, string> | null
  horizon: string | null
}

export interface MarketRow {
  resolver_key?: string
  id: string
  public_id: string
  season_id: string
  template_id: string
  match_id: string | null
  tournament_id: string | null
  category: string | null
  tokens: Record<string, unknown> | null
  question_snapshot?: Record<string,string> | null
  rules_snapshot?: Record<string,string> | null
  resolver_params: Record<string, unknown> | null
  lmsr_b: string | number
  seed_prob: string | number
  /**
   * Frozen `market_templates.seed_source`. Decides whether `seed_prob` is a
   * model opinion or a measured historical base rate — see modelProbFor /
   * baselineProbFor. Nullable here only because it is read from a row the
   * generated Supabase types do not cover.
   */
  seed_source: string | null
  q_yes: string | number
  q_no: string | number
  volume_guacas: string | number
  position_count: number
  status: string
  locks_at: string
  outcome: boolean | null
  template: TemplateJoin | null
  match: MatchJoin | null
  tournament: TournamentJoin | null
}

export interface PositionRow {
  market_id: string
  user_id: string
  yes_shares: string | number
  no_shares: string | number
  cost_basis: number
  realised_pnl: number
}

export interface BalanceRow {
  user_id: string
  season_id: string
  balance: number
  locked: number
}

/**
 * Embedded-resource aliases use explicit FK constraint names because
 * `matches` has four separate foreign keys into `players` — PostgREST cannot
 * disambiguate them from the table name alone.
 *
 * `matches.*_name` columns are selected as a FALLBACK ONLY. They are
 * frequently NULL (the draw populator fills them opportunistically), so the
 * `players` join is the primary source of a player's name.
 */
const PLAYER_FIELDS =
  'id, name, display_name, country, ranking, race_ranking, win_rate, total_matches, titles, avatar_url'

export const MARKET_SELECT = `
  id, public_id, season_id, template_id, match_id, tournament_id, category,
  tokens, question_snapshot, rules_snapshot, resolver_key, resolver_params, lmsr_b, seed_prob, seed_source, q_yes, q_no,
  volume_guacas, position_count, status, locks_at, outcome,
  template:market_templates!markets_template_id_fkey(question_i18n, horizon),
  match:matches!markets_match_id_fkey(
    id, status, round, scheduled_at, category, pred_pair1_prob,
    pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id,
    pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name,
    pair1_player1:players!matches_pair1_player1_id_fkey(${PLAYER_FIELDS}),
    pair1_player2:players!matches_pair1_player2_id_fkey(${PLAYER_FIELDS}),
    pair2_player1:players!matches_pair2_player1_id_fkey(${PLAYER_FIELDS}),
    pair2_player2:players!matches_pair2_player2_id_fkey(${PLAYER_FIELDS}),
    tournament:tournaments(name, level)
  ),
  tournament:tournaments!markets_tournament_id_fkey(name, level, cover_image_url)
`.replace(/\s+/g, ' ').trim()

/** The four player slots of a match, in `(pair, index)` order. */
export const PLAYER_SLOTS = [
  'pair1_player1',
  'pair1_player2',
  'pair2_player1',
  'pair2_player2',
] as const

export type PlayerSlot = (typeof PLAYER_SLOTS)[number]

/**
 * Every resolved player UUID on a match, in slot order.
 *
 * Reads the FK column first and the embed second: the column is the identifier
 * of record, the embed merely carries the row it points at.
 */
export function matchPlayerIds(match: MatchJoin | null): (string | null)[] {
  if (!match) return [null, null, null, null]
  return PLAYER_SLOTS.map(
    (slot) => match[`${slot}_id`] ?? match[slot]?.id ?? null,
  )
}

// ── Name derivation ────────────────────────────────────────────────────

/** Surname from a joined player, preferring the fan-facing display_name. */
function playerSurname(p: PlayerJoin | null, denormalised: string | null): string {
  const full = p?.display_name?.trim() || p?.name?.trim() || denormalised?.trim() || ''
  return lastName(full)
}

/** "Coello / Tapia", or '' when neither player resolved. */
function pairLabel(a: string, b: string): string {
  return [a, b].filter(Boolean).join(' / ')
}

interface PairNames {
  pair1: string
  pair2: string
  monogram: { a: string; b: string }
}

/**
 * Last-ditch labels when all four player FKs AND all four denormalised name
 * columns are NULL. Not expected in practice: the generator refuses to create
 * a market without a model probability, which requires ranked, resolved
 * players. We still never render "?" — an unnamed pair gets a neutral label
 * rather than a broken-looking placeholder.
 */
const FALLBACK_PAIR_1 = 'Pair 1'
const FALLBACK_PAIR_2 = 'Pair 2'

function derivePairNames(match: MatchJoin | null): PairNames {
  const p1a = playerSurname(match?.pair1_player1 ?? null, match?.pair1_player1_name ?? null)
  const p1b = playerSurname(match?.pair1_player2 ?? null, match?.pair1_player2_name ?? null)
  const p2a = playerSurname(match?.pair2_player1 ?? null, match?.pair2_player1_name ?? null)
  const p2b = playerSurname(match?.pair2_player2 ?? null, match?.pair2_player2_name ?? null)

  const pair1 = pairLabel(p1a, p1b)
  const pair2 = pairLabel(p2a, p2b)

  // Monogram: one initial per player. A pair with only one resolved player
  // yields a single letter rather than padding with a filler character.
  const initials = (a: string, b: string, fallback: string) => {
    const s = [a, b].filter(Boolean).map((n) => n[0]!.toUpperCase()).join('')
    return s || fallback
  }

  return {
    pair1: pair1 || FALLBACK_PAIR_1,
    pair2: pair2 || FALLBACK_PAIR_2,
    monogram: { a: initials(p1a, p1b, 'P1'), b: initials(p2a, p2b, 'P2') },
  }
}

// ── Player identity ────────────────────────────────────────────────────

/** A player's recent record. Built in _signals.ts, carried on MarketView. */
export interface PlayerForm {
  /** Wins inside the sample. */
  wins: number
  /** Matches sampled — at most 5, fewer when the player has played fewer. */
  of: number
  /** One 'W' or 'L' per sampled match, NEWEST FIRST. */
  streak: string
}

/** Head-to-head between the market's two pairs. Zeroes mean "never met". */
export interface HeadToHead {
  pair1Wins: number
  pair2Wins: number
}

/**
 * One of the four players on the card.
 *
 * `winRate` / `totalMatches` / `titles` come from padelapi and are NULL for
 * plenty of real players — they stay null here and the UI omits the row. A 0%
 * win rate and "no data" are not the same claim.
 */
export interface MarketPlayerView {
  id: string | null
  /** Fan-facing full name, e.g. "Jessica Castello". */
  name: string
  /** Surname only — what the card has room for. */
  surname: string
  avatarUrl: string | null
  /** ISO alpha-2 as stored on `players.country`. */
  country: string | null
  ranking: number | null
  raceRanking: number | null
  winRate: number | null
  totalMatches: number | null
  titles: number | null
  form: PlayerForm | null
}

export interface MarketPlayers {
  pair1: MarketPlayerView[]
  pair2: MarketPlayerView[]
}

/**
 * Signals fetched once for a whole page of markets and handed to
 * describeMarket, keyed so one lookup serves every row. See _signals.ts for
 * why these are never fetched per market.
 */
export interface MarketEnrichment {
  editorial?: Map<string, EditorialView>
  /** player UUID → recent form. */
  form?: Map<string, PlayerForm>
  /** market UUID → head-to-head. */
  h2h?: Map<string, HeadToHead>
}

function playerView(
  p: PlayerJoin | null,
  id: string | null,
  denormalised: string | null,
  form?: Map<string, PlayerForm>,
): MarketPlayerView | null {
  const name = p?.display_name?.trim() || p?.name?.trim() || denormalised?.trim() || ''
  if (!name) return null
  const pid = id ?? p?.id ?? null
  return {
    id: pid,
    name,
    surname: lastName(name),
    avatarUrl: p?.avatar_url?.trim() || null,
    country: p?.country?.trim() || null,
    ranking: p?.ranking ?? null,
    raceRanking: p?.race_ranking ?? null,
    winRate: p?.win_rate ?? null,
    totalMatches: p?.total_matches ?? null,
    titles: p?.titles ?? null,
    form: (pid && form?.get(pid)) || null,
  }
}

/**
 * The two pairs, or null when the market has no match (tournament- and
 * season-horizon markets) or when not one of the four players resolved.
 */
function derivePlayers(
  match: MatchJoin | null,
  form?: Map<string, PlayerForm>,
): MarketPlayers | null {
  if (!match) return null
  const ids = matchPlayerIds(match)
  const views = PLAYER_SLOTS.map((slot, i) =>
    playerView(match[slot] ?? null, ids[i] ?? null, match[`${slot}_name`] ?? null, form),
  )
  const pair1 = views.slice(0, 2).filter((v): v is MarketPlayerView => v !== null)
  const pair2 = views.slice(2, 4).filter((v): v is MarketPlayerView => v !== null)
  if (pair1.length === 0 && pair2.length === 0) return null
  return { pair1, pair2 }
}

// ── Question rendering ─────────────────────────────────────────────────

/**
 * The context line ("Madrid P1 · Women · Semifinal") is built here, server-side,
 * so it must be localized here — the client renders it verbatim on the card,
 * the trade sheet and the positions list.
 */
const CATEGORY_LABEL: Record<PlayLocale, Record<string, string>> = {
  en: { men: 'Men', women: 'Women' },
  es: { men: 'Masculino', women: 'Femenino' },
  pt: { men: 'Masculino', women: 'Feminino' },
  it: { men: 'Maschile', women: 'Femminile' },
  fr: { men: 'Hommes', women: 'Femmes' },
}

/** '' for an unrecognised round — a placeholder is not information. */
const ROUND_LABEL: Record<PlayLocale, Record<RoundKey, string>> = {
  en: { final: 'Final', sf: 'Semifinal', qf: 'Quarterfinal', r16: 'R16', r32: 'R32', r64: 'R64', r128: 'R128', q: 'Qualifying', unknown: '' },
  es: { final: 'Final', sf: 'Semifinal', qf: 'Cuartos de final', r16: 'Octavos', r32: 'Dieciseisavos', r64: 'R64', r128: 'R128', q: 'Previa', unknown: '' },
  pt: { final: 'Final', sf: 'Semifinal', qf: 'Quartas de final', r16: 'Oitavas', r32: 'R32', r64: 'R64', r128: 'R128', q: 'Qualifying', unknown: '' },
  it: { final: 'Finale', sf: 'Semifinale', qf: 'Quarti di finale', r16: 'Ottavi', r32: 'Sedicesimi', r64: 'R64', r128: 'R128', q: 'Qualificazioni', unknown: '' },
  fr: { final: 'Finale', sf: 'Demi-finale', qf: 'Quart de finale', r16: 'Huitièmes', r32: 'Seizièmes', r64: 'R64', r128: 'R128', q: 'Qualifications', unknown: '' },
}

export function categoryLabel(category: string, locale: PlayLocale): string {
  return CATEGORY_LABEL[locale][category] ?? CATEGORY_LABEL.en[category] ?? category
}

export function playRoundLabel(raw: string | null | undefined, locale: PlayLocale): string {
  return raw ? ROUND_LABEL[locale][roundKey(raw)] : ''
}

/**
 * Substitute `{token}` placeholders in a template question.
 *
 * `markets.tokens` is the intended source, but padelgod's market-generator
 * currently writes `tokens: {}` for every row (buildMarketRow in
 * padelgod/src/workers/market-generator.ts). Reading tokens first keeps this
 * forward-compatible for when the generator starts populating it; the derived
 * values below are what actually renders today.
 *
 * An unresolvable placeholder is stripped rather than left as literal
 * "{pair1}" — a slightly clipped sentence beats leaking template syntax.
 */
function renderQuestion(
  template: string,
  tokens: Record<string, unknown> | null,
  derived: Record<string, string>,
): string {
  const out = template.replace(/\{(\w+)\}/g, (_full, key: string) => {
    const fromTokens = tokens?.[key]
    if (typeof fromTokens === 'string' && fromTokens.trim()) return fromTokens.trim()
    return derived[key] ?? ''
  })
  // Collapse the double spaces a stripped placeholder leaves behind.
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([?!.,])/g, '$1').trim()
}

// ── Market presentation ────────────────────────────────────────────────

export interface MarketView {
  editorial?: EditorialView | null
  id: string
  publicId: string
  question: string
  rules?: string | null
  horizon: string
  context: string
  subtitle: string
  priceYes: number
  modelProb: number | null
  /**
   * The HISTORICAL base rate a `seed_source='fixed'` market opened at, 0..1.
   * Null on every other market.
   *
   * Set-shape markets ("will any set finish 6-0") have no model prediction at
   * all — the Elo model answers a different question. This field exists so the
   * UI can still show the fan a number to anchor against, LABELLED as a
   * historical average. It must never be rendered in the model's visual
   * language: the whole point is that it is a twelve-month average, not a
   * prediction about this match.
   *
   * `modelProb` and `baselineProb` are mutually exclusive by construction.
   */
  baselineProb: number | null
  tournamentImage: string | null
  matchId: string | null
  live: boolean
  stateLabel: string | null
  competition: string | null
  category: string | null
  startsAt: string | null
  locksAt: string
  volumeGuacas: number
  monogram: { a: string; b: string }
  /**
   * Who is playing. Null for tournament/season markets, which have no match —
   * those cards keep the monogram.
   */
  players: MarketPlayers | null
  /**
   * The two pairs' record against each other. `{0,0}` is a real answer and the
   * common one ("never met"); null means we did not compute it (no match, or
   * the lookup failed) and the UI omits the row entirely.
   */
  h2h: HeadToHead | null
  /**
   * Which pair the question is ABOUT — 1 or 2. See subjectPairOf().
   *
   * The server already had to know this to orient `modelProb`; it is exposed
   * because the card colours YES with the subject pair's colour and NO with
   * the other's. Without it the UI would have to assume pair 1, and every
   * `resolver_params.pair === 2` market would render its colours inverted —
   * silently, and only on some markets.
   */
  subjectPair: 1 | 2
}

/**
 * The pair a market's question is about.
 *
 * `market_templates` write the side into `markets.resolver_params.pair`, and
 * everything downstream that is oriented ("will THEY win", the model
 * probability, the YES colour) has to agree on one reading of it. Anything
 * other than an explicit 2 means pair one — a missing or malformed
 * resolver_params is a pair-one market, which is what the generator emits by
 * default.
 */
function subjectPairOf(row: MarketRow): 1 | 2 {
  return row.resolver_params?.pair === 2 ? 2 : 1
}

const LIVE_STATUSES = new Set(['live', 'on_court'])

/** Window before lock in which a scheduled market is flagged as imminent. */
const STARTING_SOON_MS = 60 * 60 * 1000

/**
 * Derive everything the client renders for one market row.
 *
 * `priceYes` is ALWAYS computed from live LMSR state — it is deliberately not
 * a stored column, so there is no way for a cached price to drift from the
 * book that a trade will actually execute against.
 */
export function describeMarket(
  row: MarketRow,
  locale: PlayLocale,
  now: number = Date.now(),
  enrich?: MarketEnrichment,
): MarketView {
  const b = num(row.lmsr_b, 1)
  const pYes = priceYes(num(row.q_yes), num(row.q_no), b)

  const names = derivePairNames(row.match)
  // A match-scoped market reaches its tournament through the match; a
  // tournament-scoped one has the FK directly. The CHECK constraint on
  // `markets` guarantees exactly one of the two is set.
  const tournament = row.match?.tournament ?? row.tournament ?? null

  const i18n = row.question_snapshot ?? row.template?.question_i18n ?? {}
  const rawQuestion = i18n[locale] ?? i18n.en ?? ''
  const question = renderQuestion(rawQuestion, row.tokens, {
    pair1: names.pair1,
    pair2: names.pair2,
    tournament: tournament?.name ?? '',
  })

  const category = row.category ?? row.match?.category ?? null
  const round = playRoundLabel(row.match?.round, locale)
  const context = [
    tournament?.name ?? '',
    category ? categoryLabel(category, locale) : '',
    round,
  ]
    .filter(Boolean)
    .join(' · ')

  const subtitle = row.match ? `${names.pair1} vs ${names.pair2}` : String(row.tokens?.subject ?? tournament?.name ?? '')

  const live = LIVE_STATUSES.has(row.match?.status ?? '')

  // `stateLabel` deliberately carries a signal `live` does not: an imminent
  // lock. If it only mirrored `live` it would be a redundant field.
  const msToLock = new Date(row.locks_at).getTime() - now
  const stateLabel = live
    ? 'Live now'
    : msToLock > 0 && msToLock <= STARTING_SOON_MS
      ? 'Starting soon'
      : null

  return {
    id: row.id,
    matchId: row.match_id,
    tournamentImage: row.match_id ? null : row.tournament?.cover_image_url ?? null,
    publicId: row.public_id,
    editorial: enrich?.editorial?.get(row.id) ?? null,
    question,
    rules: row.rules_snapshot?.[locale] ?? row.rules_snapshot?.en ?? null,
    horizon: row.template?.horizon ?? 'pre-match',
    context,
    subtitle,
    priceYes: pYes,
    modelProb: modelProbFor(row),
    baselineProb: baselineProbFor(row),
    live,
    stateLabel,
    competition: tournament?.name ?? null,
    category,
    startsAt: row.match?.scheduled_at ?? null,
    locksAt: row.locks_at,
    volumeGuacas: num(row.volume_guacas),
    monogram: names.monogram,
    players: derivePlayers(row.match, enrich?.form),
    h2h: (row.match && enrich?.h2h?.get(row.id)) || null,
    subjectPair: subjectPairOf(row),
  }
}

/**
 * `market_templates.seed_source` for a market that carries its own constant
 * opening price instead of reading one off the match. Mirrors
 * FIXED_SEED_SOURCE in padelgod/src/lib/market-gates.ts.
 */
const FIXED_SEED_SOURCE = 'fixed'

/**
 * The model's current probability for the side the question asks about.
 *
 * `matches.pred_pair1_prob` is always PAIR ONE's probability, but a template
 * may ask about pair two — in which case the honest number is its complement.
 * Getting this wrong would show a market priced at 0.20 next to a "model says
 * 0.80" badge and read as a free bet.
 *
 * Shares subjectPairOf() with the exported `subjectPair` so the number and the
 * colour the card paints beside it can never disagree about which pair the
 * question names.
 *
 * Falls back to the frozen `seed_prob` when the match carries no live
 * prediction, and for tournament-horizon markets which have no match at all.
 *
 * NULL for a `seed_source='fixed'` market, and that early return is
 * load-bearing: those markets sit on ordinary matches that DO carry a
 * pred_pair1_prob, so without it a bagel market would report the favourite's
 * chance of winning under a "model" label — a real number answering a question
 * nobody asked. See baselineProbFor for what those markets show instead.
 */
function modelProbFor(row: MarketRow): number | null {
  if (editorialKind(row.resolver_key) || row.seed_source === FIXED_SEED_SOURCE) return null

  const seed = num(row.seed_prob, NaN)
  const raw = row.match?.pred_pair1_prob
  if (raw === null || raw === undefined) {
    return Number.isFinite(seed) ? seed : null
  }
  const p = num(raw, NaN)
  if (!Number.isFinite(p)) return Number.isFinite(seed) ? seed : null
  return subjectPairOf(row) === 2 ? 1 - p : p
}

/**
 * The historical base rate a fixed-seed market opened at, or null.
 *
 * Read from the market's OWN frozen `seed_prob` rather than from the template's
 * current params: a template's measured rate can be re-measured and edited, and
 * a market must keep showing the number it actually opened at.
 */
function baselineProbFor(row: MarketRow): number | null {
  if (editorialKind(row.resolver_key) || row.seed_source !== FIXED_SEED_SOURCE) return null
  const seed = num(row.seed_prob, NaN)
  return Number.isFinite(seed) ? seed : null
}

// ── Season + balance bootstrap ─────────────────────────────────────────

export interface ActiveSeason {
  id: string
  reset_balance: number
}

/**
 * The single active season. `market_seasons_one_active` is a partial unique
 * index, so at most one row can ever match.
 */
export async function getActiveSeason(
  supabase: SupabaseClient,
): Promise<ActiveSeason | null> {
  const { data, error } = await supabase
    .from('market_seasons')
    .select('id, reset_balance')
    .eq('status', 'active')
    .maybeSingle()

  if (error) {
    console.error('[play] active season lookup failed:', error.message)
    return null
  }
  return (data as ActiveSeason | null) ?? null
}

export interface EnsuredBalance {
  seasonId: string
  balance: number
  locked: number
  resetBalance: number
}

/**
 * Read the caller's balance for the active season, creating it on first touch
 * with the season's starting grant.
 *
 * IDEMPOTENCY: the grant is gated on the INSERT actually creating a row.
 * `ignoreDuplicates: true` makes a colliding upsert return zero rows instead
 * of raising, so a second concurrent request sees an empty `data` array, skips
 * the ledger write, and falls through to the plain read. Checking for an
 * existing signup_grant row instead would be racy — two requests could both
 * observe "no grant yet" before either wrote one, and double-mint.
 *
 * Returns null only when there is no active season, which is an operator
 * problem (no seeded season), not a user-facing one.
 */
export async function ensureBalance(
  supabase: SupabaseClient,
  userId: string,
): Promise<EnsuredBalance | null> {
  const season = await getActiveSeason(supabase)
  if (!season) {
    console.error('[play] no active market season — cannot bootstrap balance')
    return null
  }

  const { data: created, error: insErr } = await supabase
    .from('user_guaca_balance')
    .upsert(
      { user_id: userId, season_id: season.id, balance: season.reset_balance, locked: 0 },
      { onConflict: 'user_id,season_id', ignoreDuplicates: true },
    )
    .select('user_id, season_id, balance, locked')

  if (insErr) {
    console.error('[play] balance bootstrap failed:', insErr.message)
    return null
  }

  const rows = (created ?? []) as unknown as BalanceRow[]
  if (rows.length > 0) {
    // We are the request that minted this balance, so we own the matching
    // ledger entry. If THIS insert fails the balance exists with no ledger
    // row behind it: SUM(guaca_ledger.amount) will be short by
    // season.reset_balance for this user. Operator repair = insert the
    // missing signup_grant row; do NOT adjust the balance, which is correct.
    const { error: ledErr } = await supabase.from('guaca_ledger').insert({
      user_id: userId,
      season_id: season.id,
      kind: 'signup_grant',
      amount: season.reset_balance,
      memo: 'Season starting balance',
    })
    if (ledErr) {
      console.error(
        `[play] LEDGER GAP: signup_grant insert failed for user=${userId} ` +
          `season=${season.id} amount=${season.reset_balance}: ${ledErr.message}`,
      )
    }
    return {
      seasonId: season.id,
      balance: rows[0]!.balance,
      locked: rows[0]!.locked,
      resetBalance: season.reset_balance,
    }
  }

  const { data: existing, error: readErr } = await supabase
    .from('user_guaca_balance')
    .select('user_id, season_id, balance, locked')
    .eq('user_id', userId)
    .eq('season_id', season.id)
    .maybeSingle()

  if (readErr || !existing) {
    console.error('[play] balance read-back failed:', readErr?.message ?? 'no row')
    return null
  }

  const row = existing as unknown as BalanceRow
  return {
    seasonId: season.id,
    balance: row.balance,
    locked: row.locked,
    resetBalance: season.reset_balance,
  }
}

// ── Position valuation ─────────────────────────────────────────────────

/**
 * Market statuses whose positions are still live exposure.
 *
 * Settled/void positions retain their shares for correction history, but
 * their payouts are already cash. A held market with settled_at also has
 * a prior payout and must not be valued again (result withdrawn for review).
 */
export const UNSETTLED_MARKET_STATUSES = ['open', 'locked', 'proposed', 'held'] as const

/** Price of one share of `side`, given the market's YES price. */
export function sidePrice(pYes: number, side: 'yes' | 'no'): number {
  return side === 'yes' ? pYes : 1 - pYes
}

/**
 * Mark-to-market value of a whole position row (both sides), in guacas.
 * Used for net worth; not rounded, because it is a valuation and not a
 * transfer — only actual guaca movements are integers.
 */
export function positionValue(
  pos: Pick<PositionRow, 'yes_shares' | 'no_shares'>,
  pYes: number,
): number {
  return num(pos.yes_shares) * pYes + num(pos.no_shares) * (1 - pYes)
}

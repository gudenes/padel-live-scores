/**
 * fip-scraper.ts
 *
 * All scraping/parsing logic for FIP Gold/Silver/Bronze tournament data.
 * Sources:
 *  - padelfip.com WordPress API (tournament listings, media, dates)
 *  - widget.matchscorerlive.com (draw / results HTML)
 *
 * Run tests with: npx vitest run src/lib/__tests__/fip-scraper.test.ts
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FIP_WP_BASE = 'https://www.padelfip.com'
export const FIP_WP_API = FIP_WP_BASE + '/wp-json/wp/v2'
export const MATCHSCORER_WIDGET = 'https://widget.matchscorerlive.com'

/**
 * FIP WP `category-event` taxonomy IDs. These are the categories we
 * actively scrape — there are more on padelfip.com (junior, senior
 * world cup, regional championships, etc.) but they're sparse and
 * often duplicate the per-region promises tour.
 *
 * Premier-tier IDs (Major/P1/P2/Master Finals/Platinum) were added
 * 2026-04-28 — padelfip.com is the canonical source for Premier
 * tournament metadata too (venue, prize, surface, registration). The
 * Premier API only exposes match-level stats.
 */
// Order matters: fetchFipEvents iterates Object.values(...) and the
// fip-tournaments cron has a hard Vercel function timeout. Premier
// categories sit at the top so the cron finishes the smaller (and
// higher-value) Premier-tier work before tackling the long Bronze
// tail; Bronze stays last because the historical backfill endpoint
// already populates it cheaply via SSE streaming.
export const FIP_CATEGORY_IDS: Record<string, number> = {
  // Premier Padel — same overview structure on padelfip.com
  Finals:   306,  // FIP-PP-MASTER-FINALS (3 events)
  Major:    24,   // FIP-PPT-MAJOR (18)
  Platinum: 18,   // FIP-TOUR-PLATINUM (20)
  P2:       387,  // FIP-PP-P2 (29)
  P1:       25,   // FIP-PPT-P1 (36)
  // FIP Tour
  Gold:     19,   // FIP-TOUR-GOLD (29)
  Silver:   496,  // FIP-TOUR-SILVER (148)
  Bronze:   497,  // FIP-TOUR-BRONZE (255)
}

// Reverse lookup: id → DB level name. The Premier-tier values match
// the conventions padelapi uses elsewhere in the codebase ('p1', 'p2',
// 'major', 'finals', 'fip_platinum') so cross-source rows merge cleanly.
const CATEGORY_ID_TO_LEVEL: Record<number, string> = {
  [FIP_CATEGORY_IDS.Gold]:     'fip_gold',
  [FIP_CATEGORY_IDS.Silver]:   'fip_other',
  [FIP_CATEGORY_IDS.Bronze]:   'fip_other',
  [FIP_CATEGORY_IDS.Platinum]: 'fip_platinum',
  [FIP_CATEGORY_IDS.Major]:    'major',
  [FIP_CATEGORY_IDS.P1]:       'p1',
  [FIP_CATEGORY_IDS.P2]:       'p2',
  [FIP_CATEGORY_IDS.Finals]:   'finals',
}

/** Premier-tier categories: events where the WP slug doesn't have the
 *  `fip-` prefix and likely already exists in DB under a padelapi row.
 *  The cron uses this to switch from slug-based to name+year dedup. */
export const FIP_PREMIER_CATEGORY_IDS: ReadonlySet<number> = new Set([
  FIP_CATEGORY_IDS.Platinum,
  FIP_CATEGORY_IDS.Major,
  FIP_CATEGORY_IDS.P1,
  FIP_CATEGORY_IDS.P2,
  FIP_CATEGORY_IDS.Finals,
])

/** Returns true when a parsed WP event came from a Premier-tier category. */
export function isPremierTierEvent(event: { categoryIds: number[] }): boolean {
  return event.categoryIds.some((id) => FIP_PREMIER_CATEGORY_IDS.has(id))
}

/**
 * 3-letter → 2-letter ISO country codes.
 *
 * Canonical source: `/shared/country-codes-3to2.json` — mirrored in
 * `padelgod/src/lib/country-codes-3to2.json` because padelgod's
 * tsconfig `rootDir: ./src` can't reach outside. A drift test
 * (`src/lib/__tests__/country-map-sync.test.ts`) asserts the two
 * copies are byte-identical.
 *
 * Includes both ISO 3166-1 alpha-3 (ESP, ARG) AND FIFA-style aliases
 * (POR, NED, GER, SUI, INA, SIN, NGR, LIT…) that padelfip.com and
 * matchscorerlive.com emit.
 */
import ISO3_TO_ISO2_JSON from '../../shared/country-codes-3to2.json'

export const ISO3_TO_ISO2: Record<string, string> = ISO3_TO_ISO2_JSON

/** Pre-computed set of valid 2-letter ISO codes for fast lookup */
const ISO2_VALUES = new Set(Object.values(ISO3_TO_ISO2))

export function toIso2(iso3: string | null): string | null {
  if (!iso3) return null
  const upper = iso3.toUpperCase()
  // Direct 3→2 lookup
  const mapped = ISO3_TO_ISO2[upper]
  if (mapped) return mapped
  // Already a valid 2-letter code? Check if it exists as a value in the map
  if (upper.length === 2 && ISO2_VALUES.has(upper)) return upper
  return null
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FipTournament {
  wpId: number
  name: string
  slug: string
  link: string
  featuredMediaId: number
  categoryIds: number[]
  countryTermIds: number[]
  genderTermIds: number[]
  level: string // 'fip_gold', 'fip_other'
}

export interface EventDates {
  startsAt: string | null // ISO date YYYY-MM-DD
  endsAt: string | null
}

export interface MatchscorerIds {
  year: string
  id: string
  totalDays: number
  code: string // e.g. "FIP-2025-3301", "FIP-2026-B0118"
  /**
   * Crionet matchscorerlive widget type. Determines which `/screen/<widget>/`
   * endpoint serves the tournament's match data:
   *
   *   - 'draw'      — Bronze/Silver/Gold/Premier (numeric event IDs).
   *                   Has bracket structure, used by fetchDrawMatches.
   *   - 'oopbyday'  — FIP Beyond / Promises (alphanumeric event IDs like
   *                   B0118). Uses the daily order-of-play widget instead.
   *
   * Falls back to 'draw' when the page doesn't expose a `const widget`
   * declaration (legacy event pages).
   */
  widget: string
}

export interface DrawSize {
  mainDraw: number | null      // e.g. 32
  qualifyingDraw: number | null // e.g. 16
  prizeMoney: number | null     // e.g. 10000 (in euros)
}

/**
 * Per-round prize payout from the overview "Prize Distribution" table.
 *
 * Amounts are euros per player (the page footer literally says
 * "*The shown price is the Price Per Player (PPP)"). A pair's payout =
 * 2 × the value here.
 *
 * Only rounds the page lists are populated; missing rounds stay absent
 * (NOT zero — that distinguishes "round didn't run" from "0€ prize",
 * which matters for early-round eliminations where €0 is real).
 */
export interface PrizeBreakdown {
  r32?: number
  r16?: number
  qf?: number
  sf?: number
  finalist?: number
  winner?: number
  currency: 'EUR'
  per: 'player'
  source: 'scraped' | 'inferred'
}

/**
 * Loose fields scraped from the FIP overview block (the labelled
 * "overview__title" / "overview__text" pairs at the top of every event
 * page). Everything is optional — the page omits fields freely.
 */
/** Per-round ISO dates parsed from the "Play Order" overview block. */
export type RoundKey = 'q1' | 'q2' | 'q3' | 'r64' | 'r32' | 'r16' | 'qf' | 'sf' | 'f'
export type RoundSchedule = Partial<Record<RoundKey, string>>

/** Tournament date range needed to resolve day-of-week / month references. */
export interface OverviewContext {
  startsAt: string | null
  endsAt: string | null
  /**
   * Tournament `level` (p1 / p2 / major / finals / fip_silver / ...).
   * Used to disambiguate "1st ROUND" / "2nd ROUND" labels in FIP overview
   * text — R64/R32 on Premier tiers (56-team mens MD), ambiguous otherwise.
   */
  level?: string | null
}

export interface OverviewFields {
  registrationStatus: string | null   // 'open' | 'closed' | 'upcoming' | …
  signupFeeEur: number | null
  venue: string | null
  venueAddress: string | null
  venueType: string | null            // 'covered' | 'outdoor' (lowercased)
  scheduleNotes: string | null        // multiline play-order text
  roundSchedule: RoundSchedule        // empty {} when no parse / no context
}

export interface ParsedMatch {
  round: string
  court: string | null
  category: 'men' | 'women'
  status: 'scheduled' | 'finished'
  team1: ParsedTeam
  team2: ParsedTeam
  sets: ParsedSet[]
  winnerTeam: 1 | 2 | null
}

export interface ParsedTeam {
  player1: ParsedPlayer
  player2: ParsedPlayer
}

export interface ParsedPlayer {
  firstName: string
  lastName: string
  country: string | null
  seed: number | null
}

export interface ParsedSet {
  setNumber: number
  team1Games: number
  team2Games: number
}

// ---------------------------------------------------------------------------
// HTML entity decoder (browser-independent)
// ---------------------------------------------------------------------------

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&apos;/g, "'")
    .replace(/&ntilde;/g, 'ñ')
    .replace(/&Ntilde;/g, 'Ñ')
    .replace(/&oacute;/g, 'ó')
    .replace(/&eacute;/g, 'é')
    .replace(/&iacute;/g, 'í')
    .replace(/&uacute;/g, 'ú')
    .replace(/&aacute;/g, 'á')
}

// ---------------------------------------------------------------------------
// Pure parsing functions
// ---------------------------------------------------------------------------

/**
 * Parse a WP API event JSON object into a FipTournament.
 */
export function parseWpEvent(event: any): FipTournament {
  // Extract level from category IDs
  const categoryIds: number[] = event['category-event'] ?? []
  let level = 'fip_gold' // default
  for (const id of categoryIds) {
    if (CATEGORY_ID_TO_LEVEL[id]) {
      level = CATEGORY_ID_TO_LEVEL[id]
      break
    }
  }

  // Country and gender are stored in custom taxonomies — acf or custom fields
  // The WP API may expose them via `_links` or embedded `wp:term`
  const countryTermIds: number[] = event.country ?? []
  const genderTermIds: number[] = event.gender ?? []

  const rawTitle: string =
    event.title?.rendered ?? event.title ?? ''
  const name = decodeHtmlEntities(rawTitle)

  return {
    wpId: event.id,
    name,
    slug: event.slug ?? '',
    link: event.link ?? '',
    featuredMediaId: event.featured_media ?? 0,
    categoryIds,
    countryTermIds: Array.isArray(countryTermIds) ? countryTermIds : [],
    genderTermIds: Array.isArray(genderTermIds) ? genderTermIds : [],
    level,
  }
}

// Internal helper: extract a labeled DD/MM/YYYY date from a "Tournament
// Structure" / "Estructura del torneo" block. Used by parseEventDates and
// parseDrawSizes to read the structured per-stage data FIP exposes.
//
// Why labeled: the page also contains date ranges in unrelated sections
// (e.g. "PRACTICE COURTS — Available dates: 20, 21, 22 April 2026"),
// which the previous "first DD/MM/YYYY wins" parser would silently
// promote to startsAt. The Isla Bronze 2026 row was set to 2026-04-20
// because of exactly this — practice-court dates leaking into starts_at.
//
// `[^\d]*` between the label and the date is bounded; if a non-date
// number appears between (e.g. "Qualification Draw: 32 (30DA+2WC)"),
// the regex engine tries the next occurrence of `label` and so on. The
// goal is to always end up at the labeled date even when the same word
// appears earlier in a different context.
function findLabeledDate(html: string, label: string): string | null {
  const re = new RegExp(
    `${label}[^\\d]*(\\d{2})\\/(\\d{2})\\/(\\d{4})`,
    'i',
  )
  const m = re.exec(html)
  if (!m) return null
  const [, d, mo, y] = m
  return `${y}-${mo}-${d}`
}

/**
 * Extract start/end dates from event page HTML.
 *
 * Preferred path: read the labeled "Main draw DD/MM/YYYY" line in the
 * Tournament Structure block (FIP exposes this on every modern event
 * page in both EN and ES — `Cuadro principal` matches the same regex
 * because we anchor on "Main draw" / "Cuadro principal" via the EN
 * version that the scraper hits at FIP_WP_BASE/events/<slug>/). When
 * the labeled field is present it's authoritative.
 *
 * Fallback: the legacy "first DD/MM/YYYY range in the HTML" behavior,
 * preserved for older event pages or unexpected layout changes. The
 * range's end date is also used as endsAt regardless of which path
 * found the start, since the structured block gives only the start.
 */
export function parseEventDates(html: string): EventDates {
  // First date-range we encounter — typically the page header
  // "DD/MM/YYYY - DD/MM/YYYY" (now main-draw-only on modern FIP pages).
  // Captured up-front so we have an endsAt regardless of which path
  // wins the start date.
  const dateRangeRe =
    /(\d{2})\/(\d{2})\/(\d{4})\s*[-\u2013\u2014]\s*(\d{2})\/(\d{2})\/(\d{4})/
  const rangeMatch = dateRangeRe.exec(html)
  const headerStart = rangeMatch ? `${rangeMatch[3]}-${rangeMatch[2]}-${rangeMatch[1]}` : null
  const headerEnd = rangeMatch ? `${rangeMatch[6]}-${rangeMatch[5]}-${rangeMatch[4]}` : null

  // Preferred: labeled "Main draw" date from the Tournament Structure
  // block. The label is identical (apart from case) on both EN and ES
  // event pages — `Cuadro principal` is the ES rendering of the same
  // structured field. We hit the EN base URL today so the EN label
  // wins; if ever we switch language paths, the ES label is matched
  // by the same regex when we add it as a second `findLabeledDate`
  // call.
  const mainDrawDate = findLabeledDate(html, 'Main\\s+draw')
    ?? findLabeledDate(html, 'Cuadro\\s+principal')

  if (mainDrawDate) {
    return { startsAt: mainDrawDate, endsAt: headerEnd }
  }

  // Fallback: first range wins.
  if (rangeMatch) {
    return { startsAt: headerStart, endsAt: headerEnd }
  }

  // Last resort: any single date in the HTML.
  const singleRe = /(\d{2})\/(\d{2})\/(\d{4})/
  const singleMatch = singleRe.exec(html)
  if (singleMatch) {
    const [, d, m, y] = singleMatch
    return {
      startsAt: `${y}-${m}-${d}`,
      endsAt: null,
    }
  }

  return { startsAt: null, endsAt: null }
}

/**
 * Extract matchscorer IDs from inline JS in event page HTML.
 *
 * Two formats observed in the wild:
 *
 *   Bronze/Silver/Gold/Premier (numeric ID + draw widget):
 *     const eventYear = "2025"
 *     const eventID   = "3301"
 *     const totalday  = 5
 *     const widget    = 'draw'        // sometimes absent → defaults to 'draw'
 *
 *   FIP Beyond / Promises (alphanumeric ID + oopbyday widget):
 *     const eventYear = "2026"
 *     const eventID   = "B0118"
 *     const widget    = 'oopbyday'
 *
 * The eventID regex accepts any [A-Za-z0-9]+ token because new tiers may
 * keep introducing new ID schemes. The widget value is read separately
 * and used by fetchDrawMatches to pick the right `/screen/<widget>/` URL.
 */
export function parseMatchscorerIds(html: string): MatchscorerIds | null {
  const yearMatch = /const\s+eventYear\s*=\s*["'](\d+)["']/.exec(html)
  const idMatch = /const\s+eventID\s*=\s*["']([A-Za-z0-9]+)["']/.exec(html)
  const daysMatch = /const\s+totalday\s*=\s*(\d+)/.exec(html)
  const widgetMatch = /const\s+widget\s*=\s*["']([a-z]+)["']/.exec(html)

  if (!yearMatch || !idMatch) return null

  const year = yearMatch[1]!
  const id = idMatch[1]!
  const totalDays = daysMatch ? parseInt(daysMatch[1]!, 10) : 1
  const widget = widgetMatch ? widgetMatch[1]! : 'draw'

  return {
    year,
    id,
    totalDays,
    code: `FIP-${year}-${id}`,
    widget,
  }
}

/**
 * Extract draw sizes and prize money from event page overview.
 *
 * Looks for patterns like:
 *   "Main draw: 32 (26 DA + 4 Qualy + 2 WC)"
 *   "Qualification draw: 16 (14 DA + 2 WC)"
 *   "Prize Money 10,000€"
 *
 * Prize money: prefer the labeled "Prize Money <amount>€" pattern over
 * the first €-suffixed number. The legacy fallback ("first € sign in
 * HTML") was unreliable — most FIP pages also list per-round payouts
 * (€131.25, €250, etc.) in a "Prize Distribution" table. Without label
 * anchoring, the parser would either pick the wrong cell or — as
 * observed for FIP Bronze Isla 2026 — return null when neither pattern
 * matched the actual page formatting.
 *
 * On a separate note: the trigger logic in fip-tournaments/route.ts
 * also matters. That cron only re-runs the scraper when one of
 * (starts_at, matchscorer_url, draw_size_md) is missing — so a
 * tournament that landed without prize_money_fip would never refetch
 * even after this parser is fixed. See the same PR for the trigger
 * widening to include `prize_money_fip` and stale `starts_at`.
 */
export function parseDrawSizes(html: string): DrawSize {
  // Main draw: look for "Main draw" followed by a number
  const mdMatch = /[Mm]ain\s*[Dd]raw[:\s]*(\d+)/i.exec(html)
  const mainDraw = mdMatch ? parseInt(mdMatch[1], 10) : null

  // Qualifying draw: various spellings
  const qdMatch = /[Qq]ualif(?:ication|ying)\s*[Dd]raw[:\s]*(\d+)/i.exec(html)
  const qualifyingDraw = qdMatch ? parseInt(qdMatch[1], 10) : null

  // Prize money — labelled "Prize Money" match only. Both suffix and
  // prefix € formats appear on padelfip.com:
  //   Bronze/Silver/Gold: "Prize Money 18.000€"
  //   Premier-tier:       "Prize Money €264.534"
  // The earlier unlabelled fallback (first €-suffixed number anywhere)
  // got removed 2026-04-28: on FIP Beyond / Promises pages there's no
  // Prize Money field at all (those tiers don't pay), but there IS a
  // "Sign Up Fee 60 € per player" line that the fallback would grab
  // and stamp as the prize. Now we leave prize_money_fip null when
  // the page doesn't carry an explicit Prize Money label.
  let prizeMoney: number | null = null
  const labeledSuffix = /Prize\s*Money[^\d]*(\d[\d.,]*)\s*€/i
  const labeledPrefix = /Prize\s*Money[^€]*€\s*(\d[\d.,]*)/i
  const prizeMatch = labeledSuffix.exec(html) ?? labeledPrefix.exec(html)
  if (prizeMatch) {
    // Remove thousand separators (both . and ,) and parse
    const cleaned = prizeMatch[1]!.replace(/[.,]/g, '')
    const val = parseInt(cleaned, 10)
    if (val > 0 && val < 10_000_000) prizeMoney = val
  }

  return { mainDraw, qualifyingDraw, prizeMoney }
}

// ---------------------------------------------------------------------------
// parseScheduleNotes — convert Play Order text → per-round ISO dates
// Logic mirrors padelgod/src/parsers/fip-schedule-notes.ts. The padelgod
// copy is the canonical implementation with 20 unit tests. This Next.js-
// side copy exists because the project has no workspace setup — Next.js
// can't import TypeScript source from the padelgod package. When updating
// either copy, mirror the change to the other and run the padelgod tests
// to catch regressions.
// ---------------------------------------------------------------------------

const _DAY_NAMES: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, miércoles: 3, jueves: 4, viernes: 5, sabado: 6, sábado: 6,
  segunda: 1, terca: 2, terça: 2, quarta: 3, quinta: 4, sexta: 5,
  domenica: 0, lunedi: 1, lunedì: 1, martedi: 2, martedì: 2, mercoledi: 3, mercoledì: 3,
  giovedi: 4, giovedì: 4, venerdi: 5, venerdì: 5,
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
  sabato: 6,
}

const _MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
  oct: 10, nov: 11, dec: 12,
}

function _buildIsoDate(year: number, month: number, day: number): string {
  const y = year + Math.floor((month - 1) / 12)
  const m = ((month - 1) % 12) + 1
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function _resolveDayOfWeek(dayName: string, startsAt: string, endsAt: string): string | null {
  const key = dayName.trim().toLowerCase()
  if (!(key in _DAY_NAMES)) return null
  const target = _DAY_NAMES[key]
  // Slice to YYYY-MM-DD; tolerate full ISO timestamps from callers.
  const start = new Date(`${startsAt.slice(0, 10)}T00:00:00Z`)
  const end = new Date(`${endsAt.slice(0, 10)}T00:00:00Z`)
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() === target) return d.toISOString().slice(0, 10)
  }
  return null
}

function _resolveDateInRange(day: number, monthName: string, startsAt: string, endsAt: string): string | null {
  const month = _MONTHS[monthName.toLowerCase()]
  if (!month || day < 1 || day > 31) return null
  const startYear = parseInt(startsAt.slice(0, 4), 10)
  for (const y of [startYear, startYear + 1]) {
    const iso = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (iso >= startsAt && iso <= endsAt) return iso
  }
  return null
}

// Premier tiers (p1/p2/major/finals) use a 56-team men's main draw, so
// "1st ROUND" → R64. "2nd ROUND" is layout-dependent (see padelgod's
// fip-schedule-notes.ts for the full layout taxonomy): a 3-day layout
// with an explicit "ROUND OF 16" block puts "2nd ROUND" on R32, while a
// 2-day layout (no ROUND OF 16) puts "2nd ROUND" on R16. FIP
// Bronze/Silver/Gold/Platinum vary in draw size — stay ambiguous.
const _PREMIER_LEVELS = new Set(['p1', 'p2', 'major', 'finals'])

interface _PremierLayout {
  hasSecondRound: boolean
  hasRoundOf16: boolean
}

function _detectPremierLayout(notes: string): _PremierLayout {
  const u = notes.toUpperCase()
  return {
    hasSecondRound: /\b2ND\s+ROUND\b/.test(u),
    hasRoundOf16: /\bROUND\s+OF\s+16\b/.test(u),
  }
}

function _labelToKey(
  label: string,
  level?: string | null,
  layout?: _PremierLayout,
): RoundKey | null {
  const u = label.toUpperCase()
  if (u.includes('ROUND OF 64')) return 'r64'
  if (u.includes('ROUND OF 32')) return 'r32'
  if (u.includes('ROUND OF 16')) return 'r16'
  if (u.includes('QUARTER')) return 'qf'
  if (u.includes('SEMI')) return 'sf'
  if (u.includes('FINAL')) return 'f'
  if (level && _PREMIER_LEVELS.has(level)) {
    if (/\b1ST\s+ROUND\b/.test(u)) return 'r64'
    if (/\b2ND\s+ROUND\b/.test(u)) {
      return layout?.hasRoundOf16 ? 'r32' : 'r16'
    }
    if (/\b3RD\s+ROUND\b/.test(u)) return 'r16'
  }
  return null
}

/**
 * Map a free-text description of a tournament day's matches to round keys.
 * Conservative — only emits keys for unambiguously named rounds.
 *   Quarterfinals / Quarter Finals / QF      → qf
 *   Semifinals / Semi Finals / SF            → sf
 *   Finals / Final / F                       → f
 *   1st (round of) Qualy / Q1                → q1   (and q2/q3)
 * Combined phrases ("SF and Finals", "QF and SF", "2nd and 3rd qualy")
 * emit multiple keys.
 *
 * Round labels are ENGLISH-ONLY. Real-world FIP overview text uses English
 * round names even on Spanish/Italian/Portuguese-language tournaments
 * (e.g. FIP Silver Mediolanum's notes say "Quarterfinals" / "Semifinals
 * and Finals" despite being an Italian event). The connector set
 * `(and|y|e|et|&)` IS multilingual to handle hybrid phrasings like
 * "Semifinales and Finals" — but the round-name vocabulary itself is not.
 *
 * Deliberately NOT mapped: "1st round MD" / "2nd round MD" — ambiguous
 * on draw size (R32 in 32-draw, R16 in 16-draw). See spec §Risks.
 *
 * Tests for the canonical implementation live in
 * padelgod/src/__tests__/parsers/fip-schedule-notes.test.ts. This copy is
 * a manually-mirrored duplicate (no workspace setup links the two
 * codebases) — keep the regex logic in lock-step.
 */
function _descriptionToKeys(desc: string): RoundKey[] {
  const keys = new Set<RoundKey>()
  const lc = desc
  if (/(?:semi[-\s]?final[s]?|sf)\s*(?:and|y|e|et|&)\s*final[s]?/i.test(lc)) { keys.add('sf'); keys.add('f') }
  else if (/(?:quarter[-\s]?final[s]?|qf)\s*(?:and|y|e|et|&)\s*(?:semi[-\s]?final[s]?|sf)/i.test(lc)) { keys.add('qf'); keys.add('sf') }
  else {
    if (/\b(?:quarter[-\s]?final[s]?|qf|1\/4)\b/i.test(lc)) keys.add('qf')
    if (/\b(?:semi[-\s]?final[s]?|sf|1\/2)\b/i.test(lc)) keys.add('sf')
    if (/\b(?:final[s]?|^f$)\b/i.test(lc) && !/(semi|quarter)/i.test(lc)) keys.add('f')
  }
  if (/\b(?:1st\s+(?:round\s+)?qual|q1\b|1st\s+qualy\b)/i.test(lc)) keys.add('q1')
  if (/\b(?:2nd\s+(?:round\s+)?qual|q2\b|2nd\s+qualy\b)/i.test(lc)) keys.add('q2')
  if (/\b(?:3rd\s+(?:round\s+)?qual|q3\b|3rd\s+qualy\b|final\s+round\s+qual)/i.test(lc)) keys.add('q3')
  if (/\b2nd\s+and\s+3rd\s+(?:round\s+)?qual/i.test(lc)) { keys.add('q2'); keys.add('q3') }
  return [...keys]
}

function _parsePremierBlocks(notes: string, startsAt: string, endsAt: string, level?: string | null): RoundSchedule {
  const layout = _detectPremierLayout(notes)
  const out: RoundSchedule = {}
  const re =
    /(MAIN DRAW\s*:?\s*(?:ROUND OF 64|ROUND OF 32|ROUND OF 16|QUARTER-FINALS?|SEMI-FINALS?|FINALS?|1st ROUND|2nd ROUND|3rd ROUND))[\s\S]{0,200}?(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/gi
  for (const m of notes.matchAll(re)) {
    const label = m[1]!.toUpperCase()
    const iso = _resolveDateInRange(parseInt(m[2]!, 10), m[3]!, startsAt, endsAt)
    if (!iso) continue
    const key = _labelToKey(label, level, layout)
    if (key && !(key in out)) out[key] = iso
  }
  const startYear = parseInt(startsAt.slice(0, 4), 10)
  const startMonth = parseInt(startsAt.slice(5, 7), 10)
  const qualRe = /\b(Q[123])\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+(\d{1,2})\b/gi
  for (const m of notes.matchAll(qualRe)) {
    const qKey = m[1]!.toLowerCase() as RoundKey
    const dayNum = parseInt(m[2]!, 10)
    for (const iso of [_buildIsoDate(startYear, startMonth, dayNum), _buildIsoDate(startYear, startMonth + 1, dayNum)]) {
      if (iso >= startsAt && iso <= endsAt) {
        if (!(qKey in out) || iso < out[qKey]!) out[qKey] = iso
        break
      }
    }
  }
  return out
}

function _parseDayOfWeekLines(notes: string, startsAt: string, endsAt: string): RoundSchedule {
  const out: RoundSchedule = {}
  const lineRe = /^[\s*\-•·]*([A-Za-zçéëèêîïôûáàèéíìóòúù]+)\s*(?:[-–—:]+)\s*(.+)$/gm
  for (const m of notes.matchAll(lineRe)) {
    const date = _resolveDayOfWeek(m[1]!, startsAt, endsAt)
    if (!date) continue
    for (const k of _descriptionToKeys(m[2]!.toLowerCase())) {
      if (!(k in out) || date < out[k]!) out[k] = date
    }
  }
  return out
}

function parseScheduleNotes(notes: string | null, startsAt: string, endsAt: string, opts?: { level?: string | null }): RoundSchedule {
  if (!notes) return {}
  // Defensive: callers may pass full ISO timestamps ("2026-05-03T00:00:00+00:00")
  // instead of date-only strings ("2026-05-03"). String comparisons in the
  // helpers below assume the date-only form — slice to 10 chars to normalize.
  // Without this, '2026-05-03' >= '2026-05-03T...' is FALSE (shorter string
  // with same prefix loses), and tournament-first-day dates get dropped.
  const start = startsAt.slice(0, 10)
  const end = endsAt.slice(0, 10)
  const result: RoundSchedule = {}
  Object.assign(result, _parsePremierBlocks(notes, start, end, opts?.level))
  Object.assign(result, _parseDayOfWeekLines(notes, start, end))
  const finalsMatch = /Date\s+Finals\s*:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(notes)
  if (finalsMatch) {
    result.f = `${finalsMatch[3]}-${finalsMatch[2]!.padStart(2, '0')}-${finalsMatch[1]!.padStart(2, '0')}`
  }
  return result
}

// ---------------------------------------------------------------------------
// parseOverviewFields — extract the labelled overview__title/text pairs
// ---------------------------------------------------------------------------

/**
 * Find the value of a labelled `<span class="overview__title">{LABEL}</span>`
 * block. Returns the inner text of the next `overview__text` element
 * (whether it's a `<p>` or a `<div>`), trimmed and entity-decoded.
 *
 * Returns `null` if the label isn't on the page.
 */
function findOverviewValue(html: string, label: string): string | null {
  const labelEsc = escapeRegex(label)
  // Allow optional ":" / whitespace after the label.
  // Allow any tags between title and the overview__text element.
  const re = new RegExp(
    `overview__title[^>]*>\\s*${labelEsc}\\s*:?\\s*<\\/span>[\\s\\S]{0,800}?overview__text[^>]*>([\\s\\S]*?)<\\/(?:p|div)>`,
    'i',
  )
  const m = re.exec(html)
  if (!m) return null
  const text = decodeHtmlEntities(stripTags(m[1])).replace(/\s+/g, ' ').trim()
  return text || null
}

/**
 * Parse the overview block on a FIP event page.
 *
 * Labels we recognise (consistent across all FIP Bronze/Silver/Gold pages
 * inspected April 2026):
 *   - "Registration Closed" / "Registration Open" — the status word lives
 *     on the title itself, the value is empty. Captured separately.
 *   - "Sign Up Fee:" → "40 € per player"
 *   - "Court conditions" → "Covered" / "Outdoor"
 *   - "Venue" / "Address"
 *   - "Play Order" → multi-line schedule text (kept as-is, line-broken)
 */
export function parseOverviewFields(html: string, ctx?: OverviewContext): OverviewFields {
  // Registration status — the word IS the label. Match "Registration Open"
  // or "Registration Closed" (and any other word FIP introduces) on the
  // title element itself.
  const regRe = /overview__title[^>]*>\s*Registration\s+([A-Za-z]+)\s*<\/span>/i
  const regMatch = regRe.exec(html)
  const registrationStatus = regMatch ? regMatch[1].toLowerCase() : null

  // Sign-up fee — "40 € per player" — pull the leading number.
  const feeText = findOverviewValue(html, 'Sign Up Fee')
  let signupFeeEur: number | null = null
  if (feeText) {
    const m = /(\d[\d.,]*)/.exec(feeText)
    if (m) {
      const cleaned = m[1].replace(/[.,]/g, '')
      const val = parseInt(cleaned, 10)
      if (val >= 0 && val < 10_000) signupFeeEur = val
    }
  }

  // Court conditions — normalise to lowercase ("covered" / "outdoor").
  const courtRaw = findOverviewValue(html, 'Court conditions')
  const venueType = courtRaw ? courtRaw.toLowerCase() : null

  const venue = findOverviewValue(html, 'Venue')
  const venueAddress = findOverviewValue(html, 'Address')

  // Play Order — keep the line breaks. The HTML uses `<br />` between
  // days, which stripTags drops. Convert them to "\n" before stripping.
  const playOrderRe =
    /overview__title[^>]*>\s*Play\s*Order\s*:?\s*<\/span>[\s\S]{0,400}?overview__listText[^>]*>([\s\S]*?)<\/div>/i
  const playMatch = playOrderRe.exec(html)
  let scheduleNotes: string | null = null
  if (playMatch) {
    const withBreaks = playMatch[1].replace(/<br\s*\/?>/gi, '\n')
    scheduleNotes =
      decodeHtmlEntities(stripTags(withBreaks))
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join('\n') || null
  }

  const roundSchedule: RoundSchedule =
    scheduleNotes && ctx?.startsAt && ctx?.endsAt
      ? parseScheduleNotes(scheduleNotes, ctx.startsAt, ctx.endsAt, { level: ctx.level })
      : {}

  return {
    registrationStatus,
    signupFeeEur,
    venue,
    venueAddress,
    venueType,
    scheduleNotes,
    roundSchedule,
  }
}

// ---------------------------------------------------------------------------
// parsePrizeBreakdown — per-round payout from the prize-distribution table
// ---------------------------------------------------------------------------

/**
 * Parse the FIP prize-distribution table:
 *
 *   <th scope="row">{ROUND}</th>
 *   <td>€ {AMOUNT}€</td>
 *
 * Round labels we map (case-insensitive):
 *   R32, R16, 1/4 FINAL (or QF / QUARTERFINAL),
 *   SEMIFINAL (or 1/2 FINAL / SF), FINALIST, WINNER.
 *
 * Amounts can be decimals (€ 111.56€) — kept as floating euros.
 * Returns null if nothing matched (page omits the breakdown entirely).
 */
type _PrizeRoundKey = 'r32' | 'r16' | 'qf' | 'sf' | 'finalist' | 'winner'

export function parsePrizeBreakdown(html: string): PrizeBreakdown | null {
  // Each row: capture the round label and the euro amount cell.
  const rowRe =
    /<th[^>]*scope="row"[^>]*>\s*([^<]+?)\s*<\/th>\s*<td[^>]*>\s*€?\s*([0-9][\d.,]*)\s*€?\s*<\/td>/gi

  const rounds: Partial<Record<_PrizeRoundKey, number>> = {}
  let hits = 0

  let m: RegExpExecArray | null
  while ((m = rowRe.exec(html)) !== null) {
    const label = m[1].toUpperCase().replace(/\s+/g, ' ').trim()
    const key = roundLabelToKey(label)
    if (!key) continue

    const raw = m[2].replace(/,/g, '')
    const amount = Number.parseFloat(raw)
    if (!Number.isFinite(amount) || amount < 0) continue

    // Round to 2 decimals to suppress JS float drift.
    rounds[key] = Math.round(amount * 100) / 100
    hits++
  }

  if (hits === 0) return null

  return {
    ...rounds,
    currency: 'EUR',
    per: 'player',
    source: 'scraped',
  }
}

function roundLabelToKey(label: string): _PrizeRoundKey | null {
  // label is already upper-case, single-spaced.
  if (label === 'R32' || label === 'ROUND 32') return 'r32'
  if (label === 'R16' || label === 'ROUND 16') return 'r16'
  if (
    label === 'QF' ||
    label === '1/4 FINAL' ||
    label === '1/4FINAL' ||
    label === 'QUARTERFINAL' ||
    label === 'QUARTER FINAL'
  )
    return 'qf'
  if (
    label === 'SF' ||
    label === '1/2 FINAL' ||
    label === '1/2FINAL' ||
    label === 'SEMIFINAL' ||
    label === 'SEMI FINAL'
  )
    return 'sf'
  if (label === 'FINALIST' || label === 'RUNNER UP' || label === 'RUNNER-UP')
    return 'finalist'
  if (label === 'WINNER' || label === 'CHAMPION') return 'winner'
  return null
}

// ---------------------------------------------------------------------------
// parseDrawHtml — parse widget.matchscorerlive.com draw HTML
// ---------------------------------------------------------------------------

/**
 * Parse the draw HTML from widget.matchscorerlive.com for a given category.
 */
export function parseDrawHtml(
  html: string,
  category: 'men' | 'women'
): ParsedMatch[] {
  const matches: ParsedMatch[] = []

  // Split by match tables — each match contains "scorebox-header"
  // We look for <table ... > blocks that contain scorebox-header
  // Use a regex to find each table block
  const tableRe = /<table\b[^>]*class="[^"]*w-100[^"]*"[^>]*>([\s\S]*?)<\/table>/gi
  let tableMatch: RegExpExecArray | null

  while ((tableMatch = tableRe.exec(html)) !== null) {
    const tableHtml = tableMatch[0]

    // Only process tables that contain a scorebox-header
    if (!tableHtml.includes('scorebox-header')) continue

    try {
      const parsed = parseMatchTable(tableHtml, category)
      if (parsed) matches.push(parsed)
    } catch {
      // Skip malformed tables
    }
  }

  return matches
}

function parseMatchTable(
  tableHtml: string,
  category: 'men' | 'women'
): ParsedMatch | null {
  // Round
  const roundMatch = /<th[^>]*class="[^"]*round-name[^"]*"[^>]*>[\s\S]*?<small[^>]*>([\s\S]*?)<\/small>/i.exec(
    tableHtml
  )
  const round = roundMatch ? stripTags(roundMatch[1]).trim() : 'Unknown'

  // Court
  const courtMatch = /<span[^>]*class="[^"]*court-name[^"]*"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i.exec(
    tableHtml
  )
  const court = courtMatch ? stripTags(courtMatch[1]).trim() || null : null

  // Status
  const isCompleted = tableHtml.includes('scorebox-header-completed')
  const status: 'scheduled' | 'finished' = isCompleted ? 'finished' : 'scheduled'

  // Split into team sections
  // Teams are separated by "scorebox-sep-bottom" rows or "draw-item-container" rows
  // or by <!-- Team 2 --> comment
  const teamSections = splitTeamSections(tableHtml)
  if (teamSections.length < 2) return null

  const team1Html = teamSections[0]
  const team2Html = teamSections[1]

  const team1 = parseTeam(team1Html)
  const team2 = parseTeam(team2Html)

  // Winner detection — check for fa-check or "winner" class on team rows
  const team1HasWinner = hasWinnerMarker(team1Html)
  const team2HasWinner = hasWinnerMarker(team2Html)

  let winnerTeam: 1 | 2 | null = null
  if (isCompleted) {
    if (team1HasWinner && !team2HasWinner) winnerTeam = 1
    else if (team2HasWinner && !team1HasWinner) winnerTeam = 2
  }

  // Set scores
  const sets = parseSetScores(team1Html, team2Html)

  return {
    round,
    court,
    category,
    status,
    team1,
    team2,
    sets,
    winnerTeam,
  }
}

function splitTeamSections(tableHtml: string): string[] {
  // Try <!-- Team 2 --> or <!-- Team 2--> comment split (with or without space)
  const commentRe = /<!--\s*Team\s*2\s*-->/i
  const commentMatch = commentRe.exec(tableHtml)
  if (commentMatch) {
    return [tableHtml.slice(0, commentMatch.index), tableHtml.slice(commentMatch.index)]
  }

  // Try splitting by scorebox-sep-bottom rows
  const sepRe = /<tr[^>]*class="[^"]*scorebox-sep-bottom[^"]*"[^>]*>/gi
  const sepMatches: number[] = []
  let m: RegExpExecArray | null
  while ((m = sepRe.exec(tableHtml)) !== null) {
    sepMatches.push(m.index)
  }
  if (sepMatches.length >= 1) {
    return [
      tableHtml.slice(0, sepMatches[0]),
      tableHtml.slice(sepMatches[0]),
    ]
  }

  // Try draw-item-container rows
  const containerRe = /<tr[^>]*class="[^"]*draw-item-container[^"]*"[^>]*>/gi
  const containerMatches: number[] = []
  while ((m = containerRe.exec(tableHtml)) !== null) {
    containerMatches.push(m.index)
  }
  if (containerMatches.length >= 2) {
    return [
      tableHtml.slice(containerMatches[0], containerMatches[1]),
      tableHtml.slice(containerMatches[1]),
    ]
  }

  // Fallback: split in half
  const half = Math.floor(tableHtml.length / 2)
  return [tableHtml.slice(0, half), tableHtml.slice(half)]
}

function parseTeam(teamHtml: string): ParsedTeam {
  // Find all player-names double blocks
  const playerBlocks = extractPlayerBlocks(teamHtml)

  const player1 = playerBlocks[0] ?? defaultPlayer()
  const player2 = playerBlocks[1] ?? defaultPlayer()

  return { player1, player2 }
}

function defaultPlayer(): ParsedPlayer {
  return { firstName: '', lastName: '', country: null, seed: null }
}

function extractPlayerBlocks(html: string): ParsedPlayer[] {
  const players: ParsedPlayer[] = []

  // Find each name div directly: <div class="ml-2 ..."><span>First.</span><span>Last</span></div>
  // These are the reliable anchors — one per player. The previous approach matched the
  // outer container div (d-flex justify-content-between align-items-center) first,
  // consuming the first player block and only extracting the second.
  const nameDivRe =
    /<div[^>]*class="[^"]*(?:ml-2|ms-2)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
  let match: RegExpExecArray | null

  while ((match = nameDivRe.exec(html)) !== null) {
    const content = match[1]

    // Must contain at least one <span> to be a player name div
    const spanMatches = [...content.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)]
    if (spanMatches.length === 0) continue

    let firstName = ''
    let lastName = ''
    if (spanMatches.length >= 2) {
      firstName = stripTags(spanMatches[0][1]).trim().replace(/\.$/, '')
      lastName = stripTags(spanMatches[1][1]).trim()
    } else if (spanMatches.length === 1) {
      lastName = stripTags(spanMatches[0][1]).trim()
    }

    if (!firstName && !lastName) continue

    // Country: look backwards from this name div for the nearest flag image
    const before = html.slice(Math.max(0, match.index - 300), match.index)
    const flagMatch = /src="\/images\/flags\/([A-Z]{2,3})\.(?:jpg|png|svg)"/gi
    let lastFlag: RegExpExecArray | null = null
    let fm: RegExpExecArray | null
    while ((fm = flagMatch.exec(before)) !== null) lastFlag = fm
    const country = lastFlag ? lastFlag[1].toUpperCase() : null

    // Seed: <small>(1)</small> inside or after the name div
    const seedMatch = /<small[^>]*>\((\d+)\)<\/small>/i.exec(content)
    const seed = seedMatch ? parseInt(seedMatch[1], 10) : null

    players.push({ firstName, lastName, country, seed })
  }

  return players
}

function hasWinnerMarker(teamHtml: string): boolean {
  // Winner indicated by fa-check icon or "winner" class on the name div
  return teamHtml.includes('fa-check') || /class="[^"]*\bwinner\b[^"]*"/.test(teamHtml)
}

function parseSetScores(team1Html: string, team2Html: string): ParsedSet[] {
  const t1Scores = extractSetCells(team1Html)
  const t2Scores = extractSetCells(team2Html)

  const count = Math.min(t1Scores.length, t2Scores.length)
  const sets: ParsedSet[] = []

  for (let i = 0; i < count; i++) {
    const t1 = t1Scores[i]
    const t2 = t2Scores[i]
    if (t1 === null || t2 === null) continue // unplayed set
    sets.push({
      setNumber: i + 1,
      team1Games: t1,
      team2Games: t2,
    })
  }

  return sets
}

function extractSetCells(html: string): (number | null)[] {
  const scores: (number | null)[] = []
  // Match <td class="set ...">VALUE</td>
  const cellRe = /<td[^>]*class="[^"]*\bset\b[^"]*"[^>]*>([\s\S]*?)<\/td>/gi
  let m: RegExpExecArray | null

  while ((m = cellRe.exec(html)) !== null) {
    const value = stripTags(m[1]).trim()
    if (value === '-' || value === '') {
      scores.push(null) // unplayed
    } else {
      const n = parseInt(value, 10)
      scores.push(isNaN(n) ? null : n)
    }
  }

  return scores
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '')
}

// ---------------------------------------------------------------------------
// Module-level cache for country taxonomy
// ---------------------------------------------------------------------------

let countryTermCache: Map<number, string> | null = null

// ---------------------------------------------------------------------------
// HTTP fetcher functions
// ---------------------------------------------------------------------------

const DEFAULT_HEADERS = {
  'User-Agent': 'PadelNachos/1.0',
  Accept: 'application/json',
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Fetch FIP events from WP API. Paginates automatically.
 * @param level Optional level filter ('Gold', 'Silver', 'Bronze')
 */
export async function fetchFipEvents(level?: string): Promise<FipTournament[]> {
  const categoryIds =
    level && FIP_CATEGORY_IDS[level]
      ? [FIP_CATEGORY_IDS[level]]
      : Object.values(FIP_CATEGORY_IDS)

  const all: FipTournament[] = []

  for (const catId of categoryIds) {
    let page = 1
    let totalPages = 1

    while (page <= totalPages) {
      const url = `${FIP_WP_API}/events?category-event=${catId}&page=${page}&per_page=20&_fields=id,title,slug,link,featured_media,category-event,country,gender,event-year`
      const resp = await fetch(url, { headers: DEFAULT_HEADERS })

      if (!resp.ok) {
        if (resp.status === 400) break // No more pages
        throw new Error(`WP API error: ${resp.status} ${url}`)
      }

      const data = await resp.json()
      if (!Array.isArray(data) || data.length === 0) break

      // Read total pages from header
      const wpTotalPages = resp.headers.get('X-WP-TotalPages')
      if (wpTotalPages) totalPages = parseInt(wpTotalPages, 10)

      for (const event of data) {
        try {
          all.push(parseWpEvent(event))
        } catch {
          // Skip unparseable events
        }
      }

      page++
      if (page <= totalPages) await delay(200)
    }
  }

  return all
}

/**
 * Fetch event page HTML from padelfip.com and extract dates + matchscorer IDs.
 *
 * Pass `ctx` (tournament starts_at / ends_at) to enable round_schedule parsing
 * from the "Play Order" overview block. Without ctx, overview.roundSchedule is {}.
 */
export async function fetchEventPageData(
  slug: string,
  ctx?: OverviewContext,
): Promise<{
  dates: EventDates
  matchscorer: MatchscorerIds | null
  drawSize: DrawSize
  overview: OverviewFields
  prizeBreakdown: PrizeBreakdown | null
}> {
  const url = `${FIP_WP_BASE}/events/${slug}/`
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'PadelNachos/1.0' },
  })

  if (!resp.ok) throw new Error(`Failed to fetch event page: ${resp.status} ${url}`)

  const html = await resp.text()
  const dates = parseEventDates(html)
  // If caller didn't supply context, fall back to the dates we just parsed
  // from the page itself. This lets the backfill endpoint work even for rows
  // that didn't already have starts_at/ends_at in the DB.
  const resolvedCtx: OverviewContext = ctx ?? {
    startsAt: dates.startsAt,
    endsAt: dates.endsAt,
  }
  return {
    dates,
    matchscorer: parseMatchscorerIds(html),
    drawSize: parseDrawSizes(html),
    overview: parseOverviewFields(html, resolvedCtx),
    prizeBreakdown: parsePrizeBreakdown(html),
  }
}

/**
 * Fetch WP country taxonomy, cache it, return ISO code for first matching term.
 */
export async function resolveCountryTerms(
  termIds: number[]
): Promise<string | null> {
  if (!countryTermCache) {
    countryTermCache = new Map()
    // Fetch country-fip taxonomy terms
    let page = 1
    let totalPages = 1

    while (page <= totalPages) {
      const url = `${FIP_WP_API}/country?per_page=100&page=${page}&_fields=id,name,slug`
      try {
        const resp = await fetch(url, { headers: DEFAULT_HEADERS })
        if (!resp.ok) break

        const terms = await resp.json()
        if (!Array.isArray(terms) || terms.length === 0) break

        const wpTotal = resp.headers.get('X-WP-TotalPages')
        if (wpTotal) totalPages = parseInt(wpTotal, 10)

        for (const term of terms) {
          if (term.id && term.name) {
            // name contains 3-letter ISO country code (e.g. "ESP", "ARG")
            countryTermCache.set(term.id, term.name.toUpperCase())
          }
        }

        page++
        if (page <= totalPages) await delay(200)
      } catch {
        break
      }
    }
  }

  for (const id of termIds) {
    const iso3 = countryTermCache.get(id)
    if (iso3) return toIso2(iso3) ?? iso3
  }

  return null
}

/**
 * Fetch draw matches from widget.matchscorerlive.com.
 * Fetches main page, discovers MD/WD sub-pages, parses each.
 *
 * Returns `[]` (not an error) when matchscorerlive responds with a 405
 * — that's the signature of an event hosted on the `oopbyday` widget
 * instead of `draw` (FIP Beyond / Promises tournaments). Match data
 * for those flows through the separate oop-monitor cron path; this
 * function is bracket-only.
 */
export async function fetchDrawMatches(
  matchscorerCode: string
): Promise<ParsedMatch[]> {
  const matchscorerHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    Referer: 'https://www.padelfip.com/',
    Accept: 'text/html,application/xhtml+xml',
  }

  const mainUrl = `${MATCHSCORER_WIDGET}/screen/draw/${matchscorerCode}?t=tol`
  const mainResp = await fetch(mainUrl, { headers: matchscorerHeaders })
  if (mainResp.status === 405 || mainResp.status === 404) {
    // Draw widget isn't hosted for this event — typically a FIP Beyond
    // / Promises tournament that uses the oopbyday widget. Caller will
    // see an empty bracket; oop-monitor cron picks up the OOP data
    // separately.
    return []
  }
  if (!mainResp.ok) {
    throw new Error(`Failed to fetch draw main page: ${mainResp.status}`)
  }

  const mainHtml = await mainResp.text()

  // Collect all round pages per draw code (e.g. MD/5, MD/4, MD/3, MD/2, MD/1)
  // Pattern: /screen/draw/{code}/{drawCode}/{roundCount}?t=tol
  const drawPages: Array<{ drawCode: string; roundCount: string; category: 'men' | 'women' }> = []
  const seen = new Set<string>()

  function collectNavLinks(html: string) {
    const re = new RegExp(
      `/screen/draw/${escapeRegex(matchscorerCode)}/([A-Z]+)/(\\d+)\\?t=tol`,
      'g'
    )
    let linkMatch: RegExpExecArray | null
    while ((linkMatch = re.exec(html)) !== null) {
      const drawCode = linkMatch[1]
      const roundCount = linkMatch[2]
      const key = `${drawCode}/${roundCount}`
      if (seen.has(key)) continue
      seen.add(key)

      // Skip qualifying
      if (drawCode === 'MQ' || drawCode === 'WQ') continue
      const category: 'men' | 'women' = drawCode.startsWith('W') ? 'women' : 'men'
      drawPages.push({ drawCode, roundCount, category })
    }
  }

  // Seed from main page (usually shows all MD rounds + only WD/5)
  collectNavLinks(mainHtml)

  const allMatches: ParsedMatch[] = []

  // Track which draw codes we've seen so we can discover missing rounds
  const discoveredDrawCodes = new Set<string>()

  for (let i = 0; i < drawPages.length; i++) {
    const { drawCode, roundCount, category } = drawPages[i]
    const drawUrl = `${MATCHSCORER_WIDGET}/screen/draw/${matchscorerCode}/${drawCode}/${roundCount}?t=tol`
    const drawResp = await fetch(drawUrl, { headers: matchscorerHeaders })

    if (!drawResp.ok) continue

    const drawHtml = await drawResp.text()
    const parsed = parseDrawHtml(drawHtml, category)
    allMatches.push(...parsed)

    // On first page of a new draw code, re-scan for additional nav links
    // This discovers WD rounds that only appear on WD sub-pages
    if (!discoveredDrawCodes.has(drawCode)) {
      discoveredDrawCodes.add(drawCode)
      collectNavLinks(drawHtml)
    }

    await delay(200)
  }

  return allMatches
}

/**
 * Fetch WP media item and return URL, preferring medium size thumbnail.
 */
export async function fetchMediaUrl(mediaId: number): Promise<string | null> {
  if (!mediaId) return null

  const url = `${FIP_WP_API}/media/${mediaId}`
  const resp = await fetch(url, { headers: DEFAULT_HEADERS })
  if (!resp.ok) return null

  const data = await resp.json()

  // Prefer medium size
  const sizes = data.media_details?.sizes
  if (sizes?.medium?.source_url) return sizes.medium.source_url
  if (sizes?.thumbnail?.source_url) return sizes.thumbnail.source_url
  if (data.source_url) return data.source_url

  return null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------------------------------------------------------------------------
// parseOopHtml — parse Order of Play from widget.matchscorerlive.com
// ---------------------------------------------------------------------------

export interface OopPlayer {
  initial: string   // "L."
  surname: string   // "Perez Parra"
  country: string | null   // "ESP" or null if flag missing in OOP HTML
  seed: number | null
  fullDisplay: string // "L. Perez Parra"
}

export interface OopMatch {
  court: string
  scheduleLabel: string  // "Starting at 9:30 AM", "Followed by", "Not before 4:00 PM"
  team1: [OopPlayer, OopPlayer]
  team2: [OopPlayer, OopPlayer]
  category: 'men' | 'women' | null
  round: string | null  // "Q3", "Round of 32", etc.
  matchCode: string | null  // e.g. "MD019", "WQ004" from data-mid
}

export interface OopDay {
  day: number
  matches: OopMatch[]
}

/**
 * Fetch and parse an Order of Play page for a given tournament day.
 * URL: widget.matchscorerlive.com/screen/oopbyday/{code}/{day}
 */
export async function fetchOopDay(
  matchscorerCode: string,
  day: number,
): Promise<OopDay> {
  const url = `${MATCHSCORER_WIDGET}/screen/oopbyday/${matchscorerCode}/${day}?t=tol`
  const res = await fetch(url, { next: { revalidate: 0 } })
  if (!res.ok) return { day, matches: [] }
  const html = await res.text()
  return { day, matches: parseOopHtml(html) }
}

/**
 * Parse OOP HTML into structured match data.
 *
 * HTML structure:
 * - Court groups: each court section starts with a schedule label
 *   ("Starting at X:XX AM/PM") followed by match tables
 * - Match tables: contain two team rows, each with 2 players
 *   (flag img + initial span + surname span + optional seed small)
 * - Schedule flow: "Starting at..." then "Followed by" for subsequent matches
 *   on the same court, "Not before..." for afternoon sessions
 */
export function parseOopHtml(html: string): OopMatch[] {
  const matches: OopMatch[] = []

  // Extract courts from the HTML
  const courtNames: string[] = []
  const courtRe = /class="[^"]*court">\s*([A-Z][^<]+)/gi
  let cm: RegExpExecArray | null
  while ((cm = courtRe.exec(html)) !== null) {
    const name = cm[1].trim()
    if (name && !courtNames.includes(name)) courtNames.push(name)
  }

  // Find all match tables (same pattern as draw parser)
  const tableRe = /<table\b[^>]*class="[^"]*w-100[^"]*"[^>]*>([\s\S]*?)<\/table>/gi
  let tableMatch: RegExpExecArray | null

  // Track current court and schedule label as we iterate
  let currentCourt = ''
  let currentSchedule = ''
  let lastPos = 0

  while ((tableMatch = tableRe.exec(html)) !== null) {
    // Look for court name and schedule label between last position and this table
    const between = html.slice(lastPos, tableMatch.index)
    lastPos = tableMatch.index + tableMatch[0].length

    // Update schedule label FIRST (before court, since court-name class also contains schedule labels)
    // Check for all schedule-related text in the between section
    const allLabels = [...between.matchAll(/(?:class="[^"]*(?:court-name|court-start)[^"]*"[^>]*>|>)\s*(Starting at \d+:\d+ [AP]M|Not before \d+:\d+ [AP]M|Followed by)/gi)]
    if (allLabels.length > 0) {
      currentSchedule = allLabels[allLabels.length - 1][1].trim()
    }

    // Update court name — only from actual court divs (has uppercase letters + " - C"), not schedule labels
    const courtMatches = [...between.matchAll(/class="[^"]*court">\s*([A-Z][A-Z0-9 ]+ - [A-Z0-9]+)/gi)]
    if (courtMatches.length > 0) {
      currentCourt = courtMatches[courtMatches.length - 1][1].trim()
    }

    const tableHtml = tableMatch[0]
    // Only process tables with player data (flags)
    if (!tableHtml.includes('class="flags"')) continue

    // Schedule label is INSIDE the table (in the scorebox-header)
    const insideLabels = tableHtml.match(/Starting at \d+:\d+ [AP]M|Not before \d+:\d+ [AP]M|Followed by/gi)
    if (insideLabels) currentSchedule = insideLabels[insideLabels.length - 1]

    // Category + round from scorebox-header (e.g. "Starting at 9:30 AM Women Q2", "Men Round of 32")
    const headerText = (() => {
      const hm = /scorebox-header[^"]*"[^>]*>([\s\S]*?)<\/tr/i.exec(tableHtml)
      if (!hm) return ''
      return hm[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    })()
    let matchCategory: 'men' | 'women' | null = null
    let matchRound: string | null = null
    if (/\bWomen\b/i.test(headerText)) matchCategory = 'women'
    else if (/\bMen\b/i.test(headerText)) matchCategory = 'men'
    // Extract round: Q1, Q2, Q3, Round of 32, Round of 16, etc.
    const roundMatch = headerText.match(/\b(Q[1-3]|Round of \d+|Quarterfinals?|Quarter|Semifinals?|Semi|Finals?)\b/i)
    if (roundMatch) matchRound = roundMatch[1]

    // Extract players from this table
    // Flag image is optional — some players (e.g. Sharifova) lack a country flag in the OOP HTML
    const playerRe = /(?:<img class="flags" src="\/images\/flags\/([A-Z]+)\.jpg"[\s\S]*?)?<span>([^<]+)<\/span>\s*<span[^>]*>([^<]+)<\/span>(?:\s*<small>\((\d+)\)<\/small>)?/gi
    const players: OopPlayer[] = []
    let pm: RegExpExecArray | null
    while ((pm = playerRe.exec(tableHtml)) !== null) {
      // Skip non-player span matches (e.g. court names, headers) — player initials end with "."
      if (!pm[2].trim().endsWith('.')) continue
      const country = pm[1] || null
      const initial = decodeHtmlEntities(pm[2].trim())
      const surname = decodeHtmlEntities(pm[3].trim())
      const seed = pm[4] ? parseInt(pm[4]) : null
      players.push({
        initial,
        surname,
        country,
        seed,
        fullDisplay: `${initial} ${surname}`,
      })
    }

    // Need exactly 4 players (2 per team) for a doubles match
    if (players.length !== 4) continue

    // Extract match code from MATCH STATS link if present
    const midMatch = /data-mid="([^"]+)"/.exec(tableHtml)
    const matchCode = midMatch ? midMatch[1] : null

    // Use header-parsed category, fallback to match code prefix
    let category = matchCategory
    if (!category && matchCode) {
      if (matchCode.startsWith('MD') || matchCode.startsWith('MQ')) category = 'men'
      else if (matchCode.startsWith('WD') || matchCode.startsWith('WQ')) category = 'women'
    }

    matches.push({
      court: currentCourt || 'Unknown',
      scheduleLabel: currentSchedule || 'TBD',
      team1: [players[0], players[1]],
      team2: [players[2], players[3]],
      category,
      round: matchRound,
      matchCode,
    })
  }

  return matches
}

// decodeHtmlEntities already defined above at line 133

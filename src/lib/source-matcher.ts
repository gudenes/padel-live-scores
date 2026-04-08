// src/lib/source-matcher.ts
//
// Token-subset entity matcher for cross-source tournament deduplication
// + round name normalizer for cross-source round comparisons.
//
// Matching rule (tournaments):
//   1. Normalize name: strip diacritics, lowercase, strip year tokens,
//      strip noise tokens ('premier', 'padel', 'tour', etc.)
//   2. isTokenSubset(a, b): every token in a must appear in b's token set
//      (or vice versa — we accept bidirectional subsets)
//   3. For resolving a single candidate, also filter by year extracted
//      from starts_at.
//
// Round normalizer:
//   Our DB has BOTH formats coexisting:
//     Verbose: "Round of 64", "Quarter", "Semifinals", "Finals"
//     Short:   "R64", "QF", "SF", "F"
//   Premier's API uses a third: "Men SF", "Women R32", "Men Q1"
//   normalizeRound() maps all three to canonical short codes.

// ── Constants ────────────────────────────────────────────────

export const NOISE_TOKENS: ReadonlySet<string> = new Set([
  'premier',
  'padel',
  'tour',
  'open',
  'presented',
  'by',
  'championship',
  'championships',
  'season',
  'the',
  'of',
  'cup',
  // Sponsor prefixes commonly attached to Premier events
  'lotto',
  'belfius',
  'betclic',
  'bnl',
  'gnp',
  'greenweez',
  'ooredoo',
  'alpine',
  'motorola',
  'razr',
  'banco',
  'chile',
  'oysho',
])

// ── Normalization ─────────────────────────────────────────────

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/** Tokenize a tournament name, stripping years, noise words, and punctuation. */
export function tokenize(s: string | null | undefined): string[] {
  if (!s) return []
  return stripAccents(s)
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 0 && !NOISE_TOKENS.has(t))
}

/** Extract a 4-digit year from an ISO date string. Returns null on failure. */
export function yearOf(date: string | Date | null | undefined): number | null {
  if (!date) return null
  try {
    const d = typeof date === 'string' ? new Date(date) : date
    const y = d.getFullYear()
    if (!Number.isFinite(y) || y < 1900 || y > 2100) return null
    return y
  } catch {
    return null
  }
}

// ── Matching ──────────────────────────────────────────────────

/**
 * Returns true when every token of `a` appears in `b`'s token set, OR vice
 * versa. Bidirectional subset handles both "Brussels P2" → sponsored name
 * and the reverse direction.
 */
export function isTokenSubset(a: string, b: string): boolean {
  const ta = new Set(tokenize(a))
  const tb = new Set(tokenize(b))
  if (ta.size === 0 || tb.size === 0) return false
  // Forward: every token in ta is in tb
  if ([...ta].every(t => tb.has(t))) return true
  // Reverse: every token in tb is in ta
  if ([...tb].every(t => ta.has(t))) return true
  return false
}

/** Jaccard similarity 0..1 — used by match-level player name overlap. */
export function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(tokenize(a))
  const tb = new Set(tokenize(b))
  if (ta.size === 0 && tb.size === 0) return 0
  const intersection = [...ta].filter(t => tb.has(t)).length
  const union = new Set([...ta, ...tb]).size
  return union === 0 ? 0 : intersection / union
}

// ── Candidate resolution ──────────────────────────────────────

export interface CandidateTournament {
  id: string
  name: string
  starts_at: string | null
}

export interface ResolveInput {
  name: string
  year: number | null
}

export type ResolveReason =
  | 'single'
  | 'no_candidate'
  | 'multiple_candidates'

export interface ResolveResult {
  match: CandidateTournament | null
  reason: ResolveReason
  candidateCount: number
}

/**
 * Given a source tournament's (name, year) and a list of candidates from our
 * DB, returns the unique match if exactly one candidate matches.
 */
export function resolveSingleCandidate(
  input: ResolveInput,
  candidates: CandidateTournament[],
): ResolveResult {
  const yearFiltered = input.year !== null
    ? candidates.filter(c => yearOf(c.starts_at) === input.year)
    : candidates
  const matches = yearFiltered.filter(c => isTokenSubset(input.name, c.name))

  if (matches.length === 0) {
    return { match: null, reason: 'no_candidate', candidateCount: 0 }
  }
  if (matches.length === 1) {
    return { match: matches[0], reason: 'single', candidateCount: 1 }
  }
  return { match: null, reason: 'multiple_candidates', candidateCount: matches.length }
}

// ── Round normalizer ──────────────────────────────────────────

type CanonicalRound = 'R128' | 'R64' | 'R32' | 'R16' | 'QF' | 'SF' | 'F' | 'Q1' | 'Q2' | 'Q3'

const VERBOSE_TO_CANONICAL: Record<string, CanonicalRound> = {
  'round of 128': 'R128',
  'round of 64': 'R64',
  'round of 32': 'R32',
  'round of 16': 'R16',
  'quarter': 'QF',
  'quarters': 'QF',
  'quarterfinal': 'QF',
  'quarterfinals': 'QF',
  'semifinal': 'SF',
  'semifinals': 'SF',
  'semis': 'SF',
  'final': 'F',
  'finals': 'F',
}

const SHORT_FORMS: ReadonlySet<string> = new Set([
  'r128', 'r64', 'r32', 'r16', 'qf', 'sf', 'f', 'q1', 'q2', 'q3',
])

/**
 * Normalize any of three round-name formats to a canonical short code:
 *   - Our verbose: "Round of 64" → "R64", "Semifinals" → "SF"
 *   - Our short:   "R64" → "R64" (passthrough, uppercased)
 *   - Premier's:   "Men SF" → "SF" (strip category prefix)
 *
 * Returns null for null/undefined/empty/unrecognized input.
 */
export function normalizeRound(raw: string | null | undefined): CanonicalRound | null {
  if (!raw) return null
  let cleaned = raw.trim().toLowerCase()
  if (cleaned === '') return null

  // Strip Premier's "men"/"women" prefix if present
  cleaned = cleaned.replace(/^(men|women)\s+/i, '')

  // Try the verbose map
  if (VERBOSE_TO_CANONICAL[cleaned]) {
    return VERBOSE_TO_CANONICAL[cleaned]
  }

  // Try the short form
  if (SHORT_FORMS.has(cleaned)) {
    return cleaned.toUpperCase() as CanonicalRound
  }

  return null
}

/**
 * Extract the category ("men" | "women") from a Premier round_name like
 * "Men SF" or "Women R32". Returns null if no category prefix is present.
 */
export function extractCategoryFromPremierRound(
  raw: string | null | undefined,
): 'men' | 'women' | null {
  if (!raw) return null
  const m = /^(men|women)\b/i.exec(raw.trim())
  if (!m) return null
  return m[1].toLowerCase() as 'men' | 'women'
}

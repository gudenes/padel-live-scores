/**
 * Group tournament rows by physical-event identity, return one survivor per
 * group. Used by the earnings backfill to avoid double-counting events that
 * have multiple rows from cross-source ingest pipelines.
 *
 * The same physical event can be represented by 2+ tournament rows when
 * padelapi-side ingest and FIP-side ingest both create independent rows
 * (CLAUDE.md "Pattern B multi-pipeline"). Brussels P2 2026 is the canonical
 * example with 3 rows: padelapi sync, fip-event-page-enricher, and a
 * stale ingest with no prize data.
 *
 * Pure function. No I/O, no DB calls.
 *
 * Survivor pick: most-complete row wins (the row most likely to have the
 * prize data the engine needs).
 */

export type DedupRow = {
  id: string
  name: string
  starts_at: string | null
  prize_money_eur: number | null
  prize_breakdown: Record<string, unknown> | null
  fip_id: string | null
  padelapi_id: string | null
}

// Tokens stripped from tournament names before grouping. These are sponsor
// or generic descriptors that shouldn't affect identity matching.
const NOISE_TOKENS = new Set([
  // Generic
  'premier', 'padel', 'tour', 'open', 'cup', 'championship', 'championships',
  'presented', 'by', 'the', 'club', 'tournament',
  // Common sponsors observed in our data
  'lotto', 'belfius', 'motorola', 'razr', 'bmw', 'cupra', 'red', 'bull',
  'mediolanum', 'gnp', 'bnl',
])

/**
 * Normalise a tournament name into a stable identity signature.
 *   - lowercase
 *   - strip diacritics
 *   - tokenise on non-alphanumerics
 *   - drop pure-numeric tokens (year, edition number)
 *   - drop noise tokens (sponsor / generic words)
 *   - sort + join with '|'
 *
 * Examples:
 *   "Lotto Brussels Premier Padel P2 Presented By Belfius"
 *     → "brussels|p2"
 *   "Brussels P2 2026" → "brussels|p2"
 */
export function normalizeName(name: string): string {
  const stripped = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

  const tokens = stripped
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 0)
    .filter(t => !/^\d+$/.test(t))   // drop pure-numeric (year, edition number)
    .filter(t => !NOISE_TOKENS.has(t))

  return tokens.sort().join('|')
}

/** Year derived from starts_at. Falls back to 'unknown' for null dates. */
function yearOf(row: DedupRow): string {
  if (!row.starts_at) return 'unknown'
  return row.starts_at.slice(0, 4)
}

/** Group key for dedup: (normalized name + year). */
export function groupKey(row: DedupRow): string {
  return `${normalizeName(row.name)}::${yearOf(row)}`
}

/**
 * Score a row by data completeness — higher = more likely to be the survivor.
 *
 * Hard-priority: any row with prize_money_eur set wins outright over rows
 * without it (the engine's source-priority chain only produces output when
 * prize data is present, so the prize-bearing row is the only useful one).
 *
 * Within rows that have or lack prize_money_eur uniformly, count non-null
 * fields among the additional columns we read.
 */
export function scoreRow(row: DedupRow): number {
  let score = 0
  if (row.prize_money_eur != null) score += 1000  // hard priority
  if (row.prize_breakdown != null) score += 100
  if (row.fip_id != null) score += 10
  if (row.padelapi_id != null) score += 1
  return score
}

/**
 * Given many tournament rows, return one survivor per (normalized name + year)
 * group. Stable ordering: when scores tie, the row with the lexicographically
 * smallest id wins (so the result is deterministic across runs).
 */
export function dedupeTournaments<T extends DedupRow>(rows: T[]): T[] {
  const groups = new Map<string, T>()
  for (const row of rows) {
    const key = groupKey(row)
    const cur = groups.get(key)
    if (!cur) {
      groups.set(key, row)
      continue
    }
    const curScore = scoreRow(cur)
    const newScore = scoreRow(row)
    if (newScore > curScore || (newScore === curScore && row.id < cur.id)) {
      groups.set(key, row)
    }
  }
  return [...groups.values()]
}

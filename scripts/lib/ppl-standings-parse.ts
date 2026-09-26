// Parses a Pro Padel League standings table into typed rows.
//
// The league's standings POINTS are the actual standing, and they are not
// derivable from results. Proof, from their own PPL II women's season table:
// Toronto is 6-0 (100% of matches won) and sits SECOND, behind Las Vegas on
// 4-2. Whatever awards those points, it is not the win/loss record. So they
// are read from upstream rather than computed — the opposite of `ties_won`
// and `courts_won` in ppl-standings.ts, which we do derive.
//
// THE COLUMN LAYOUT CHANGES WITH THE SCOPE. That is the central constraint:
//
//   overall  RANK | TEAM | POINTS | MATCHES PLAYED | Men's | Women's | %...
//   gendered RANK | TEAM | POINTS | MATCHES PLAYED | Wins  | Losses  | %...
//
// Column 4 is a record string like "3-1" in one and an integer win count in
// the other. Reading by fixed index would parse "3-1" as a win total and
// silently produce garbage, so every field is looked up by its header.

export interface StandingsCell {
  /** Team slug from the row's team link, e.g. `dc-matrix`. */
  slug: string | null
  /** Header text (lowercased, whitespace-collapsed) -> cell text. */
  cells: Record<string, string>
}

export interface RawStandingsTable {
  headers: string[]
  rows: StandingsCell[]
}

export interface ParsedStandingsRow {
  slug: string
  rank: number | null
  points: number | null
  matchesPlayed: number | null
  wins: number | null
  losses: number | null
  pctMatches: number | null
  pctSets: number | null
  pctGames: number | null
  pctPoints: number | null
}

/** `"37"` -> 37. Null on anything that is not a plain integer. */
export function parseIntCell(v: string | null | undefined): number | null {
  if (v == null) return null
  const s = v.trim()
  if (!/^-?\d+$/.test(s)) return null
  return Number(s)
}

/**
 * `"75%"` -> 75. Returns the PERCENT, not a fraction.
 *
 * Stored as upstream shows it. Converting to 0.75 here would invite a second
 * conversion at render time and put a 0.75% on screen.
 */
export function parsePercentCell(v: string | null | undefined): number | null {
  if (v == null) return null
  const m = v.trim().match(/^(\d+(?:\.\d+)?)\s*%$/)
  return m ? Number(m[1]) : null
}

/**
 * `"3-1"` -> { wins: 3, losses: 1 }.
 *
 * Only used for the overall table, whose Men's / Women's columns carry a
 * record rather than a count.
 */
export function parseRecordCell(v: string | null | undefined): { wins: number; losses: number } | null {
  if (v == null) return null
  const m = v.trim().match(/^(\d+)\s*-\s*(\d+)$/)
  if (!m) return null
  return { wins: Number(m[1]), losses: Number(m[2]) }
}

/** Header text as the extractor normalises it: lowercase, single spaces. */
function norm(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Finds a column by trying each candidate header in order.
 *
 * Returns null when none matches, which the caller turns into a null field
 * rather than a wrong one. A header we have never seen must not silently
 * borrow a neighbouring column's value.
 */
function pick(cells: Record<string, string>, candidates: string[]): string | null {
  for (const c of candidates) {
    const v = cells[c]
    if (v != null) return v
  }
  return null
}

export function parseStandingsTable(table: RawStandingsTable): ParsedStandingsRow[] {
  const out: ParsedStandingsRow[] = []

  for (const row of table.rows) {
    if (!row.slug) continue // no team link: not a standings row

    const cells: Record<string, string> = {}
    for (const [k, v] of Object.entries(row.cells)) cells[norm(k)] = v

    // Wins/losses come from different columns depending on the scope. In the
    // overall table they are split across two record columns (men's and
    // women's), so they are summed; a single gendered column would be half
    // the truth.
    let wins = parseIntCell(pick(cells, ['wins']))
    let losses = parseIntCell(pick(cells, ['losses']))
    if (wins == null && losses == null) {
      const mens = parseRecordCell(pick(cells, ["men's", 'mens', "men's record"]))
      const womens = parseRecordCell(pick(cells, ["women's", 'womens', "women's record"]))
      if (mens || womens) {
        wins = (mens?.wins ?? 0) + (womens?.wins ?? 0)
        losses = (mens?.losses ?? 0) + (womens?.losses ?? 0)
      }
    }

    out.push({
      slug: row.slug,
      // The rank cell can carry podium annotations ("1GS 11ST"), so the
      // leading integer is taken rather than the whole string.
      rank: parseIntCell((pick(cells, ['rank']) ?? '').trim().split(/\s|\n/)[0]),
      points: parseIntCell(pick(cells, ['points'])),
      matchesPlayed: parseIntCell(pick(cells, ['matches played', 'matches'])),
      wins,
      losses,
      pctMatches: parsePercentCell(pick(cells, ['%matches won', '% matches won'])),
      pctSets: parsePercentCell(pick(cells, ['%sets won', '% sets won'])),
      pctGames: parsePercentCell(pick(cells, ['%games won', '% games won'])),
      pctPoints: parsePercentCell(pick(cells, ['%points won', '% points won'])),
    })
  }

  return out
}

/**
 * Upstream's own consistency check: a franchise's overall points are the sum
 * of its two gendered tables. Verified against their published season table
 * (DC Matrix 37 men's + 34 women's = 71 overall).
 *
 * Used as a pre-write gate. If it stops holding, either the scrape drifted
 * onto the wrong columns or the league changed its scoring — and in both
 * cases writing would put a wrong number where an official one is implied.
 */
export function checkPointsIdentity(
  overall: ParsedStandingsRow[],
  men: ParsedStandingsRow[],
  women: ParsedStandingsRow[],
): Array<{ slug: string; overall: number; sum: number }> {
  const bySlug = (rows: ParsedStandingsRow[]) => new Map(rows.map((r) => [r.slug, r]))
  const m = bySlug(men)
  const w = bySlug(women)
  const bad: Array<{ slug: string; overall: number; sum: number }> = []

  for (const o of overall) {
    if (o.points == null) continue
    const sum = (m.get(o.slug)?.points ?? 0) + (w.get(o.slug)?.points ?? 0)
    if (sum !== o.points) bad.push({ slug: o.slug, overall: o.points, sum })
  }
  return bad
}

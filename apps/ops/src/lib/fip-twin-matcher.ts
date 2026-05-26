// src/lib/fip-twin-matcher.ts
//
// Cross-source tournament matching: padelapi-sourced rows ↔ padelgod-
// discovered FIP twins. Used by the ops dashboard to surface a FIP ID
// for tournaments like Brussels P2 that were created via padelapi
// (so `fip_id` is null on our canonical row) but also exist on
// padelfip.com (so padelgod's `tournament-discovery` worker has already
// captured them as a *separate* row with source='fip' and fip_id set).
//
// This is not a general merge tool — it only suggests + links. The
// orphan twin row stays in the DB until a later cleanup pass runs the
// `scripts/merge-tournament-duplicates.ts` script, which handles FKs.
//
// The matching logic is deliberately conservative:
//   1. Same year (extracted from starts_at or slug)
//   2. Same level (p1/p2/gold/silver/bronze/…)
//   3. Same country (where both have country set)
//   4. Name token subset — every non-noise token in one side appears in
//      the other side's token set
//
// Conservative defaults produce fewer false positives. Operators can
// always link manually via a second endpoint if this rejects a real match.
//
// Pure — no I/O. Callers pass in both the target and candidate rows.

// ── Types ────────────────────────────────────────────────────────────────

export interface TournamentLike {
  id: string
  name: string
  slug: string | null
  fip_id: string | null
  padelapi_id: string | null
  source: string | null
  level: string | null
  country: string | null
  starts_at: string | null
}

export type TwinConfidence = 'high' | 'medium' | 'low'

export interface TwinMatch {
  candidate: TournamentLike
  confidence: TwinConfidence
  matchedTokens: string[]
  reasons: string[]
}

// ── Normalization — matches CLAUDE.md's tournament-entity-resolution rule ─

/**
 * Lowercase, strip diacritics, tokenize on non-alphanumerics, drop
 * 4-digit years, drop noise tokens that appear across many events.
 * Mirrors the algorithm described in `docs/` (tournament entity resolution)
 * and used by `scripts/merge-tournament-duplicates.ts`.
 */
export function tokenize(input: string): string[] {
  const noDiacritics = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  const noYear = noDiacritics.replace(/\b20\d{2}\b/g, '')
  const tokens = noYear.split(/[^a-z0-9]+/).filter(Boolean)
  return tokens.filter((t) => !NOISE_TOKENS.has(t))
}

const NOISE_TOKENS = new Set([
  'premier',
  'padel',
  'tour',
  'open',
  'season',
  'championship',
  'presented',
  'by',
  'the',
  'of',
  'cup',
  'trophy',
  'fip',
  // Common sponsor prefixes encountered on padelapi names — e.g. "Lotto
  // Brussels Premier Padel P2 Presented By Belfius".
  'lotto',
  'belfius',
  'circus',
  'motorola',
  'razr',
])

/**
 * Extract the event year. Prefer `starts_at` when present (it's canonical
 * on padelapi rows); fall back to sniffing a year out of slug/name.
 */
export function extractYear(t: TournamentLike): number | null {
  if (t.starts_at) {
    const y = new Date(t.starts_at).getUTCFullYear()
    if (!Number.isNaN(y)) return y
  }
  const haystack = `${t.slug ?? ''} ${t.fip_id ?? ''} ${t.name}`
  const m = haystack.match(/\b(20\d{2})\b/)
  return m ? parseInt(m[1]!, 10) : null
}

// ── Matcher ──────────────────────────────────────────────────────────────

/**
 * Given a target tournament and a pool of candidates (typically all
 * tournaments with `source='fip'` AND `fip_id IS NOT NULL`), return the
 * best twin match — or null if no candidate clears the bar.
 *
 * The pool filtering is the caller's job so this function stays pure and
 * testable. Typical usage:
 *
 *   const target = await fetchTournament(supabase, targetId)
 *   const pool = await fetchFipDiscoveredTournaments(supabase)
 *   const twin = findFipTwin(target, pool)
 */
export function findFipTwin(
  target: TournamentLike,
  candidates: readonly TournamentLike[],
): TwinMatch | null {
  // Guard: if target already has a fip_id, no match is needed.
  if (target.fip_id) return null

  const targetYear = extractYear(target)
  const targetTokens = new Set(tokenize(target.name))
  if (targetTokens.size === 0) return null

  let best: TwinMatch | null = null

  for (const c of candidates) {
    if (!c.fip_id) continue // pool filter should have excluded these
    if (c.id === target.id) continue

    const reasons: string[] = []

    // Year must match when both sides have one. If either side is
    // missing a year, we allow it but lose a confidence point.
    const candYear = extractYear(c)
    let yearOk = true
    if (targetYear !== null && candYear !== null) {
      if (targetYear !== candYear) continue
      reasons.push(`year=${targetYear}`)
    } else {
      yearOk = false
    }

    // Country match (loose — if target has country set, candidate must
    // either match or have country null since padelgod-discovered rows
    // often have country null).
    if (target.country && c.country && target.country !== c.country) continue
    if (target.country) reasons.push(`country=${target.country}`)

    // Level match — if both set, must match exactly. "p2" == "p2".
    if (target.level && c.level && normalizeLevel(target.level) !== normalizeLevel(c.level)) {
      continue
    }
    if (target.level && c.level) reasons.push(`level=${target.level}`)

    // Token-subset: every target token (after noise filter) must appear
    // in the candidate's tokens. Padelapi names often have sponsor
    // prefixes the FIP slug doesn't — so the candidate tokens are the
    // subset, not the other way around. We check both directions and
    // take the smaller side as the driver.
    const candTokens = new Set(tokenize([c.name, c.slug, c.fip_id].filter(Boolean).join(' ')))
    if (candTokens.size === 0) continue

    const { matched, subset } = compareTokens(targetTokens, candTokens)
    if (!subset) continue
    reasons.push(`tokens=${matched.join('+')}`)

    // Confidence heuristic:
    //   high   — year + country + level + tokens all aligned
    //   medium — missing country OR level, but year + tokens aligned
    //   low    — missing year info
    const confidence: TwinConfidence =
      yearOk && target.country && target.level
        ? 'high'
        : yearOk
          ? 'medium'
          : 'low'

    const match: TwinMatch = {
      candidate: c,
      confidence,
      matchedTokens: matched,
      reasons,
    }

    if (!best || rankConfidence(match.confidence) > rankConfidence(best.confidence)) {
      best = match
    } else if (
      rankConfidence(match.confidence) === rankConfidence(best.confidence) &&
      match.matchedTokens.length > best.matchedTokens.length
    ) {
      best = match
    }
  }

  return best
}

function rankConfidence(c: TwinConfidence): number {
  return c === 'high' ? 3 : c === 'medium' ? 2 : 1
}

function normalizeLevel(l: string): string {
  return l.toLowerCase().trim()
}

function compareTokens(
  a: Set<string>,
  b: Set<string>,
): { matched: string[]; subset: boolean } {
  // Use the SMALLER set as the subset driver — padelapi names have
  // sponsor prefixes that won't be in FIP slugs, and vice versa.
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a]
  const matched: string[] = []
  for (const t of smaller) {
    if (larger.has(t)) matched.push(t)
  }
  // Require every smaller-side token to appear in the larger set AND
  // at least 2 content tokens matched. Single-word tournament names
  // (rare) would otherwise match too eagerly.
  const subset = matched.length === smaller.size && matched.length >= 2
  return { matched, subset }
}

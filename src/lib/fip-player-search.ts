// src/lib/fip-player-search.ts
// Thin client over padelfip.com's player search endpoint.
// Used to resolve players that appear in FIP entry-list PDFs but aren't yet
// in our DB (typically ranked > 1000 where our daily ranking cron doesn't reach).
//
// Endpoint (verified 2026-04-21):
//   GET https://www.padelfip.com/wp-json/fip/v1/player/search?q=<name>
//   No auth, no nonce. Returns a JSON array of matching players.

import { normalizeCountry } from './player-resolver'

const SEARCH_URL = 'https://www.padelfip.com/wp-json/fip/v1/player/search'

export interface FipPlayerSearchInput {
  /** Full or partial player name. Used as the `q` query param. */
  name: string
  /** ISO 2 or 3-letter country code. Used to filter multi-result responses. */
  country?: string | null
  /** 'men' or 'women' — maps to the API's `gender` field (male/female). */
  category?: 'men' | 'women' | null
  /** If the search returns multiple candidates after filtering, pick the one whose rank is closest to this. */
  rankingHint?: number | null
}

export interface FipPlayerSearchResult {
  /** FIP internal player id, e.g. "P100312". Prepend "fip-" to match our DB's fip_id convention. */
  playerId: string
  /** First name(s) as returned by the API. */
  name: string
  /** Surname(s) as returned by the API. */
  surname: string
  /** `${name} ${surname}` convenience field. */
  fullName: string
  /** 3-letter ISO code as returned by FIP ("BRA", "ARG", etc.). */
  nationality: string
  gender: 'male' | 'female'
  rank: number
  points: number
  /** Profile page URL on padelfip.com. */
  url: string
  /** Thumbnail URL; may be empty string. */
  thumbnail: string
  /** Country flag image URL. */
  countryFlag: string
}

interface RawSearchHit {
  player_id: string
  name: string
  surname: string
  nationality: string
  gender: string
  rank: number
  points: number
  url: string
  thumbnail: string
  country_flag: string
  category?: string
  country_name?: string
  year?: number
  week_no?: number
}

export interface SearchOptions {
  /** Inject a custom fetch for testing. Defaults to the global `fetch`. */
  fetchFn?: typeof fetch
}

/** Build the public search URL with the query parameter URL-encoded. */
export function buildSearchUrl(input: Pick<FipPlayerSearchInput, 'name'>): string {
  return buildSearchUrlForQuery(input.name)
}

function buildSearchUrlForQuery(q: string): string {
  const params = new URLSearchParams({ q: q.trim() })
  // URLSearchParams encodes space as '+'; FIP accepts both but %20 is what the
  // site's own UI emits — mirror that to keep request fingerprints identical.
  return `${SEARCH_URL}?${params.toString().replace(/\+/g, '%20')}`
}

/**
 * FIP's search endpoint uses phrase-like matching that fails on long multi-word
 * queries (e.g. 4-token "Genaro Manuel Campuzano Vazquez" returns an error even
 * though the player exists). Generate progressively shorter / more-distinctive
 * query candidates from the full name:
 *
 *   1. Full name                        — most specific (usually hits for 1–3 tokens)
 *   2. Last two tokens                  — handles "First Surname Surname" form
 *   3. Last one token                   — surname alone; filters narrow down
 *   4. Each individual ≥4-char token    — catches names where the real surname
 *                                         is NOT the last token (e.g. Paraguayan
 *                                         compound "Olga Arami Bareiro Mora" —
 *                                         FIP stores her as surname "Bareiro")
 *
 * Deduplicated while preserving order so the most specific is tried first.
 */
export function candidateQueries(name: string): string[] {
  const trimmed = name.trim().replace(/\s+/g, ' ')
  if (!trimmed) return []
  const toks = trimmed.split(' ')
  const out = [trimmed]
  if (toks.length >= 3) out.push(toks.slice(-2).join(' '))
  if (toks.length >= 2) out.push(toks[toks.length - 1]!)
  // For 4+ token names, also try each distinctive middle/last token individually.
  // Short common tokens (de, la, da, dos) are skipped — they'd explode the result
  // set without narrowing anything useful.
  if (toks.length >= 4) {
    for (const t of toks) {
      if (t.length >= 4 && !out.includes(t)) out.push(t)
    }
  }
  // Dedup while preserving order
  return [...new Set(out)]
}

const GENDER_FOR_CATEGORY: Record<'men' | 'women', 'male' | 'female'> = {
  men: 'male',
  women: 'female',
}

function toResult(h: RawSearchHit): FipPlayerSearchResult {
  return {
    playerId: h.player_id,
    name: h.name,
    surname: h.surname,
    fullName: `${h.name} ${h.surname}`.trim(),
    nationality: h.nationality,
    gender: h.gender as 'male' | 'female',
    rank: h.rank,
    points: h.points,
    url: h.url,
    thumbnail: h.thumbnail,
    countryFlag: h.country_flag,
  }
}

/**
 * Search the FIP public player index for a single best match.
 *
 * Resolution:
 *   1. Query by name.
 *   2. Filter by `category` (men→male, women→female) if provided; rows with
 *      unrecognised `gender` values are dropped.
 *   3. Filter by `country` (both sides normalized via `normalizeCountry`) if
 *      provided.
 *   4. If multiple rows pass filters, pick the one whose `rank` is closest to
 *      `rankingHint` when supplied; otherwise return the first.
 *
 * Returns `null` on: zero hits, filters eliminate all, non-2xx HTTP response,
 * or network/parse errors. Callers should treat null as "not found" — never
 * throws for expected error paths.
 */
export async function searchFipPlayer(
  input: FipPlayerSearchInput,
  opts: SearchOptions = {}
): Promise<FipPlayerSearchResult | null> {
  const fetchFn = opts.fetchFn ?? fetch
  const wantGender = input.category ? GENDER_FOR_CATEGORY[input.category] : null
  const wantCountry = input.country ? normalizeCountry(input.country) : null

  // Apply the gender+country filter and optional ranking-proximity pick.
  // Returns null when no rows pass the filter.
  const pick = (hits: RawSearchHit[]): FipPlayerSearchResult | null => {
    let pool = hits
    if (wantGender) pool = pool.filter(h => h.gender === wantGender)
    if (wantCountry) pool = pool.filter(h => normalizeCountry(h.nationality) === wantCountry)
    if (pool.length === 0) return null
    if (pool.length === 1) return toResult(pool[0]!)
    if (input.rankingHint != null) {
      let best = pool[0]!
      let bestDist = Math.abs(best.rank - input.rankingHint)
      for (let i = 1; i < pool.length; i++) {
        const d = Math.abs(pool[i]!.rank - input.rankingHint)
        if (d < bestDist) { best = pool[i]!; bestDist = d }
      }
      return toResult(best)
    }
    return toResult(pool[0]!)
  }

  // Try each candidate query. Keep going until one yields a row that passes
  // the filter — a query returning many unrelated rows (e.g. "Mora" returning
  // 20 Spanish players when we want a Paraguayan Olga Bareiro Mora) must NOT
  // terminate the loop; we need to try the next candidate (e.g. "Bareiro"
  // alone — the one that actually matches).
  for (const q of candidateQueries(input.name)) {
    let body: unknown
    try {
      const res = await fetchFn(buildSearchUrlForQuery(q))
      if (!res.ok) continue
      body = await res.json()
    } catch {
      continue
    }
    if (!Array.isArray(body)) continue
    const hits = body as RawSearchHit[]
    if (hits.length === 0) continue
    const picked = pick(hits)
    if (picked) return picked
  }

  return null
}

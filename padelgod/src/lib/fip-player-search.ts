// padelgod/src/lib/fip-player-search.ts
//
// Thin client over padelfip.com's public player-search endpoint. Mirrors
// src/lib/fip-player-search.ts (manual ops flow). Used by the entry-list
// fetcher to resolve players that appear on FIP PDFs but aren't in
// public.players yet (typically rank > 1000, where the daily ranking
// cron stops).
//
// Endpoint:
//   GET https://www.padelfip.com/wp-json/fip/v1/player/search?q=<name>
//   No auth, no nonce. Returns a JSON array of matching players.

import type { AxiosInstance } from 'axios';
import { normalizeCountry } from './country.js';

const SEARCH_URL = 'https://www.padelfip.com/wp-json/fip/v1/player/search';

export interface FipPlayerSearchInput {
  name: string;
  country?: string | null;
  category?: 'men' | 'women' | null;
  /** When multiple results survive filters, pick the one whose rank is closest to this. */
  rankingHint?: number | null;
}

export interface FipPlayerSearchResult {
  /** "P100312". Prepend "fip-" to match our DB's fip_id convention. */
  playerId: string;
  name: string;
  surname: string;
  fullName: string;
  /** 3-letter ISO from FIP (BRA, ARG, etc.). */
  nationality: string;
  gender: 'male' | 'female';
  rank: number;
  points: number;
  url: string;
  thumbnail: string;
  countryFlag: string;
}

interface RawSearchHit {
  player_id: string;
  name: string;
  surname: string;
  nationality: string;
  gender: string;
  rank: number;
  points: number;
  url: string;
  thumbnail: string;
  country_flag: string;
}

const GENDER_FOR_CATEGORY: Record<'men' | 'women', 'male' | 'female'> = {
  men: 'male',
  women: 'female',
};

function buildSearchUrl(q: string): string {
  const params = new URLSearchParams({ q: q.trim() });
  return `${SEARCH_URL}?${params.toString().replace(/\+/g, '%20')}`;
}

export function candidateQueries(name: string): string[] {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed) return [];
  const toks = trimmed.split(' ');
  const out = [trimmed];
  if (toks.length >= 3) out.push(toks.slice(-2).join(' '));
  if (toks.length >= 2) out.push(toks[toks.length - 1]!);
  if (toks.length >= 4) {
    for (const t of toks) {
      if (t.length >= 4 && !out.includes(t)) out.push(t);
    }
  }
  return [...new Set(out)];
}

function tokenizeName(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t.length >= 3);
}

/**
 * Count distinct ≥3-char tokens shared by two names. Short connecting words
 * ("de", "la", "do") are excluded so they can't fake a match.
 */
export function nameTokensOverlap(a: string, b: string): number {
  const aTokens = new Set(tokenizeName(a));
  if (aTokens.size === 0) return 0;
  const bTokens = new Set(tokenizeName(b));
  let n = 0;
  for (const t of aTokens) if (bTokens.has(t)) n++;
  return n;
}

/**
 * Decide whether a search hit's full name plausibly matches the input name.
 * Guards against the surname-only candidate query returning an unrelated
 * player who happens to share one surname token (e.g. searching for
 * "Nuria Rodriguez Camacho" via the "Camacho" fallback and getting back
 * "Elvira Camacho Marente"). Requires at least 2 distinct ≥3-char tokens
 * to overlap, OR — when the input name itself has fewer than 2 such tokens
 * — every input token to overlap.
 */
export function isPlausibleNameMatch(inputName: string, hitFullName: string): boolean {
  const inputTokens = tokenizeName(inputName);
  if (inputTokens.length === 0) return false;
  const required = Math.min(2, inputTokens.length);
  return nameTokensOverlap(inputName, hitFullName) >= required;
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
  };
}

/**
 * Search FIP for a single best player match. Tries progressively shorter
 * query variants because FIP's endpoint fails on long multi-token queries.
 * Returns null on any non-match (no hits, filters eliminate all, network
 * error). Never throws — caller treats null as "not found".
 */
export async function searchFipPlayer(
  http: AxiosInstance,
  input: FipPlayerSearchInput
): Promise<FipPlayerSearchResult | null> {
  const wantGender = input.category ? GENDER_FOR_CATEGORY[input.category] : null;
  const wantCountry = input.country ? normalizeCountry(input.country) : null;

  const pick = (hits: RawSearchHit[]): FipPlayerSearchResult | null => {
    let pool = hits;
    if (wantGender) pool = pool.filter((h) => h.gender === wantGender);
    if (wantCountry) {
      pool = pool.filter((h) => normalizeCountry(h.nationality) === wantCountry);
    }
    // Reject hits whose full name doesn't share enough tokens with the
    // input. Without this guard the surname-only candidate query (e.g.
    // "Camacho" derived from "Nuria Rodriguez Camacho") returns whoever
    // happens to share that surname (e.g. "Elvira Camacho Marente"), and
    // the country/gender filters happily pass them through.
    pool = pool.filter((h) =>
      isPlausibleNameMatch(input.name, `${h.name} ${h.surname}`.trim())
    );
    if (pool.length === 0) return null;
    if (pool.length === 1) return toResult(pool[0]!);
    if (input.rankingHint != null) {
      let best = pool[0]!;
      let bestDist = Math.abs(best.rank - input.rankingHint);
      for (let i = 1; i < pool.length; i++) {
        const d = Math.abs(pool[i]!.rank - input.rankingHint);
        if (d < bestDist) {
          best = pool[i]!;
          bestDist = d;
        }
      }
      return toResult(best);
    }
    return toResult(pool[0]!);
  };

  for (const q of candidateQueries(input.name)) {
    let body: unknown;
    try {
      const res = await http.get(buildSearchUrl(q));
      body = res.data;
    } catch {
      continue;
    }
    if (!Array.isArray(body)) continue;
    const hits = body as RawSearchHit[];
    if (hits.length === 0) continue;
    const picked = pick(hits);
    if (picked) return picked;
  }

  return null;
}

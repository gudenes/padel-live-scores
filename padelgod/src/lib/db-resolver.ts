// padelgod/src/lib/db-resolver.ts
//
// Read-only player-lookup library used by the entry-list-fetcher (and any
// future padelgod worker that needs to resolve a parsed player name to a
// canonical fip_id). Mirrors the lookup chain of src/lib/player-resolver.ts
// in the main repo, minus the create-on-miss path — workers should never
// silently mint player rows from PDF data.
//
// Chain (first hit wins):
//   1. exact fip_id (handled by the caller, since fip_ids land via padelapi
//      or FIP-search, not via name parsing)
//   2. ALIAS: entity_external_ids row with source='alias' whose normalized
//      external_id matches the parsed name
//   3. exact normalized-name match in public.players (category-scoped,
//      country-narrowed, ranking-disambiguated)
//   4. SUBSET fuzzy: every token of the shorter side appears in the longer
//      side (catches "Alejandro Ruiz Granados" → "Alejandro Ruiz")
//   5. TYPO-tolerant fuzzy: ≥0.9 token overlap with 1-char edit tolerance on
//      tokens ≥4 chars (catches "Giannina"/"Gianina" class)
//
// Aliases are auto-stored on successful fuzzy match so subsequent snapshots
// hit step 2 instantly.

import type { SupabaseClient } from '@supabase/supabase-js';
import { paginatedSelect } from './db-paginate.js';
import { normalizeCountry } from './country.js';

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(name: string): string[] {
  return normalizeName(name)
    .split(' ')
    .filter((t) => t.length > 1);
}

/** Levenshtein distance (two-row DP). */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]!
          : 1 + Math.min(prev[j - 1]!, prev[j]!, curr[j - 1]!);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

/**
 * Fraction of shorter-side tokens that appear in the longer side.
 * Returns 1.0 when the shorter name is wholly a subset of the longer name.
 * Use to catch PDF-full-name \u2194 DB-short-name pairs.
 */
export function subsetSimilarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  return overlap / Math.min(ta.size, tb.size);
}

/**
 * Like subsetSimilarity but tolerates 1-char edit-distance on tokens \u22654 chars
 * on BOTH sides. Catches transliteration differences ("Giannina"/"Gianina").
 * Short tokens (initials, "de"/"la") stay strict to avoid false positives.
 */
export function typoTolerantSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const used = new Array<boolean>(tb.length).fill(false);
  let overlap = 0;
  for (const t of ta) {
    for (let i = 0; i < tb.length; i++) {
      if (used[i]) continue;
      const u = tb[i]!;
      if (t === u) {
        overlap++;
        used[i] = true;
        break;
      }
      if (t.length >= 4 && u.length >= 4 && editDistance(t, u) <= 1) {
        overlap++;
        used[i] = true;
        break;
      }
    }
  }
  return overlap / Math.min(ta.length, tb.length);
}

export interface DbPlayerRow {
  id: string;
  fip_id: string | null;
  name: string;
  normalized_name: string | null;
  country: string | null;
  ranking: number | null;
  category: 'men' | 'women' | null;
}

export type DbPlayerIndex = Map<string, DbPlayerRow[]>;
export type AliasIndex = Map<string, string>; // normalized alias \u2192 player UUID

/**
 * Build a category-scoped index keyed on normalized name. Multiple players
 * can share a normalized name; we keep them all and let the resolver narrow
 * by country + ranking.
 */
export async function loadDbPlayerIndex(
  supabase: SupabaseClient,
  category: 'men' | 'women'
): Promise<DbPlayerIndex> {
  const { data, error } = await supabase
    .from('players')
    .select('id, fip_id, name, normalized_name, country, ranking, category')
    .eq('category', category);
  if (error) {
    throw new Error(`players read failed for ${category}: ${error.message}`);
  }
  const map: DbPlayerIndex = new Map();
  for (const r of (data ?? []) as DbPlayerRow[]) {
    const key = r.normalized_name ?? normalizeName(r.name);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return map;
}

/**
 * Load all player aliases from entity_external_ids. Returns a Map keyed on
 * the normalized alias text. Aliases are auto-stored by past fuzzy matches
 * (see storeAlias) so this index grows monotonically over time.
 */
export async function loadAliasIndex(supabase: SupabaseClient): Promise<AliasIndex> {
  // Aliases are monotonically growing across the whole project — paginate
  // to stay safe against the PostgREST 10k cap.
  const rows = await paginatedSelect<{
    entity_id: string;
    external_id: string;
    metadata: { normalized?: string } | null;
  }>(
    (start, end) =>
      supabase
        .from('entity_external_ids')
        .select('entity_id, external_id, metadata')
        .eq('entity_type', 'player')
        .eq('source', 'alias')
        .range(start, end),
    { what: 'entity_external_ids (player aliases)' },
  );
  const map: AliasIndex = new Map();
  for (const r of rows) {
    const norm = r.metadata?.normalized ?? normalizeName(r.external_id);
    if (!norm) continue;
    map.set(norm, r.entity_id);
  }
  return map;
}

export interface ResolveInput {
  name: string;
  country: string | null;
  ranking: number;
}

export interface ResolveHit {
  playerId: string;
  fipId: string | null;
  matchType: 'alias' | 'exact' | 'subset' | 'typo';
}

const SUBSET_THRESHOLD = 1.0; // every shorter-side token must appear in longer
const TYPO_THRESHOLD = 0.9;

/**
 * Resolve a parsed PDF entry against pre-loaded indexes.
 * Chain: alias → exact normalized → subset fuzzy (country-narrowed) → typo
 *        fuzzy (country-narrowed). Returns null when no confident match.
 *
 * Country comparison is via normalizeCountry so 3-letter FIP codes (ESP)
 * compare equal to the 2-letter ISO codes (ES) we store in public.players.
 */
export function resolvePlayerByName(
  input: ResolveInput,
  dbIndex: DbPlayerIndex,
  aliasIndex: AliasIndex,
): ResolveHit | null {
  const norm = normalizeName(input.name);
  if (!norm) return null;

  // 1. Alias hit. Refuse to cross category boundaries: if the aliased player
  //    isn't in this category-scoped dbIndex, treat as miss.
  const aliasPlayerId = aliasIndex.get(norm);
  if (aliasPlayerId) {
    for (const rows of dbIndex.values()) {
      for (const r of rows) {
        if (r.id === aliasPlayerId) {
          return { playerId: r.id, fipId: r.fip_id, matchType: 'alias' };
        }
      }
    }
    // Alias points to a player not in this category — silent miss; continue
    // through the rest of the chain so we don't lose a legitimate exact hit.
  }

  // 2. Exact normalized name
  const exactCandidates = dbIndex.get(norm);
  if (exactCandidates && exactCandidates.length > 0) {
    const pick = pickByCountryAndRanking(exactCandidates, input);
    if (pick) return { playerId: pick.id, fipId: pick.fip_id, matchType: 'exact' };
  }

  // Country narrow shared by both fuzzy steps below.
  const wantCountry = normalizeCountry(input.country);

  // 3. Subset fuzzy — every shorter-side token appears in the longer side
  let bestSubset: { row: DbPlayerRow; score: number } | null = null;
  for (const candidates of dbIndex.values()) {
    for (const c of candidates) {
      if (wantCountry && c.country && normalizeCountry(c.country) !== wantCountry) continue;
      const score = subsetSimilarity(input.name, c.name);
      if (score >= SUBSET_THRESHOLD && (!bestSubset || score > bestSubset.score)) {
        bestSubset = { row: c, score };
      }
    }
  }
  if (bestSubset) {
    return { playerId: bestSubset.row.id, fipId: bestSubset.row.fip_id, matchType: 'subset' };
  }

  // 4. Typo-tolerant fuzzy — same country gate, ≥0.9 threshold.
  //    Worst-case path: scans ALL dbIndex entries (no inverted index) and
  //    runs an O(token_count^2) Levenshtein per candidate. At ~5k players
  //    × 3 tokens this is comfortably <100ms per name. Revisit if the
  //    player index grows past ~20k or if subset hits become rare.
  let bestTypo: { row: DbPlayerRow; score: number } | null = null;
  for (const candidates of dbIndex.values()) {
    for (const c of candidates) {
      if (wantCountry && c.country && normalizeCountry(c.country) !== wantCountry) continue;
      const score = typoTolerantSimilarity(input.name, c.name);
      if (score >= TYPO_THRESHOLD && (!bestTypo || score > bestTypo.score)) {
        bestTypo = { row: c, score };
      }
    }
  }
  if (bestTypo) {
    return { playerId: bestTypo.row.id, fipId: bestTypo.row.fip_id, matchType: 'typo' };
  }

  return null;
}

/**
 * Persist a fuzzy-match success as an alias for future O(1) lookup.
 * Idempotent: relies on the entity_external_ids unique index
 * (source, entity_type, external_id).
 * Non-throwing: alias storage is non-critical and must not break resolution.
 */
export async function storeAlias(
  supabase: SupabaseClient,
  playerId: string,
  rawName: string
): Promise<void> {
  const norm = normalizeName(rawName);
  if (!norm) return;
  try {
    await supabase.from('entity_external_ids').upsert(
      {
        entity_type: 'player',
        entity_id: playerId,
        source: 'alias',
        external_id: rawName,
        metadata: { normalized: norm },
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'source,entity_type,external_id' }
    );
  } catch {
    // swallow — best-effort
  }
}

function pickByCountryAndRanking(
  candidates: DbPlayerRow[],
  input: ResolveInput,
): DbPlayerRow | null {
  if (candidates.length === 1) return candidates[0]!;
  const wantCountry = normalizeCountry(input.country);
  const sameCountry = wantCountry
    ? candidates.filter((c) => normalizeCountry(c.country) === wantCountry)
    : candidates;
  if (sameCountry.length === 1) return sameCountry[0]!;
  if (sameCountry.length === 0) return null;
  if (input.ranking > 0) {
    let best = sameCountry[0]!;
    let bestDist = Math.abs((best.ranking ?? Number.MAX_SAFE_INTEGER) - input.ranking);
    for (let i = 1; i < sameCountry.length; i++) {
      const c = sameCountry[i]!;
      const d = Math.abs((c.ranking ?? Number.MAX_SAFE_INTEGER) - input.ranking);
      if (d < bestDist) {
        best = c;
        bestDist = d;
      }
    }
    return best;
  }
  // No usable ranking to break a same-country tie. This is uncommon — most
  // ranked entries carry a ranking in the PDF — but for WC/0-rank entries
  // we still prefer an arbitrary exact hit over falling through to the
  // fuzzy steps, which would then write a spurious alias for what is
  // really a known-name collision. Pick the first survivor deterministically;
  // the alternative (null) leads the caller into matchType='subset'/'typo'
  // for what should be matchType='exact'.
  return sameCountry[0]!;
}

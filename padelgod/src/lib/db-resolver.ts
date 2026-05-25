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
  const { data, error } = await supabase
    .from('entity_external_ids')
    .select('entity_id, external_id, metadata')
    .eq('entity_type', 'player')
    .eq('source', 'alias');
  if (error) {
    throw new Error(`alias read failed: ${error.message}`);
  }
  const map: AliasIndex = new Map();
  for (const r of (data ?? []) as Array<{
    entity_id: string;
    external_id: string;
    metadata: { normalized?: string } | null;
  }>) {
    const norm = r.metadata?.normalized ?? normalizeName(r.external_id);
    if (!norm) continue;
    map.set(norm, r.entity_id);
  }
  return map;
}

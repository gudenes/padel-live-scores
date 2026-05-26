/**
 * Shared draw-row player resolution primitives.
 *
 * Centralises the low-level name / fip_id / player-UUID lookups that both
 * `fip-draw-populator` and `fip-draw-reconciler` need. The populator stays
 * the sole owner of its higher-level tiered resolver (`resolveFourPlayers`)
 * — that logic is coupled to bracket-overlay and partner-anchor sweeps
 * specific to the INSERT flow. The reconciler only consumes long-form
 * `fip_event_page` draws, where a direct entry-list nameToFipId lookup
 * resolves cleanly, and uses the simpler `resolveDrawNamesLongForm`
 * helper below.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { paginatedSelect } from './db-paginate.js';

/**
 * Minimal name normalizer: NFKD lowercase, strip accents, collapse
 * whitespace. Same rules the populator uses — extracted here so callers
 * can produce stable lookup keys without depending on the populator.
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve a set of FIP player ids to canonical `players.id` UUIDs.
 * Empty input short-circuits without a query.
 */
export async function loadPlayersByFipId(
  supabase: SupabaseClient,
  fipIds: Set<string>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (fipIds.size === 0) return map;
  const { data, error } = await supabase
    .from('players')
    .select('id, fip_id')
    .in('fip_id', Array.from(fipIds));
  if (error) {
    throw new Error(`players read failed: ${error.message}`);
  }
  for (const row of (data ?? []) as { id: string; fip_id: string }[]) {
    if (row.id && row.fip_id) map.set(row.fip_id, row.id);
  }
  return map;
}

interface EntryListRow {
  name: string | null;
  fip_id: string | null;
  category: 'men' | 'women';
  captured_at: string;
}

/**
 * Build a normalized-long-name → fip_id map from the entry-list snapshots
 * for one tournament. Picks the latest captured_at per category — entry
 * lists evolve and we always want the freshest roster. Pagination is
 * required because each scrape appends a fresh batch; a multi-day
 * tournament easily exceeds the 1k row default.
 */
export async function loadEntryListNameMap(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<Map<string, string>> {
  const rows = await paginatedSelect<EntryListRow>(
    (start, end) =>
      supabase
        .schema('padelgod')
        .from('entry_list_snapshots')
        .select('name, fip_id, category, captured_at')
        .eq('tournament_id', tournamentId)
        .range(start, end),
    { what: `entry_list_snapshots (tournament=${tournamentId})` },
  );

  const maxByCat = new Map<string, string>();
  for (const r of rows) {
    const prev = maxByCat.get(r.category);
    if (!prev || r.captured_at > prev) maxByCat.set(r.category, r.captured_at);
  }

  const nameToFipId = new Map<string, string>();
  for (const r of rows) {
    if (!r.name || !r.fip_id) continue;
    if (r.captured_at !== maxByCat.get(r.category)) continue;
    nameToFipId.set(normalizeName(r.name), r.fip_id);
  }
  return nameToFipId;
}

/** Four-slot resolution result. Each slot is independently a player UUID
 *  or null when the name failed to resolve. */
export interface ResolvedFour {
  p1p1: string | null;
  p1p2: string | null;
  p2p1: string | null;
  p2p2: string | null;
}

/**
 * Long-form-only resolution for a single draw row's four player names.
 *
 * Designed for callers that consume `fip_event_page` draw rows directly,
 * where every name is already in canonical long form (e.g. "Javier
 * Barahona"). Uses two hops:
 *
 *   normalized name → fip_id  (via `nameToFipId` from entry list)
 *   fip_id          → player UUID  (via `fipIdToPlayerId`)
 *
 * Each slot resolves independently — a partial match (3-of-4) still
 * returns the three resolved UUIDs. Use this in callers that don't need
 * the populator's short-form / bracket-overlay / partner-anchor machinery
 * (e.g. the reconciler, which is reading the same long-form snapshots
 * the populator already built its INSERTs from).
 */
export function resolveDrawNamesLongForm(
  names: {
    team1_player1_name: string | null;
    team1_player2_name: string | null;
    team2_player1_name: string | null;
    team2_player2_name: string | null;
  },
  nameToFipId: Map<string, string>,
  fipIdToPlayerId: Map<string, string>,
): ResolvedFour {
  const lookup = (name: string | null): string | null => {
    if (!name) return null;
    const fipId = nameToFipId.get(normalizeName(name));
    if (!fipId) return null;
    return fipIdToPlayerId.get(fipId) ?? null;
  };
  return {
    p1p1: lookup(names.team1_player1_name),
    p1p2: lookup(names.team1_player2_name),
    p2p1: lookup(names.team2_player1_name),
    p2p2: lookup(names.team2_player2_name),
  };
}

/**
 * entity_external_ids helpers for the webtuga worker.
 *
 *   source='webtuga_live' : one row per tournament, external_id = tracker base URL.
 *   source='webtuga'      : one row per resolved match,
 *                           external_id = '<tournamentId>:<webtugaId>',
 *                           entity_id   = match UUID,
 *                           metadata    = { orientation, lastState }.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LiveMatchState } from './live-state.js';

export interface WebtugaTournament {
  tournamentId: string;
  baseUrl: string;
}

export interface MatchCacheEntry {
  matchId: string;
  orientation: 'AB' | 'BA';
  lastState: LiveMatchState | null;
}

export function cacheExternalId(tournamentId: string, webtugaId: number): string {
  return `${tournamentId}:${webtugaId}`;
}

export async function discoverWebtugaTournaments(
  supabase: SupabaseClient,
): Promise<WebtugaTournament[]> {
  const { data, error } = await supabase
    .from('entity_external_ids')
    .select('entity_id, external_id')
    .eq('entity_type', 'tournament')
    .eq('source', 'webtuga_live');
  if (error) throw new Error(`discoverWebtugaTournaments failed: ${error.message}`);
  const rows: WebtugaTournament[] = (data ?? []).map((r: any) => ({
    tournamentId: r.entity_id as string,
    baseUrl: r.external_id as string,
  }));
  if (rows.length === 0) return [];

  // Self-disable: only poll tournaments still inside (or within a 1-day grace
  // of) their active window, so a finished event's likely-dead host isn't hit
  // every 15s forever. A tournament with a null `ends_at` is kept (unknown end).
  const { data: tours, error: tErr } = await supabase
    .from('tournaments')
    .select('id, ends_at')
    .in('id', rows.map((r) => r.tournamentId));
  if (tErr) throw new Error(`discoverWebtugaTournaments tournaments lookup failed: ${tErr.message}`);
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const active = new Set(
    (tours ?? [])
      .filter((t: any) => t.ends_at == null || new Date(t.ends_at).getTime() >= cutoff)
      .map((t: any) => t.id as string),
  );
  return rows.filter((r) => active.has(r.tournamentId));
}

export async function loadMatchCache(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<Map<number, MatchCacheEntry>> {
  // NOTE: scans all webtuga match rows and filters by tournament prefix in
  // memory. Bounded + fine for the single-tournament v1. If multiple
  // webtuga-backed tournaments ever run concurrently, add a server-side
  // `.like('external_id', `${tournamentId}:%`)` to avoid cross-tournament reads.
  const { data, error } = await supabase
    .from('entity_external_ids')
    .select('external_id, entity_id, metadata')
    .eq('entity_type', 'match')
    .eq('source', 'webtuga');
  if (error) throw new Error(`loadMatchCache failed: ${error.message}`);

  const map = new Map<number, MatchCacheEntry>();
  for (const r of data ?? []) {
    const ext = String((r as any).external_id);
    const [tid, idPart] = ext.split(':');
    if (tid !== tournamentId) continue;
    const webtugaId = Number(idPart);
    if (!Number.isFinite(webtugaId)) continue;
    const meta = ((r as any).metadata ?? {}) as {
      orientation?: 'AB' | 'BA';
      lastState?: LiveMatchState;
    };
    map.set(webtugaId, {
      matchId: (r as any).entity_id as string,
      orientation: meta.orientation ?? 'AB',
      lastState: meta.lastState ?? null,
    });
  }
  return map;
}

export async function upsertMatchCache(
  supabase: SupabaseClient,
  tournamentId: string,
  webtugaId: number,
  matchId: string,
  orientation: 'AB' | 'BA',
  lastState: LiveMatchState | null,
): Promise<void> {
  const { error } = await supabase.from('entity_external_ids').upsert(
    {
      entity_type: 'match',
      entity_id: matchId,
      source: 'webtuga',
      external_id: cacheExternalId(tournamentId, webtugaId),
      metadata: { orientation, lastState },
    },
    { onConflict: 'source,entity_type,external_id' },
  );
  if (error) throw new Error(`upsertMatchCache failed: ${error.message}`);
}

export async function writeLastState(
  supabase: SupabaseClient,
  tournamentId: string,
  webtugaId: number,
  orientation: 'AB' | 'BA',
  lastState: LiveMatchState,
): Promise<void> {
  const { error } = await supabase
    .from('entity_external_ids')
    .update({ metadata: { orientation, lastState } })
    .eq('entity_type', 'match')
    .eq('source', 'webtuga')
    .eq('external_id', cacheExternalId(tournamentId, webtugaId));
  if (error) throw new Error(`writeLastState failed: ${error.message}`);
}

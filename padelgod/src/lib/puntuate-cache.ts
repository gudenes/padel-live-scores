/**
 * entity_external_ids helpers for the puntuate worker.
 * Puntuate exposes no stable match IDs: cache by resolved canonical match ID.
 *
 *   source='puntuate_live' : one row per tournament, external_id = full scoreboard URL.
 *   source='puntuate'      : one row per resolved match,
 *                           external_id = '<tournamentId>:<canonicalMatchId>',
 *                           entity_id   = match UUID,
 *                           metadata    = { orientation, lastState }.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LiveMatchState } from './live-state.js';

export interface PuntuateTournament {
  tournamentId: string;
  baseUrl: string;
}

export interface MatchCacheEntry {
  matchId: string;
  orientation: 'AB' | 'BA';
  lastState: LiveMatchState | null;
}

export function cacheExternalId(tournamentId: string, puntuateId: string): string {
  return `${tournamentId}:${puntuateId}`;
}

export async function discoverPuntuateTournaments(
  supabase: SupabaseClient,
): Promise<PuntuateTournament[]> {
  const { data, error } = await supabase
    .from('entity_external_ids')
    .select('entity_id, external_id')
    .eq('entity_type', 'tournament')
    .eq('source', 'puntuate_live');
  if (error) throw new Error(`discoverPuntuateTournaments failed: ${error.message}`);
  const rows: PuntuateTournament[] = (data ?? []).map((r: any) => ({
    tournamentId: r.entity_id as string,
    baseUrl: r.external_id as string,
  }));
  if (rows.length === 0) return [];

  // Self-disable: only poll tournaments still inside (or within a 1-day grace
  // of) their active window, so a finished event's likely-dead host isn't hit
  // every 30s forever. A tournament with a null `ends_at` is kept (unknown end).
  const { data: tours, error: tErr } = await supabase
    .from('tournaments')
    .select('id, ends_at')
    .in('id', rows.map((r) => r.tournamentId));
  if (tErr) throw new Error(`discoverPuntuateTournaments tournaments lookup failed: ${tErr.message}`);
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
): Promise<Map<string, MatchCacheEntry>> {
  // NOTE: scans all puntuate match rows and filters by tournament prefix in
  // memory. Bounded + fine for the single-tournament v1. If multiple
  // puntuate-backed tournaments ever run concurrently, add a server-side
  // `.like('external_id', `${tournamentId}:%`)` to avoid cross-tournament reads.
  const { data, error } = await supabase
    .from('entity_external_ids')
    .select('external_id, entity_id, metadata')
    .eq('entity_type', 'match')
    .eq('source', 'puntuate');
  if (error) throw new Error(`loadMatchCache failed: ${error.message}`);

  const map = new Map<string, MatchCacheEntry>();
  for (const r of data ?? []) {
    const ext = String((r as any).external_id);
    const [tid, idPart] = ext.split(':');
    if (tid !== tournamentId) continue;
    const puntuateId = idPart;
    if (!puntuateId) continue;
    const meta = ((r as any).metadata ?? {}) as {
      orientation?: 'AB' | 'BA';
      lastState?: LiveMatchState;
    };
    map.set(puntuateId, {
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
  puntuateId: string,
  matchId: string,
  orientation: 'AB' | 'BA',
  lastState: LiveMatchState | null,
): Promise<void> {
  const { error } = await supabase.from('entity_external_ids').upsert(
    {
      entity_type: 'match',
      entity_id: matchId,
      source: 'puntuate',
      external_id: cacheExternalId(tournamentId, puntuateId),
      metadata: { orientation, lastState },
    },
    { onConflict: 'source,entity_type,external_id' },
  );
  if (error) throw new Error(`upsertMatchCache failed: ${error.message}`);
}

export async function writeLastState(
  supabase: SupabaseClient,
  tournamentId: string,
  puntuateId: string,
  orientation: 'AB' | 'BA',
  lastState: LiveMatchState,
): Promise<void> {
  const { error } = await supabase
    .from('entity_external_ids')
    .update({ metadata: { orientation, lastState } })
    .eq('entity_type', 'match')
    .eq('source', 'puntuate')
    .eq('external_id', cacheExternalId(tournamentId, puntuateId));
  if (error) throw new Error(`writeLastState failed: ${error.message}`);
}

/**
 * entity_external_ids helpers for the padeldev worker.
 *
 *   source='padeldev_live' : one row per tournament,
 *                            external_id = the widget key (a UUID).
 *   source='padeldev'      : one row per resolved match,
 *                            external_id = '<tournamentId>:<matchRef>',
 *                            entity_id   = our match UUID,
 *                            metadata    = { orientation, lastState, lastupdate }.
 *
 * Seeding a tournament is a plain INSERT — see the v1 design spec on why
 * discovery is manual.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LiveMatchState } from './live-state.js';

export interface PadeldevTournament {
  tournamentId: string;
  key: string;
}

export interface MatchCacheEntry {
  matchId: string;
  orientation: 'AB' | 'BA';
  lastState: LiveMatchState | null;
  /** Feed `lastupdate` at the time we last applied — lets us skip unchanged matches. */
  lastUpdate: number | null;
}

export function cacheExternalId(tournamentId: string, matchRef: string): string {
  return `${tournamentId}:${matchRef}`;
}

export async function discoverPadeldevTournaments(
  supabase: SupabaseClient,
): Promise<PadeldevTournament[]> {
  const { data, error } = await supabase
    .from('entity_external_ids')
    .select('entity_id, external_id')
    .eq('entity_type', 'tournament')
    .eq('source', 'padeldev_live');
  if (error) throw new Error(`discoverPadeldevTournaments failed: ${error.message}`);
  const rows: PadeldevTournament[] = (data ?? []).map((r: any) => ({
    tournamentId: r.entity_id as string,
    key: r.external_id as string,
  }));
  if (rows.length === 0) return [];

  // Self-disable: only poll tournaments still inside (or within a 1-day grace
  // of) their window. This is what stops a one-event pilot from hammering a
  // vendor endpoint forever after the event ends. A null ends_at is kept.
  const { data: tours, error: tErr } = await supabase
    .from('tournaments')
    .select('id, ends_at')
    .in('id', rows.map((r) => r.tournamentId));
  if (tErr) {
    throw new Error(`discoverPadeldevTournaments tournaments lookup failed: ${tErr.message}`);
  }
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
  const { data, error } = await supabase
    .from('entity_external_ids')
    .select('external_id, entity_id, metadata')
    .eq('entity_type', 'match')
    .eq('source', 'padeldev')
    .like('external_id', `${tournamentId}:%`);
  if (error) throw new Error(`loadMatchCache failed: ${error.message}`);

  const map = new Map<string, MatchCacheEntry>();
  for (const r of data ?? []) {
    const ext = String((r as any).external_id);
    const idx = ext.indexOf(':');
    if (idx < 0) continue;
    const tid = ext.slice(0, idx);
    const matchRef = ext.slice(idx + 1);
    if (tid !== tournamentId || !matchRef) continue;
    const meta = ((r as any).metadata ?? {}) as {
      orientation?: 'AB' | 'BA';
      lastState?: LiveMatchState;
      lastUpdate?: number;
    };
    map.set(matchRef, {
      matchId: (r as any).entity_id as string,
      orientation: meta.orientation ?? 'AB',
      lastState: meta.lastState ?? null,
      lastUpdate: meta.lastUpdate ?? null,
    });
  }
  return map;
}

export async function upsertMatchCache(
  supabase: SupabaseClient,
  tournamentId: string,
  matchRef: string,
  matchId: string,
  orientation: 'AB' | 'BA',
  lastState: LiveMatchState | null,
  lastUpdate: number | null,
): Promise<void> {
  const { error } = await supabase.from('entity_external_ids').upsert(
    {
      entity_type: 'match',
      entity_id: matchId,
      source: 'padeldev',
      external_id: cacheExternalId(tournamentId, matchRef),
      metadata: { orientation, lastState, lastUpdate },
    },
    { onConflict: 'source,entity_type,external_id' },
  );
  if (error) throw new Error(`upsertMatchCache failed: ${error.message}`);
}

export async function writeLastState(
  supabase: SupabaseClient,
  tournamentId: string,
  matchRef: string,
  orientation: 'AB' | 'BA',
  lastState: LiveMatchState,
  lastUpdate: number | null,
): Promise<void> {
  const { error } = await supabase
    .from('entity_external_ids')
    .update({ metadata: { orientation, lastState, lastUpdate } })
    .eq('entity_type', 'match')
    .eq('source', 'padeldev')
    .eq('external_id', cacheExternalId(tournamentId, matchRef));
  if (error) throw new Error(`writeLastState failed: ${error.message}`);
}

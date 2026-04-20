import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';

export interface ShadowDiffLiveDeps {
  supabase: SupabaseClient;
  logger: Logger;
}

export interface ShadowDiffLiveResult {
  rowsWritten: number;
  matchesConsidered: number;
}

interface CandidateMatch {
  id: string;
  tournament_id: string;
}

interface SetTimestampRow {
  set_number: number;
  updated_at: string;
}

/**
 * Runs the shadow-diff live-latency snapshotter: for every live (or recently
 * ended) match inside a shadow-enrolled tournament, compares the highest-
 * numbered set's `updated_at` on `public.sets` (the relay-written canonical
 * path) vs `padelgod.shadow_sets` (the padelgod shadow path) and records
 * `latency_delta_ms = padelgod_ts - padelapi_ts` (positive = padelgod slower).
 *
 * Designed to run every minute. Accumulates rows over time — there is no
 * uniqueness constraint on `live_latency` diffs, so each invocation writes
 * at most one row per match.
 *
 * Matches where either side has no current-set row (nothing to compare
 * against) are silently skipped.
 */
export async function runShadowDiffLive(
  deps: ShadowDiffLiveDeps
): Promise<ShadowDiffLiveResult> {
  const { supabase, logger } = deps;

  // Step 1: which tournaments are shadow-enrolled?
  const { data: tourRows, error: tourErr } = await supabase
    .from('tournaments')
    .select('id')
    .eq('shadow_enabled', true);
  if (tourErr) {
    throw new Error(`tournaments read failed: ${tourErr.message}`);
  }
  const tourIds = ((tourRows ?? []) as { id: string }[]).map((r) => r.id);
  if (tourIds.length === 0) {
    return { rowsWritten: 0, matchesConsidered: 0 };
  }

  // Step 2: candidate live / ended matches.
  const { data: matchRows, error: matchErr } = await supabase
    .from('matches')
    .select('id, tournament_id')
    .in('status', ['live', 'ended'])
    .in('tournament_id', tourIds);
  if (matchErr) {
    throw new Error(`matches read failed: ${matchErr.message}`);
  }
  const matches = (matchRows ?? []) as CandidateMatch[];
  if (matches.length === 0) {
    return { rowsWritten: 0, matchesConsidered: 0 };
  }

  let rowsWritten = 0;

  for (const match of matches) {
    try {
      const wrote = await snapshotLatencyForMatch(supabase, match, logger);
      if (wrote) rowsWritten += 1;
    } catch (err) {
      logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          matchId: match.id,
        },
        'shadow-diff-live latency snapshot failed for match'
      );
    }
  }

  logger.info(
    { rowsWritten, matchesConsidered: matches.length },
    'shadow-diff-live complete'
  );

  return { rowsWritten, matchesConsidered: matches.length };
}

async function snapshotLatencyForMatch(
  supabase: SupabaseClient,
  match: CandidateMatch,
  _logger: Logger
): Promise<boolean> {
  // Highest-numbered public.sets row.
  const { data: publicSetRows, error: pubErr } = await supabase
    .from('sets')
    .select('set_number, updated_at')
    .eq('match_id', match.id)
    .order('set_number', { ascending: false })
    .limit(1);
  if (pubErr) {
    throw new Error(`public.sets read failed: ${pubErr.message}`);
  }
  const publicTop = (publicSetRows ?? []) as SetTimestampRow[];
  if (publicTop.length === 0) return false;

  // Highest-numbered padelgod.shadow_sets row.
  const { data: shadowSetRows, error: shadowErr } = await supabase
    .schema('padelgod')
    .from('shadow_sets')
    .select('set_number, updated_at')
    .eq('match_id', match.id)
    .order('set_number', { ascending: false })
    .limit(1);
  if (shadowErr) {
    throw new Error(`shadow_sets read failed: ${shadowErr.message}`);
  }
  const shadowTop = (shadowSetRows ?? []) as SetTimestampRow[];
  if (shadowTop.length === 0) return false;

  const padelapiUpdatedAt = publicTop[0]!.updated_at;
  const padelgodUpdatedAt = shadowTop[0]!.updated_at;

  const padelapiMs = new Date(padelapiUpdatedAt).getTime();
  const padelgodMs = new Date(padelgodUpdatedAt).getTime();
  const latencyDeltaMs = Math.round(padelgodMs - padelapiMs);

  const { error: insErr } = await supabase
    .schema('padelgod')
    .from('shadow_diff')
    .insert({
      comparison_type: 'live_latency',
      tournament_id: match.tournament_id,
      match_id: match.id,
      padelapi_updated_at: padelapiUpdatedAt,
      padelgod_updated_at: padelgodUpdatedAt,
      latency_delta_ms: latencyDeltaMs,
    });
  if (insErr) {
    throw new Error(`shadow_diff insert failed: ${insErr.message}`);
  }
  return true;
}

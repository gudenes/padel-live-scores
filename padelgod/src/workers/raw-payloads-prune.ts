import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';

/**
 * raw-payloads-prune
 *
 * Retention sweeper for padelgod.raw_payloads — a write-only debug/replay
 * archive (nothing reads body back). Deletes rows older than
 * retentionDays in id-batches to avoid long locks / statement timeouts.
 *
 * Recurring daily prune uses plain DELETE; autovacuum reuses the freed
 * space so steady-state stays flat. The existing ~18 GB backlog is
 * reclaimed to disk by a one-time VACUUM FULL (see the reclaim runbook),
 * NOT by this worker.
 *
 * Pairs with the dedup-at-write logic in lib/scrape-job.ts, which keeps
 * the inflow ~93% smaller. heartbeat (7d) < retention (14d) guarantees
 * every actively-scraped target always has a body younger than the
 * cutoff, so pruning never strands an active target without a body.
 */

export interface RawPayloadsPruneDeps {
  supabase: SupabaseClient;
  logger?: Logger;
  /** Delete rows older than this many days. Default 14. */
  retentionDays?: number;
  /** Rows per delete batch. Default 10,000. */
  batchSize?: number;
  /** Safety cap on batches per run. Default 500 (covers the ~1.5M-row
   *  first-run backlog at batchSize 10k = ~150 batches). */
  maxBatches?: number;
  /** When true, only count candidates; delete nothing. */
  dryRun: boolean;
}

export interface RawPayloadsPruneResult {
  cutoffIso: string;
  candidateCount: number;
  rowsDeleted: number;
  batchesRun: number;
  /** True when the run stopped because it reached the maxBatches cap.
   *  More rows may still be older than the cutoff — re-run, or raise
   *  maxBatches to clear them in one pass. Does not guarantee rows remain. */
  hitMaxBatches: boolean;
  /** True when the loop stopped because a select/delete batch errored
   *  (partial run). Distinguishes an error-aborted run from clean
   *  completion in the logged result. */
  abortedEarly: boolean;
  dryRun: boolean;
}

const DEFAULT_RETENTION_DAYS = 14;
const DEFAULT_BATCH_SIZE = 10_000;
const DEFAULT_MAX_BATCHES = 500;

export async function runRawPayloadsPrune(
  deps: RawPayloadsPruneDeps,
): Promise<RawPayloadsPruneResult> {
  const { supabase, logger, dryRun } = deps;
  const retentionDays = deps.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatches = deps.maxBatches ?? DEFAULT_MAX_BATCHES;
  const cutoffIso = new Date(Date.now() - retentionDays * 24 * 3600 * 1000).toISOString();

  const result: RawPayloadsPruneResult = {
    cutoffIso,
    candidateCount: 0,
    rowsDeleted: 0,
    batchesRun: 0,
    hitMaxBatches: false,
    abortedEarly: false,
    dryRun,
  };

  if (dryRun) {
    const { count, error } = await supabase
      .schema('padelgod')
      .from('raw_payloads')
      .select('id', { count: 'exact', head: true })
      .lt('captured_at', cutoffIso);
    if (error) {
      logger?.warn({ err: error.message }, 'raw-payloads-prune [dry-run]: count failed');
      return result;
    }
    result.candidateCount = count ?? 0;
    logger?.info(result, 'raw-payloads-prune [dry-run]: rows older than cutoff');
    return result;
  }

  for (let batch = 0; batch < maxBatches; batch++) {
    const { data, error } = await supabase
      .schema('padelgod')
      .from('raw_payloads')
      .select('id')
      .lt('captured_at', cutoffIso)
      .limit(batchSize);
    if (error) {
      logger?.warn({ err: error.message, batch }, 'raw-payloads-prune: select batch failed');
      result.abortedEarly = true;
      break;
    }
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    if (ids.length === 0) break;

    const { error: delErr, count } = await supabase
      .schema('padelgod')
      .from('raw_payloads')
      .delete({ count: 'exact' })
      .in('id', ids);
    if (delErr) {
      logger?.warn({ err: delErr.message, batch }, 'raw-payloads-prune: delete batch failed');
      result.abortedEarly = true;
      break;
    }

    result.rowsDeleted += count ?? ids.length;
    result.batchesRun += 1;
    if (ids.length < batchSize) break;        // last partial batch
    if (batch === maxBatches - 1) result.hitMaxBatches = true;
  }

  logger?.info(result, 'raw-payloads-prune: done');
  return result;
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';

/**
 * scrape-jobs-prune
 *
 * Retention sweeper for padelgod.scrape_jobs — a write-only operational
 * ledger (no worker reads historical job rows). Deletes rows older than
 * retentionDays in id-batches to avoid long locks / statement timeouts.
 *
 * Every snapshot table (results/oop/entry_list/draw_snapshots) AND
 * raw_payloads reference scrape_jobs(id) via ON DELETE CASCADE, and a
 * snapshot is born in the same job run (snapshot.captured_at ≈
 * scrape_job.started_at). So deleting a scrape_jobs row older than the
 * cutoff cascade-deletes its temporally-aligned children — this single
 * worker bounds all six tables. Consumers only ever read the latest
 * snapshot per key (≤24h lookback), so a 14d window never strands a row
 * a consumer still needs.
 *
 * REQUIRES the FK-supporting indexes on the four snapshot tables
 * (migration 20260616000001) — without them each cascade delete
 * seq-scans the child tables.
 *
 * Recurring daily prune uses plain DELETE; autovacuum reuses the freed
 * space so steady-state stays flat. The existing backlog is reclaimed to
 * disk by a one-time VACUUM FULL (see the reclaim runbook), NOT by this
 * worker.
 *
 * batchSize defaults to 2,000 (smaller than raw-payloads-prune's 10k)
 * because each parent delete fans out to many cascaded child rows.
 */

export interface ScrapeJobsPruneDeps {
  supabase: SupabaseClient;
  logger?: Logger;
  /** Delete rows older than this many days. Default 14. */
  retentionDays?: number;
  /** Rows per delete batch. Default 2,000. */
  batchSize?: number;
  /** Safety cap on batches per run. Default 500. */
  maxBatches?: number;
  /** When true, only count candidates; delete nothing. */
  dryRun: boolean;
}

export interface ScrapeJobsPruneResult {
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
const DEFAULT_BATCH_SIZE = 2_000;
const DEFAULT_MAX_BATCHES = 500;

export async function runScrapeJobsPrune(
  deps: ScrapeJobsPruneDeps,
): Promise<ScrapeJobsPruneResult> {
  const { supabase, logger, dryRun } = deps;
  const retentionDays = deps.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatches = deps.maxBatches ?? DEFAULT_MAX_BATCHES;
  const cutoffIso = new Date(Date.now() - retentionDays * 24 * 3600 * 1000).toISOString();

  const result: ScrapeJobsPruneResult = {
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
      .from('scrape_jobs')
      .select('id', { count: 'exact', head: true })
      .lt('started_at', cutoffIso);
    if (error) {
      logger?.warn({ err: error.message }, 'scrape-jobs-prune [dry-run]: count failed');
      return result;
    }
    result.candidateCount = count ?? 0;
    logger?.info(result, 'scrape-jobs-prune [dry-run]: rows older than cutoff');
    return result;
  }

  for (let batch = 0; batch < maxBatches; batch++) {
    const { data, error } = await supabase
      .schema('padelgod')
      .from('scrape_jobs')
      .select('id')
      .lt('started_at', cutoffIso)
      .limit(batchSize);
    if (error) {
      logger?.warn({ err: error.message, batch }, 'scrape-jobs-prune: select batch failed');
      result.abortedEarly = true;
      break;
    }
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    if (ids.length === 0) break;

    const { error: delErr, count } = await supabase
      .schema('padelgod')
      .from('scrape_jobs')
      .delete({ count: 'exact' })
      .in('id', ids);
    if (delErr) {
      logger?.warn({ err: delErr.message, batch }, 'scrape-jobs-prune: delete batch failed');
      result.abortedEarly = true;
      break;
    }

    result.rowsDeleted += count ?? ids.length;
    result.batchesRun += 1;
    if (ids.length < batchSize) break;        // last partial batch
    if (batch === maxBatches - 1) result.hitMaxBatches = true;
  }

  logger?.info(result, 'scrape-jobs-prune: done');
  return result;
}

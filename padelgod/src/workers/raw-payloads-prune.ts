import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';

/**
 * raw-payloads-prune
 *
 * Retention sweeper for padelgod.raw_payloads — a write-only debug/replay
 * archive (nothing reads body back). Deletes rows older than
 * retentionDays in time-window slices to avoid long locks / statement
 * timeouts.
 *
 * Why time windows and not id batches (2026-09-09)
 * ------------------------------------------------
 * The original implementation selected 10,000 ids and passed them to
 * `.in('id', ids)`. supabase-js serialises `.in()` into the request URL,
 * so that delete carried a ~370 KB URL and the request never landed —
 * every nightly run aborted on its FIRST batch and deleted NOTHING. The
 * worker had been enabled and non-dry-run for weeks with 480k rows past
 * the cutoff and 0 deleted; the failure was invisible because it looked
 * like an ordinary warn line.
 *
 * Measured against production: `.in()` with 500 ids succeeds, 1,000+
 * fails. The rest of this codebase already chunks such filters at 20-200
 * (see IN_FILTER_CHUNK_SIZE in match-stats-fetcher).
 *
 * So: never put ids in the URL. Each batch deletes by predicate
 * (`captured_at < windowEnd`), where windowEnd walks forward from the
 * oldest surviving row in windowHours steps. Bounded per statement, no
 * id list, and progress is guaranteed because the oldest candidate row
 * is always strictly older than windowEnd.
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
  /** Size of each delete's time slice, in hours. Default 24 — roughly a
   *  day of inflow (~35k rows) per statement. Lower it if a single day's
   *  delete ever approaches the statement timeout. */
  windowHours?: number;
  /** Safety cap on batches per run. Default 500 — at the 24h default that
   *  is 500 days of backlog, far more than the archive can hold. */
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
const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_MAX_BATCHES = 500;

export async function runRawPayloadsPrune(
  deps: RawPayloadsPruneDeps,
): Promise<RawPayloadsPruneResult> {
  const { supabase, logger, dryRun } = deps;
  const retentionDays = deps.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const windowHours = deps.windowHours ?? DEFAULT_WINDOW_HOURS;
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

  const cutoffMs = Date.parse(cutoffIso);
  const windowMs = windowHours * 3600 * 1000;

  for (let batch = 0; batch < maxBatches; batch++) {
    // Oldest surviving candidate. One row, no id list — this is the only
    // read, and it drives where the next window ends.
    const { data, error } = await supabase
      .schema('padelgod')
      .from('raw_payloads')
      .select('captured_at')
      .lt('captured_at', cutoffIso)
      .order('captured_at', { ascending: true })
      .limit(1);
    if (error) {
      logger?.warn({ err: error.message, batch }, 'raw-payloads-prune: probe failed');
      result.abortedEarly = true;
      break;
    }
    const oldestIso = (data ?? [])[0]?.captured_at as string | undefined;
    if (!oldestIso) break;  // nothing left older than the cutoff

    // Strictly greater than oldestIso (oldest < cutoff is guaranteed by the
    // probe filter), so every batch removes at least the oldest row and the
    // loop cannot spin.
    const windowEndIso = new Date(
      Math.min(Date.parse(oldestIso) + windowMs, cutoffMs),
    ).toISOString();

    const { error: delErr, count } = await supabase
      .schema('padelgod')
      .from('raw_payloads')
      .delete({ count: 'exact' })
      .lt('captured_at', windowEndIso);
    if (delErr) {
      logger?.warn(
        { err: delErr.message, batch, windowEndIso },
        'raw-payloads-prune: delete batch failed',
      );
      result.abortedEarly = true;
      break;
    }

    result.rowsDeleted += count ?? 0;
    result.batchesRun += 1;
    if (batch === maxBatches - 1) result.hitMaxBatches = true;
  }

  logger?.info(result, 'raw-payloads-prune: done');
  return result;
}

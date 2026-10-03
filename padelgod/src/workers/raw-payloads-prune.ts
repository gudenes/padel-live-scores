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
 * ...and the second wall behind the first
 * ---------------------------------------
 * Fixing the URL was not enough. The first live run STILL deleted zero
 * rows: PostgREST authenticates as `authenticator`, which carries
 * `statement_timeout = 8s` (and `lock_timeout = 8s`), and a 24h window
 * was ~23k rows — too much for that budget on a cold cache. Measured on
 * production during the backlog clear, 5k-row deletes ranged from 0.3s
 * to 4.7s, so 23k in 8s was never achievable.
 *
 * Hence the halving: on a timeout the window is halved and the SAME batch
 * retried, down to MIN_WINDOW_MS. A heavy night now degrades to slower
 * progress instead of a silent no-op — which is the whole lesson of this
 * worker's history. `windowShrinks` and `finalWindowHours` in the result
 * make the backoff visible in the logs rather than invisible.
 *
 * Note the asymmetry: a direct DB connection gets `statement_timeout =
 * 120s`, so one-off backlog clears are far better run through psql/pg
 * than through this worker.
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
  /** Starting size of each delete's time slice, in hours. Default 2 —
   *  ~2k rows per statement, which measured at ~1s against production.
   *  The run halves this on timeout, so this is an opening bid, not a
   *  commitment. */
  windowHours?: number;
  /** Safety cap on batches per run. Default 500 — at the 2h default that
   *  is ~41 days of backlog in one run. */
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
  /** How many times a delete timed out and the window was halved. Non-zero
   *  is normal on a heavy night; persistently non-zero means the starting
   *  windowHours is too optimistic for the data. */
  windowShrinks: number;
  /** Window size the run finished on, in hours. Compare with the requested
   *  windowHours to see how far it had to back off. */
  finalWindowHours: number;
  dryRun: boolean;
}

const DEFAULT_RETENTION_DAYS = 14;
const DEFAULT_WINDOW_HOURS = 2;
const DEFAULT_MAX_BATCHES = 500;
/** Floor for the halving. Below this a timeout means something is wrong
 *  with the table, not with the batch size — abort and let a human look. */
const MIN_WINDOW_MS = 5 * 60 * 1000;

/**
 * Postgres cancels on statement_timeout with SQLSTATE 57014. PostgREST
 * surfaces it as a message, not always a code, so match both.
 */
function isTimeoutError(err: { message?: string; code?: string }): boolean {
  if (err.code === '57014') return true;
  const m = (err.message ?? '').toLowerCase();
  return m.includes('statement timeout') || m.includes('canceling statement');
}

/**
 * End bound for the next delete. Strictly greater than `oldestIso` — the
 * probe only returns rows below the cutoff, so clamping to the cutoff can
 * never land on or before the oldest row. That is what guarantees every
 * batch removes at least one row and the loop cannot spin.
 */
function nextWindowEnd(oldestIso: string, windowMs: number, cutoffMs: number): string {
  return new Date(Math.min(Date.parse(oldestIso) + windowMs, cutoffMs)).toISOString();
}

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
    windowShrinks: 0,
    finalWindowHours: windowHours,
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
  let windowMs = windowHours * 3600 * 1000;

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

    // Retry the SAME batch at a smaller window while deletes time out.
    // Bounded: halving from the default reaches MIN_WINDOW_MS in ~5 steps,
    // after which a timeout is treated as fatal.
    let deleted: number | null = null;
    for (;;) {
      const windowEndIso = nextWindowEnd(oldestIso, windowMs, cutoffMs);
      const { error: delErr, count } = await supabase
        .schema('padelgod')
        .from('raw_payloads')
        .delete({ count: 'exact' })
        .lt('captured_at', windowEndIso);

      if (!delErr) {
        deleted = count ?? 0;
        break;
      }

      if (isTimeoutError(delErr) && windowMs > MIN_WINDOW_MS) {
        windowMs = Math.max(Math.floor(windowMs / 2), MIN_WINDOW_MS);
        result.windowShrinks += 1;
        logger?.info(
          { batch, windowEndIso, newWindowHours: windowMs / 3600_000 },
          'raw-payloads-prune: delete timed out, halving window and retrying',
        );
        continue;
      }

      logger?.warn(
        { err: delErr.message, batch, windowEndIso, windowHours: windowMs / 3600_000 },
        'raw-payloads-prune: delete batch failed',
      );
      result.abortedEarly = true;
      break;
    }
    if (deleted === null) break;   // aborted inside the retry loop

    result.rowsDeleted += deleted;
    result.batchesRun += 1;
    if (batch === maxBatches - 1) result.hitMaxBatches = true;
  }

  result.finalWindowHours = windowMs / 3600_000;

  logger?.info(result, 'raw-payloads-prune: done');
  return result;
}

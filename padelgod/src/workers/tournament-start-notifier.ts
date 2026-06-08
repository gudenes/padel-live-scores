import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import { notifyEvent, type NotifyDeps } from '../lib/notify.js';

/**
 * tournament-start-notifier — fires `tournament_starting` exactly once per
 * tournament, the first time its `starts_at` has passed.
 *
 * Selection
 * ---------
 * A tournament is "due" when:
 *   - `starting_notified_at IS NULL` (never fired), AND
 *   - `starts_at <= now`             (play window has begun), AND
 *   - `starts_at >= now - 24h`       (recent enough)
 *
 * The 24h window matters because `starting_notified_at` ships NULL for the
 * entire table on the migration that adds it (Plan 2A Task 1). Without the
 * lower bound, the first run would backfire `tournament_starting` for every
 * historical tournament whose `starts_at` is in the past. The window means
 * the worker only ever notifies tournaments that crossed the start line
 * within the last day — and once a worker run claims the row (flips
 * `starting_notified_at` NULL → now), it's permanently excluded.
 *
 * Idempotency / parallel-safety
 * ------------------------------
 * Each fire is gated by an ATOMIC claim: a conditional UPDATE that only
 * matches rows still holding `starting_notified_at IS NULL`. PostgREST
 * returns the rows it actually updated; if our update touched the row, WE
 * won the claim and proceed to notify. If another overlapping tick (or a
 * concurrent admin trigger) already flipped it, our UPDATE matches zero
 * rows and we skip. This prevents double-fire across overlapping runs
 * without a DB-level advisory lock.
 *
 * The notify call itself is fire-and-forget (`notifyEvent` never throws,
 * no-ops when NOTIFY_BASE_URL / CRON_SECRET are unset). The claim is
 * committed BEFORE the notify dispatch, so even if the notify endpoint is
 * down the tournament won't be retried — matching the "fire once" contract
 * (the in-app row + push are best-effort, the claim is the source of truth).
 *
 * Ships dark behind ENABLE_TOURNAMENT_START_NOTIFIER (default off).
 */

/** Don't backfire history the first time the column is NULL table-wide. */
const WINDOW_HOURS = 24;

export interface TournamentStartNotifierDeps {
  supabase: SupabaseClient;
  logger: Logger;
  /**
   * Web-push notify config (baseUrl / cronSecret / logger). Forwarded from
   * the scheduler's `SchedulerDeps.notify`, populated in index.ts from
   * NOTIFY_BASE_URL + CRON_SECRET. When undefined (local/test, or env
   * missing), the notify dispatch silently no-ops.
   */
  notify?: NotifyDeps;
}

export interface TournamentStartNotifierResult {
  fired: number;
  skipped: number;
}

interface DueTournament {
  id: string;
  name: string | null;
  level: string | null;
  starts_at: string | null;
  starting_notified_at: string | null;
}

export async function runTournamentStartNotifier(
  deps: TournamentStartNotifierDeps,
): Promise<TournamentStartNotifierResult> {
  const { supabase, logger } = deps;

  // notifyEvent needs a NotifyDeps; when env isn't configured we still build
  // a logger-only one so the call no-ops cleanly (notifyEvent guards on
  // baseUrl/cronSecret internally).
  const notifyDeps: NotifyDeps = deps.notify ?? {
    baseUrl: undefined,
    cronSecret: undefined,
    logger,
  };

  const nowIso = new Date().toISOString();
  const sinceIso = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString();

  const { data: due, error } = await supabase
    .from('tournaments')
    .select('id, name, level, starts_at, starting_notified_at')
    .is('starting_notified_at', null)
    .lte('starts_at', nowIso)
    .gte('starts_at', sinceIso);

  if (error) {
    logger.warn(
      { err: error.message },
      '[tournament-start-notifier] tournaments read failed',
    );
    return { fired: 0, skipped: 0 };
  }

  let fired = 0;
  let skipped = 0;

  for (const t of (due ?? []) as DueTournament[]) {
    // Atomic claim: only proceed if WE flip NULL → now. Prevents double-fire
    // across overlapping ticks / concurrent admin triggers.
    const { data: claimed, error: claimErr } = await supabase
      .from('tournaments')
      .update({ starting_notified_at: nowIso })
      .eq('id', t.id)
      .is('starting_notified_at', null)
      .select('id');

    if (claimErr) {
      logger.warn(
        { tournamentId: t.id, err: claimErr.message },
        '[tournament-start-notifier] claim update failed',
      );
      skipped++;
      continue;
    }
    if (!claimed || claimed.length === 0) {
      skipped++;
      continue;
    }

    notifyEvent(
      {
        category: 'tournament_starting',
        entityType: 'tournament',
        entityId: t.id,
        title: `${t.name ?? 'A tournament'} is underway`,
        body: 'Play has started — follow the action and order of play.',
        url: `/tournaments/${t.id}`,
        dedupeKey: `tournament_starting:${t.id}`,
      },
      notifyDeps,
    );
    fired++;
  }

  logger.info(
    { fired, skipped },
    `[tournament-start-notifier] fired=${fired} skipped=${skipped}`,
  );
  return { fired, skipped };
}

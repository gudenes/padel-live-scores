/**
 * notify-stats — in-memory counters for the padelgod → web-push notify hook.
 *
 * Why
 * ---
 * The notify hook (src/lib/notify.ts) fires fire-and-forget into Vercel's
 * /api/push/notify endpoint. When a push doesn't land on a user's phone, the
 * question is always the same: did the hook fire? Did Vercel accept it?
 * Was the secret right? Is the env even configured?
 *
 * Railway log access is painful from a Claude session and for anyone not
 * currently logged in. This module accumulates counters in RAM so the
 * existing `/admin/*` fastify surface can expose a GET route that tells
 * you the full story in one curl:
 *
 *   {
 *     env_configured: true,
 *     total_attempted: 3,
 *     total_skipped_env_missing: 0,
 *     total_skipped_not_scheduled: 1,  // prevStatus wasn't 'scheduled' (already notified)
 *     total_fired: 2,
 *     total_success: 2,
 *     total_non_ok: 0,                  // HTTP !2xx from /api/push/notify
 *     total_fetch_error: 0,             // network/DNS/etc failures
 *     last_success: { at, matchId },
 *     last_non_ok: { at, matchId, status, body },
 *     last_fetch_error: { at, matchId, error },
 *     last_skip: { at, matchId, reason },
 *   }
 *
 * Tradeoffs
 * ---------
 * - Counters reset on every Railway restart. That's acceptable — we only
 *   care about the live-transition window (hours, not days). If we need
 *   persistence later, we can mirror to a padelgod.notify_attempts table.
 * - Module-scoped singleton, same pattern as `workers/live-poller-manager.ts`'s
 *   `activePollers` map. Tests use `__resetNotifyStats` to isolate.
 * - No locks — JS is single-threaded per Node process, counters are atomic
 *   from the event loop's perspective.
 */

export interface NotifyStats {
  env_configured: boolean;
  started_at: string; // ISO
  total_attempted: number; // every call into notifyLiveTransition
  total_skipped_env_missing: number;
  total_skipped_not_scheduled: number; // prevStatus !== 'scheduled'
  total_fired: number; // actually called fetch()
  total_success: number; // fetch returned ok (2xx)
  total_non_ok: number; // fetch returned non-ok (4xx/5xx)
  total_fetch_error: number; // fetch threw (network, DNS, etc.)
  last_success: { at: string; matchId: string } | null;
  last_non_ok: {
    at: string;
    matchId: string;
    status: number;
    body: string;
  } | null;
  last_fetch_error: { at: string; matchId: string; error: string } | null;
  last_skip: { at: string; matchId: string; reason: string } | null;
}

function emptyStats(envConfigured: boolean): NotifyStats {
  return {
    env_configured: envConfigured,
    started_at: new Date().toISOString(),
    total_attempted: 0,
    total_skipped_env_missing: 0,
    total_skipped_not_scheduled: 0,
    total_fired: 0,
    total_success: 0,
    total_non_ok: 0,
    total_fetch_error: 0,
    last_success: null,
    last_non_ok: null,
    last_fetch_error: null,
    last_skip: null,
  };
}

// Module-level singleton. Populated by recordEnvConfigured() at startup so
// the `env_configured` flag reflects what the process actually sees.
let stats: NotifyStats = emptyStats(false);

export function recordEnvConfigured(configured: boolean): void {
  // If flipping from false → true (e.g., env set on first load), preserve
  // any pre-existing counters. First call wins; later flips are ignored
  // unless you reset. This avoids confusing double-inits.
  if (stats.env_configured !== configured) {
    stats = { ...stats, env_configured: configured };
  }
}

export function recordAttempt(): void {
  stats.total_attempted += 1;
}

export function recordSkipEnvMissing(matchId: string): void {
  stats.total_skipped_env_missing += 1;
  stats.last_skip = {
    at: new Date().toISOString(),
    matchId,
    reason: 'env_missing',
  };
}

export function recordSkipNotScheduled(
  matchId: string,
  prevStatus: string | null,
): void {
  stats.total_skipped_not_scheduled += 1;
  stats.last_skip = {
    at: new Date().toISOString(),
    matchId,
    reason: `prev_status_${prevStatus ?? 'null'}`,
  };
}

export function recordFired(): void {
  stats.total_fired += 1;
}

export function recordSuccess(matchId: string): void {
  stats.total_success += 1;
  stats.last_success = { at: new Date().toISOString(), matchId };
}

export function recordNonOk(
  matchId: string,
  status: number,
  body: string,
): void {
  stats.total_non_ok += 1;
  stats.last_non_ok = {
    at: new Date().toISOString(),
    matchId,
    status,
    body: body.slice(0, 500),
  };
}

export function recordFetchError(matchId: string, error: string): void {
  stats.total_fetch_error += 1;
  stats.last_fetch_error = {
    at: new Date().toISOString(),
    matchId,
    error: error.slice(0, 500),
  };
}

export function getNotifyStats(): NotifyStats {
  // Return a defensive copy so callers can't mutate our state.
  return { ...stats };
}

/** Test-only: reset counters back to zero. */
export function __resetNotifyStats(envConfigured = false): void {
  stats = emptyStats(envConfigured);
}

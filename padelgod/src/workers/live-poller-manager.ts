/**
 * live-poller-manager — orchestrates LivePollerLoop instances (Task 13) based
 * on the `padelgod_tournaments_for_live_polling()` RPC (migration 016).
 *
 * Runs every 60s as a "manager" that reconciles the in-memory set of active
 * pollers against the RPC result:
 *
 *   - Tournament appears in RPC but not in map → create + start a loop
 *   - Tournament in map but not in RPC         → stop the loop + remove it
 *
 * The active-pollers map lives at module scope so it persists across cron
 * fires on the same Node process. If the process restarts, the next tick
 * recreates loops for every currently-active tournament — equivalent to
 * `started=N, stopped=0` on first call.
 *
 * Cutover semantics: flipping `tournaments.live_source='padelgod'` (within
 * the event window) makes the row appear in the RPC; the manager picks it up
 * within 60s and starts a loop. Flipping back removes it; the manager stops
 * the loop within 60s.
 *
 * Errors
 * ------
 * - RPC failure: throws — the scheduler wrapper logs and continues next tick.
 * - Individual loop start/stop failures: logged at `warn`, loop continues on
 *   the other entries. The failing loop is still inserted into / removed from
 *   the map so state doesn't drift (a subsequent tick can retry).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import type { Logger } from 'pino';
import { LivePollerLoop } from '../lib/live-poller-loop.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LivePollerManagerDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
  logger: Logger;
}

export interface LivePollerManagerResult {
  active: number;
  started: number;
  stopped: number;
}

interface ActivePollingRow {
  tournament_id: string;
  tournament_name: string;
  widget_id: string;
  starts_at?: string;
  ends_at?: string;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/**
 * Map of tournamentId → LivePollerLoop. Lives at module scope so it persists
 * across manager invocations on the same process (the cron fires every minute
 * and we don't want to re-create all loops each tick).
 *
 * Tests reset this via `__resetActivePollers` in `beforeEach`.
 */
const activePollers = new Map<string, LivePollerLoop>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runLivePollerManager(
  deps: LivePollerManagerDeps,
): Promise<LivePollerManagerResult> {
  const { data, error } = await deps.supabase.rpc(
    'padelgod_tournaments_for_live_polling',
  );
  if (error) {
    throw new Error(`RPC padelgod_tournaments_for_live_polling failed: ${error.message}`);
  }

  const rows = (data ?? []) as ActivePollingRow[];
  const activeIds = new Set(rows.map((r) => r.tournament_id));

  let started = 0;
  let stopped = 0;

  // Start loops for new tournaments.
  for (const row of rows) {
    if (activePollers.has(row.tournament_id)) continue;

    const loop = new LivePollerLoop({
      tournamentId: row.tournament_id,
      widgetId: row.widget_id,
      supabase: deps.supabase,
      httpClient: deps.httpClient,
      logger: deps.logger.child({
        poller: row.tournament_id,
        widget: row.widget_id,
      }),
    });

    try {
      await loop.start();
      activePollers.set(row.tournament_id, loop);
      deps.logger.info(
        {
          tournamentId: row.tournament_id,
          widgetId: row.widget_id,
          name: row.tournament_name,
        },
        'live-poller-manager: started loop',
      );
      started++;
    } catch (err) {
      deps.logger.warn(
        {
          tournamentId: row.tournament_id,
          widgetId: row.widget_id,
          err: err instanceof Error ? err.message : String(err),
        },
        'live-poller-manager: failed to start loop, will retry next tick',
      );
    }
  }

  // Stop loops for tournaments that dropped out of the active list (window
  // ended, live_source flipped back to padelapi, etc).
  for (const [tournamentId, loop] of activePollers.entries()) {
    if (activeIds.has(tournamentId)) continue;

    try {
      await loop.stop();
      deps.logger.info({ tournamentId }, 'live-poller-manager: stopped loop');
    } catch (err) {
      deps.logger.warn(
        {
          tournamentId,
          err: err instanceof Error ? err.message : String(err),
        },
        'live-poller-manager: failed to stop loop cleanly, removing from map',
      );
    }

    // Remove from the map whether stop() succeeded or not — the tournament
    // is no longer active, and leaving a stale entry would permanently block
    // a future restart.
    activePollers.delete(tournamentId);
    stopped++;
  }

  return { active: activePollers.size, started, stopped };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Test-only: reset the in-memory active-pollers map between tests. Called
 * from `beforeEach` in the manager test suite so state doesn't leak.
 *
 * Fire-and-forget stop() on any remaining loops — tests mock LivePollerLoop
 * so this is effectively a no-op there. In production this helper isn't used.
 */
export function __resetActivePollers(): void {
  for (const loop of activePollers.values()) {
    // Ignore any rejection — the loop may already be stopped or the mock
    // may not implement stop(). The caller only cares that the map is clear.
    loop.stop().catch(() => {});
  }
  activePollers.clear();
}

/**
 * live-poller-manager — orchestrates LivePollerLoop instances (Task 13) based
 * on two reconciliation RPCs:
 *
 *   - `padelgod_tournaments_for_live_polling()` → tournaments where we own the
 *     live feed (live_source='padelgod'). Loops run in `canonical` mode and
 *     write to the real tables.
 *   - `padelgod_tournaments_for_shadow_polling()` → tournaments where padelapi
 *     still owns the live feed but we're shadow-polling for parity validation.
 *     Loops run in `shadow` mode and write only to snapshot tables.
 *
 * Runs every 60s as a "manager" that reconciles the in-memory set of active
 * pollers against the combined desired state:
 *
 *   - Tournament appears in a RPC but not in map → create + start a loop
 *     with the appropriate mode.
 *   - Tournament in map with same mode → no-op.
 *   - Tournament in map with a different mode than desired (e.g. shadow → canonical
 *     cutover) → stop the old loop + start a fresh loop in the new mode.
 *   - Tournament in map but not in either RPC → stop the loop + remove it.
 *
 * The active-pollers map lives at module scope so it persists across cron
 * fires on the same Node process. If the process restarts, the next tick
 * recreates loops for every currently-active tournament — equivalent to
 * `started=N, stopped=0` on first call.
 *
 * Canonical wins on conflict: if a tournament surfaces in both RPCs (shouldn't
 * happen given the RPCs' live_source filters, but defensive), canonical mode
 * is chosen.
 *
 * Errors
 * ------
 * - Either RPC failure: throws — the scheduler wrapper logs and continues next
 *   tick. No partial application; in-memory state is untouched.
 * - Individual loop start failure: logged at `warn`, tournament skipped this
 *   tick, NOT added to map (next tick retries).
 * - Individual loop stop failure: logged at `warn`, loop removed from map
 *   anyway. Leaving a zombie entry would permanently block a future restart.
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

type PollerMode = 'canonical' | 'shadow';

interface ActivePollingRow {
  tournament_id: string;
  tournament_name: string;
  widget_id: string;
  starts_at?: string;
  ends_at?: string;
}

interface DesiredPoller {
  widget_id: string;
  mode: PollerMode;
  name: string;
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
  // Query BOTH RPCs in parallel. If either fails, abort this tick without
  // touching state — scheduler will retry on the next fire.
  const [canonicalRes, shadowRes] = await Promise.all([
    deps.supabase.rpc('padelgod_tournaments_for_live_polling'),
    deps.supabase.rpc('padelgod_tournaments_for_shadow_polling'),
  ]);

  if (canonicalRes.error) {
    throw new Error(
      `RPC padelgod_tournaments_for_live_polling failed: ${canonicalRes.error.message}`,
    );
  }
  if (shadowRes.error) {
    throw new Error(
      `RPC padelgod_tournaments_for_shadow_polling failed: ${shadowRes.error.message}`,
    );
  }

  const canonicalRows = (canonicalRes.data ?? []) as ActivePollingRow[];
  const shadowRows = (shadowRes.data ?? []) as ActivePollingRow[];

  // Build desired-state map. Insert shadow rows first so that any canonical
  // row for the same tournament_id overwrites them — canonical wins on conflict.
  const desired = new Map<string, DesiredPoller>();
  for (const r of shadowRows) {
    desired.set(r.tournament_id, {
      widget_id: r.widget_id,
      mode: 'shadow',
      name: r.tournament_name,
    });
  }
  for (const r of canonicalRows) {
    desired.set(r.tournament_id, {
      widget_id: r.widget_id,
      mode: 'canonical',
      name: r.tournament_name,
    });
  }

  let started = 0;
  let stopped = 0;

  // Start new loops + restart loops whose mode changed.
  for (const [tournamentId, want] of desired) {
    const existing = activePollers.get(tournamentId);

    if (existing) {
      const existingMode = getLoopMode(existing);
      if (existingMode === want.mode) {
        // Same tournament, same mode — no-op.
        continue;
      }
      // Mode transition — stop old, start new.
      deps.logger.info(
        {
          tournamentId,
          fromMode: existingMode,
          toMode: want.mode,
        },
        'live-poller-manager: mode changed, restarting loop',
      );
      try {
        await existing.stop();
      } catch (err) {
        deps.logger.warn(
          {
            tournamentId,
            err: err instanceof Error ? err.message : String(err),
          },
          'live-poller-manager: stop() failed during mode transition, removing anyway',
        );
      }
      activePollers.delete(tournamentId);
      stopped++;
      // Fall through to start a fresh loop below.
    }

    const loop = new LivePollerLoop({
      tournamentId,
      widgetId: want.widget_id,
      mode: want.mode,
      supabase: deps.supabase,
      httpClient: deps.httpClient,
      logger: deps.logger.child({
        poller: tournamentId,
        widget: want.widget_id,
        mode: want.mode,
      }),
    });

    try {
      await loop.start();
      activePollers.set(tournamentId, loop);
      deps.logger.info(
        {
          tournamentId,
          widgetId: want.widget_id,
          name: want.name,
          mode: want.mode,
        },
        'live-poller-manager: started loop',
      );
      started++;
    } catch (err) {
      deps.logger.warn(
        {
          tournamentId,
          widgetId: want.widget_id,
          mode: want.mode,
          err: err instanceof Error ? err.message : String(err),
        },
        'live-poller-manager: failed to start loop, will retry next tick',
      );
      // Do NOT add to map — next tick retries.
    }
  }

  // Stop loops for tournaments that dropped out of both active lists (window
  // ended, live_source flipped back off shadow list, etc).
  for (const [tournamentId, loop] of activePollers.entries()) {
    if (desired.has(tournamentId)) continue;

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

    // Remove from the map whether stop() succeeded or not — leaving a stale
    // entry would permanently block a future restart.
    activePollers.delete(tournamentId);
    stopped++;
  }

  return { active: activePollers.size, started, stopped };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read the `mode` from a running LivePollerLoop instance via its private
 * `opts` field. LivePollerLoop doesn't expose a public `mode` getter, and we
 * don't want to track it redundantly in the manager. Defaults to 'canonical'
 * when missing (pre-mode legacy loops).
 */
function getLoopMode(loop: LivePollerLoop): PollerMode {
  const opts = (loop as unknown as { opts?: { mode?: PollerMode } }).opts;
  return opts?.mode ?? 'canonical';
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

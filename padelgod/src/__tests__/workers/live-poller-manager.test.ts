import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import type { Logger } from 'pino';

import { LivePollerLoop } from '../../lib/live-poller-loop.js';
import {
  runLivePollerManager,
  __resetActivePollers,
} from '../../workers/live-poller-manager.js';

// Mock LivePollerLoop so we can assert start/stop without real HTTP / timers.
// `this.opts = opts` captures the constructor args (including `mode`) so the
// manager's getLoopMode() helper can read them back.
vi.mock('../../lib/live-poller-loop.js', () => {
  const LivePollerLoopMock = vi.fn().mockImplementation(function (
    this: any,
    opts: any,
  ) {
    this.opts = opts;
    this.start = vi.fn().mockResolvedValue(undefined);
    this.stop = vi.fn().mockResolvedValue(undefined);
    this.isRunning = vi.fn().mockReturnValue(true);
  });
  return { LivePollerLoop: LivePollerLoopMock };
});

type RpcRow = {
  tournament_id: string;
  tournament_name: string;
  widget_id: string;
};

type RpcInput = RpcRow[] | { error: string };

/**
 * Build deps with independent canonical + shadow RPC responses.
 *
 * - If `canonical` is an array, the canonical RPC returns {data, error:null}.
 * - If `canonical` is {error: string}, the canonical RPC returns the error.
 * - Same for `shadow`. Default for `shadow` is [] (no shadow tournaments).
 */
function makeDeps(canonical: RpcInput, shadow: RpcInput = []) {
  const respond = (input: RpcInput) => {
    if (Array.isArray(input)) {
      return Promise.resolve({ data: input, error: null });
    }
    return Promise.resolve({ data: null, error: { message: input.error } });
  };

  const rpc = vi.fn().mockImplementation((name: string) => {
    if (name === 'padelgod_tournaments_for_live_polling') return respond(canonical);
    if (name === 'padelgod_tournaments_for_shadow_polling') return respond(shadow);
    throw new Error(`unexpected rpc: ${name}`);
  });

  const childLogger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
  } as unknown as Logger;
  // Recursive child() so .child().child() works
  (childLogger.child as any).mockReturnValue(childLogger);

  const logger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnValue(childLogger),
  } as unknown as Logger;

  const supabase = { rpc } as unknown as SupabaseClient;
  const httpClient = {} as unknown as AxiosInstance;

  return { supabase, httpClient, logger, rpc };
}

describe('runLivePollerManager', () => {
  beforeEach(() => {
    __resetActivePollers();
    vi.mocked(LivePollerLoop).mockClear();
  });

  it('starts new loops for tournaments in the RPC result', async () => {
    const rows: RpcRow[] = [
      { tournament_id: 't-1', tournament_name: 'FIP One', widget_id: 'W-1' },
      { tournament_id: 't-2', tournament_name: 'FIP Two', widget_id: 'W-2' },
    ];
    const deps = makeDeps(rows);

    const result = await runLivePollerManager(deps);

    expect(result).toEqual({ active: 2, started: 2, stopped: 0 });
    expect(LivePollerLoop).toHaveBeenCalledTimes(2);

    // Check both were constructed with the right tournament/widget ids
    const calls = vi.mocked(LivePollerLoop).mock.calls;
    const callArgs = calls.map((c: any[]) => ({
      tournamentId: c[0].tournamentId,
      widgetId: c[0].widgetId,
    }));
    expect(callArgs).toEqual(
      expect.arrayContaining([
        { tournamentId: 't-1', widgetId: 'W-1' },
        { tournamentId: 't-2', widgetId: 'W-2' },
      ]),
    );

    // Each instance should have had start() called once
    const instances = vi.mocked(LivePollerLoop).mock.instances as any[];
    expect(instances).toHaveLength(2);
    for (const inst of instances) {
      expect(inst.start).toHaveBeenCalledTimes(1);
      expect(inst.stop).not.toHaveBeenCalled();
    }
  });

  it('stops loops for tournaments that dropped out of the RPC result', async () => {
    // First call: one tournament active.
    const depsFirst = makeDeps([
      { tournament_id: 't-1', tournament_name: 'FIP One', widget_id: 'W-1' },
    ]);
    await runLivePollerManager(depsFirst);

    const firstInstance = vi.mocked(LivePollerLoop).mock.instances[0] as any;
    expect(firstInstance.start).toHaveBeenCalledTimes(1);

    // Second call: RPC now returns nothing → t-1's loop should be stopped.
    const depsSecond = makeDeps([]);
    const result = await runLivePollerManager(depsSecond);

    expect(result).toEqual({ active: 0, started: 0, stopped: 1 });
    expect(firstInstance.stop).toHaveBeenCalledTimes(1);
    // No new loops instantiated
    expect(LivePollerLoop).toHaveBeenCalledTimes(1);
  });

  it('is a no-op for tournaments already being polled', async () => {
    // First call: tournament A is active and gets a loop.
    await runLivePollerManager(
      makeDeps([
        { tournament_id: 't-A', tournament_name: 'A', widget_id: 'W-A' },
      ]),
    );
    const aInstance = vi.mocked(LivePollerLoop).mock.instances[0] as any;
    expect(aInstance.start).toHaveBeenCalledTimes(1);

    // Second call: RPC returns A + B. A should NOT be re-created, only B.
    const result = await runLivePollerManager(
      makeDeps([
        { tournament_id: 't-A', tournament_name: 'A', widget_id: 'W-A' },
        { tournament_id: 't-B', tournament_name: 'B', widget_id: 'W-B' },
      ]),
    );

    expect(result).toEqual({ active: 2, started: 1, stopped: 0 });
    // Two total constructions across both calls (A from first call, B from second)
    expect(LivePollerLoop).toHaveBeenCalledTimes(2);
    // A still only had start() called once — it was not recreated or restarted
    expect(aInstance.start).toHaveBeenCalledTimes(1);
    expect(aInstance.stop).not.toHaveBeenCalled();

    // The second construction should have been for t-B
    const secondCallArgs = vi.mocked(LivePollerLoop).mock.calls[1][0] as any;
    expect(secondCallArgs.tournamentId).toBe('t-B');
    expect(secondCallArgs.widgetId).toBe('W-B');
    const bInstance = vi.mocked(LivePollerLoop).mock.instances[1] as any;
    expect(bInstance.start).toHaveBeenCalledTimes(1);
  });

  // ---- Task 6: canonical + shadow reconciliation ----

  it('starts canonical + shadow loops from their respective RPCs', async () => {
    const canonical: RpcRow[] = [
      { tournament_id: 'tour-A', tournament_name: 'Canonical A', widget_id: 'W-A' },
    ];
    const shadow: RpcRow[] = [
      { tournament_id: 'tour-B', tournament_name: 'Shadow B', widget_id: 'W-B' },
    ];
    const deps = makeDeps(canonical, shadow);

    const result = await runLivePollerManager(deps);

    expect(result).toEqual({ active: 2, started: 2, stopped: 0 });
    expect(LivePollerLoop).toHaveBeenCalledTimes(2);

    const calls = vi.mocked(LivePollerLoop).mock.calls.map(
      (c: any[]) => c[0],
    );
    const byId = new Map<string, any>(calls.map((c: any) => [c.tournamentId, c]));
    expect(byId.get('tour-A')?.mode).toBe('canonical');
    expect(byId.get('tour-B')?.mode).toBe('shadow');

    // Each loop started exactly once
    const instances = vi.mocked(LivePollerLoop).mock.instances as any[];
    for (const inst of instances) {
      expect(inst.start).toHaveBeenCalledTimes(1);
      expect(inst.stop).not.toHaveBeenCalled();
    }
  });

  it('restarts a loop when its mode changes (shadow → canonical cutover)', async () => {
    // Prime: tour-X is shadow-polled.
    await runLivePollerManager(
      makeDeps([], [
        { tournament_id: 'tour-X', tournament_name: 'X', widget_id: 'W-X' },
      ]),
    );
    const shadowInstance = vi.mocked(LivePollerLoop).mock.instances[0] as any;
    expect(shadowInstance.opts.mode).toBe('shadow');
    expect(shadowInstance.start).toHaveBeenCalledTimes(1);

    // Cutover: tour-X moves to canonical (live_source flipped to padelgod).
    const result = await runLivePollerManager(
      makeDeps(
        [{ tournament_id: 'tour-X', tournament_name: 'X', widget_id: 'W-X' }],
        [],
      ),
    );

    expect(result).toEqual({ active: 1, started: 1, stopped: 1 });

    // Old shadow loop was stopped.
    expect(shadowInstance.stop).toHaveBeenCalledTimes(1);

    // A new loop was constructed with mode='canonical'.
    expect(LivePollerLoop).toHaveBeenCalledTimes(2);
    const canonicalInstance = vi.mocked(LivePollerLoop).mock.instances[1] as any;
    expect(canonicalInstance.opts.mode).toBe('canonical');
    expect(canonicalInstance.opts.tournamentId).toBe('tour-X');
    expect(canonicalInstance.start).toHaveBeenCalledTimes(1);
  });

  it('stops a loop when its tournament is in neither RPC', async () => {
    // Prime: tour-Y is canonical-polled.
    await runLivePollerManager(
      makeDeps([
        { tournament_id: 'tour-Y', tournament_name: 'Y', widget_id: 'W-Y' },
      ]),
    );
    const yInstance = vi.mocked(LivePollerLoop).mock.instances[0] as any;
    expect(yInstance.start).toHaveBeenCalledTimes(1);

    // Next tick: both RPCs empty.
    const result = await runLivePollerManager(makeDeps([], []));

    expect(result).toEqual({ active: 0, started: 0, stopped: 1 });
    expect(yInstance.stop).toHaveBeenCalledTimes(1);
    // No new construction on the drain tick.
    expect(LivePollerLoop).toHaveBeenCalledTimes(1);
  });

  it('prefers canonical when a tournament appears in both RPCs', async () => {
    const both: RpcRow[] = [
      { tournament_id: 'tour-dup', tournament_name: 'Dup', widget_id: 'W-dup' },
    ];
    const deps = makeDeps(both, both);

    const result = await runLivePollerManager(deps);

    expect(result).toEqual({ active: 1, started: 1, stopped: 0 });
    expect(LivePollerLoop).toHaveBeenCalledTimes(1);
    const instance = vi.mocked(LivePollerLoop).mock.instances[0] as any;
    expect(instance.opts.mode).toBe('canonical');
    expect(instance.opts.tournamentId).toBe('tour-dup');
  });

  it('throws when the canonical RPC returns an error (state unchanged)', async () => {
    // Prime with one canonical loop so we can verify state is untouched.
    await runLivePollerManager(
      makeDeps([
        { tournament_id: 'tour-pre', tournament_name: 'Pre', widget_id: 'W-pre' },
      ]),
    );
    const preInstance = vi.mocked(LivePollerLoop).mock.instances[0] as any;
    expect(preInstance.start).toHaveBeenCalledTimes(1);
    const beforeCallCount = vi.mocked(LivePollerLoop).mock.calls.length;

    // Next tick: canonical RPC errors.
    const deps = makeDeps({ error: 'canonical boom' }, []);
    await expect(runLivePollerManager(deps)).rejects.toThrow(/canonical boom/);

    // No new loops constructed, pre-existing loop not stopped.
    expect(vi.mocked(LivePollerLoop).mock.calls.length).toBe(beforeCallCount);
    expect(preInstance.stop).not.toHaveBeenCalled();
  });

  it('throws when the shadow RPC returns an error (state unchanged)', async () => {
    // Prime with one canonical loop.
    await runLivePollerManager(
      makeDeps([
        { tournament_id: 'tour-pre2', tournament_name: 'Pre2', widget_id: 'W-pre2' },
      ]),
    );
    const preInstance = vi.mocked(LivePollerLoop).mock.instances[0] as any;
    const beforeCallCount = vi.mocked(LivePollerLoop).mock.calls.length;

    // Next tick: shadow RPC errors.
    const deps = makeDeps([], { error: 'shadow boom' });
    await expect(runLivePollerManager(deps)).rejects.toThrow(/shadow boom/);

    expect(vi.mocked(LivePollerLoop).mock.calls.length).toBe(beforeCallCount);
    expect(preInstance.stop).not.toHaveBeenCalled();
  });
});

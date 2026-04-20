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

function makeDeps(rpcRows: RpcRow[] | { error: string }) {
  const rpc = vi.fn().mockImplementation(async () => {
    if (Array.isArray(rpcRows)) {
      return { data: rpcRows, error: null };
    }
    return { data: null, error: { message: rpcRows.error } };
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
});

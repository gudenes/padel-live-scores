import { describe, it, expect } from 'vitest';
import { runRawPayloadsPrune } from '../../workers/raw-payloads-prune.js';

/**
 * Stub supabase for the time-window prune.
 *
 * The old stub accepted `.in(col, ids)` happily, which is exactly why the
 * 10,000-id URL bug shipped: the tests never built a real request. This one
 * THROWS on `.in()` so the id-batching shape can't come back unnoticed, and
 * it records every delete's `lt` bound so window advancement is assertable.
 *
 * `rows` is a set of captured_at timestamps standing in for the table; the
 * stub deletes from it for real, so the loop's termination is exercised
 * rather than mocked.
 */
function fakeSupabase(
  rows: string[],
  opts: { deleteError?: string; probeError?: string; maxRowsPerDelete?: number } = {},
) {
  const remaining = [...rows].sort();
  const deleteBounds: string[] = [];

  return {
    remaining,
    deleteBounds,
    schema: (_s: string) => ({
      from: (_t: string) => {
        const state: any = { op: null, head: false, lt: null };
        const builder: any = {
          select: (_c: string, o?: any) => {
            state.op = 'select';
            if (o?.head) state.head = true;
            return builder;
          },
          delete: (_o?: any) => { state.op = 'delete'; return builder; },
          lt: (_c: string, v: string) => { state.lt = v; return builder; },
          order: () => builder,
          limit: () => builder,
          in: () => {
            throw new Error(
              '.in() must never be used here — ids in the URL are what broke this worker',
            );
          },
          then: (resolve: any) => {
            if (state.op === 'select' && state.head) {
              return resolve({ count: remaining.filter((r) => r < state.lt).length, error: null });
            }
            if (state.op === 'select') {
              if (opts.probeError) return resolve({ data: null, error: { message: opts.probeError } });
              const oldest = remaining.filter((r) => r < state.lt)[0];
              return resolve({ data: oldest ? [{ captured_at: oldest }] : [], error: null });
            }
            if (state.op === 'delete') {
              if (opts.deleteError) return resolve({ count: null, error: { message: opts.deleteError } });
              // Statement-timeout simulation: a delete spanning too many rows
              // is cancelled, exactly as `authenticator`'s 8s budget does.
              if (opts.maxRowsPerDelete != null
                  && remaining.filter((r) => r < state.lt).length > opts.maxRowsPerDelete) {
                return resolve({
                  count: null,
                  error: { message: 'canceling statement due to statement timeout', code: '57014' },
                });
              }
              deleteBounds.push(state.lt);
              const doomed = remaining.filter((r) => r < state.lt);
              for (const d of doomed) remaining.splice(remaining.indexOf(d), 1);
              return resolve({ count: doomed.length, error: null });
            }
            return resolve({ data: null, error: null });
          },
        };
        return builder;
      },
    }),
  };
}

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString();

describe('runRawPayloadsPrune', () => {
  it('deletes everything past the cutoff, walking one window at a time', async () => {
    // 40, 39, 38 days old — all well past the 14-day cutoff.
    const sb = fakeSupabase([daysAgo(40), daysAgo(39), daysAgo(38)]);
    const res = await runRawPayloadsPrune({ supabase: sb as any, dryRun: false });

    expect(res.rowsDeleted).toBe(3);
    expect(sb.remaining).toEqual([]);
    // Rows sit a day apart and the default window is 2h, so each row
    // falls in its own delete.
    expect(res.batchesRun).toBe(3);
    expect(res.abortedEarly).toBe(false);
  });

  it('keeps rows inside the retention window', async () => {
    const fresh = daysAgo(3);
    const sb = fakeSupabase([daysAgo(40), fresh]);
    const res = await runRawPayloadsPrune({ supabase: sb as any, dryRun: false });

    expect(res.rowsDeleted).toBe(1);
    expect(sb.remaining).toEqual([fresh]);
  });

  it('never widens a delete past the cutoff', async () => {
    const sb = fakeSupabase([daysAgo(40), daysAgo(3)]);
    await runRawPayloadsPrune({ supabase: sb as any, dryRun: false, retentionDays: 14 });

    const cutoff = daysAgo(14);
    for (const bound of sb.deleteBounds) expect(bound <= cutoff).toBe(true);
  });

  it('clears a large backlog without ever passing ids to .in()', async () => {
    // 300 rows spread a day apart — the shape that used to abort on batch 1.
    // The stub throws if .in() is touched, so reaching 0 proves the fix.
    const backlog = Array.from({ length: 300 }, (_, i) => daysAgo(20 + i));
    const sb = fakeSupabase(backlog);
    const res = await runRawPayloadsPrune({ supabase: sb as any, dryRun: false });

    expect(res.rowsDeleted).toBe(300);
    expect(sb.remaining).toEqual([]);
  });

  it('collapses a whole backlog into one delete at a wide window', async () => {
    const sb = fakeSupabase([daysAgo(40), daysAgo(39), daysAgo(38)]);
    const res = await runRawPayloadsPrune({
      supabase: sb as any, dryRun: false, windowHours: 24 * 365,
    });

    expect(res.rowsDeleted).toBe(3);
    expect(res.batchesRun).toBe(1);   // window clamps to the cutoff
  });

  it('does nothing when no rows are older than cutoff', async () => {
    const sb = fakeSupabase([daysAgo(2)]);
    const res = await runRawPayloadsPrune({ supabase: sb as any, dryRun: false });

    expect(res.rowsDeleted).toBe(0);
    expect(res.batchesRun).toBe(0);
    expect(sb.deleteBounds).toEqual([]);
  });

  it('dry-run reports candidate count and deletes nothing', async () => {
    const sb = fakeSupabase([daysAgo(40), daysAgo(39)]);
    const res = await runRawPayloadsPrune({ supabase: sb as any, dryRun: true });

    expect(res.candidateCount).toBe(2);
    expect(res.rowsDeleted).toBe(0);
    expect(sb.remaining).toHaveLength(2);
  });

  it('stops at maxBatches and flags it', async () => {
    const sb = fakeSupabase([daysAgo(40), daysAgo(39), daysAgo(38)]);
    const res = await runRawPayloadsPrune({
      supabase: sb as any, dryRun: false, maxBatches: 2,
    });

    expect(res.batchesRun).toBe(2);
    expect(res.hitMaxBatches).toBe(true);
    expect(sb.remaining).toHaveLength(1);   // leftovers wait for the next run
  });

  it('aborts early and flags it when a delete errors', async () => {
    const sb = fakeSupabase([daysAgo(40)], { deleteError: 'delete boom' });
    const res = await runRawPayloadsPrune({ supabase: sb as any, dryRun: false });

    expect(res.abortedEarly).toBe(true);
    expect(res.rowsDeleted).toBe(0);
  });

  it('aborts early when the oldest-row probe errors', async () => {
    const sb = fakeSupabase([daysAgo(40)], { probeError: 'probe boom' });
    const res = await runRawPayloadsPrune({ supabase: sb as any, dryRun: false });

    expect(res.abortedEarly).toBe(true);
    expect(res.rowsDeleted).toBe(0);
  });

  // ── statement-timeout backoff ───────────────────────────────────────────
  //
  // The production failure that shipping the URL fix alone did NOT solve:
  // the delete landed, then died on `authenticator`'s 8s statement_timeout,
  // and the run aborted having deleted nothing.

  it('halves the window and retries instead of aborting on a timeout', async () => {
    // 10 rows a day apart; the stub cancels any delete spanning >2 rows, so
    // the opening 24h window must back off before it can make progress.
    const rows = Array.from({ length: 10 }, (_, i) => daysAgo(30 + i));
    const sb = fakeSupabase(rows, { maxRowsPerDelete: 2 });
    const res = await runRawPayloadsPrune({
      supabase: sb as any, dryRun: false, windowHours: 24 * 30,
    });

    expect(res.rowsDeleted).toBe(10);
    expect(sb.remaining).toEqual([]);
    expect(res.abortedEarly).toBe(false);
    expect(res.windowShrinks).toBeGreaterThan(0);
    expect(res.finalWindowHours).toBeLessThan(24 * 30);
  });

  it('reports the window it settled on', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => daysAgo(30 + i));
    const sb = fakeSupabase(rows, { maxRowsPerDelete: 1 });
    const res = await runRawPayloadsPrune({
      supabase: sb as any, dryRun: false, windowHours: 48,
    });

    expect(res.rowsDeleted).toBe(6);
    expect(res.finalWindowHours).toBeLessThanOrEqual(48);
    expect(res.finalWindowHours).toBeGreaterThan(0);
  });

  it('gives up when even the floor window times out', async () => {
    // Nothing can be deleted at any size — a table-level problem, not a
    // batch-size one. Must abort rather than spin forever.
    const sb = fakeSupabase([daysAgo(40), daysAgo(39)], { maxRowsPerDelete: 0 });
    const res = await runRawPayloadsPrune({ supabase: sb as any, dryRun: false });

    expect(res.abortedEarly).toBe(true);
    expect(res.rowsDeleted).toBe(0);
    expect(sb.remaining).toHaveLength(2);
  });

  it('does not treat a non-timeout error as a reason to shrink', async () => {
    const sb = fakeSupabase([daysAgo(40)], { deleteError: 'permission denied' });
    const res = await runRawPayloadsPrune({ supabase: sb as any, dryRun: false });

    expect(res.abortedEarly).toBe(true);
    expect(res.windowShrinks).toBe(0);
  });
});

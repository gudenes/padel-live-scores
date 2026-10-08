import { describe, it, expect } from 'vitest';
import { runScrapeJobsPrune } from '../../workers/scrape-jobs-prune.js';

// Stub supabase whose `from('scrape_jobs')` builder is thenable.
// `selectBatches` are the successive id arrays returned by select().lt().limit();
// `countValue` is returned for the head-count select used in dry-run.
function fakeSupabase(selectBatches: string[][], countValue = 0, deleteError?: string) {
  const deletedBatches: string[][] = [];
  let idx = 0;
  return {
    deletedBatches,
    schema: (_s: string) => ({
      from: (_t: string) => {
        const state: any = { op: null, head: false };
        const builder: any = {
          select: (_c: string, o?: any) => { state.op = 'select'; if (o?.head) state.head = true; return builder; },
          delete: (_o?: any) => { state.op = 'delete'; return builder; },
          lt: () => builder,
          in: (_c: string, ids: string[]) => { state.ids = ids; return builder; },
          limit: () => builder,
          then: (resolve: any) => {
            if (state.op === 'select' && state.head) return resolve({ count: countValue, error: null });
            if (state.op === 'select') { const b = selectBatches[idx] ?? []; idx++; return resolve({ data: b.map((id) => ({ id })), error: null }); }
            if (state.op === 'delete') {
              if (deleteError) return resolve({ count: null, error: { message: deleteError } });
              deletedBatches.push(state.ids); return resolve({ count: state.ids.length, error: null });
            }
            return resolve({ data: null, error: null });
          },
        };
        return builder;
      },
    }),
  };
}

describe('runScrapeJobsPrune', () => {
  it('deletes rows older than cutoff across batches', async () => {
    const sb = fakeSupabase([['a', 'b'], ['c']]);
    const res = await runScrapeJobsPrune({ supabase: sb as any, dryRun: false, batchSize: 2, maxBatches: 10 });
    expect(res.rowsDeleted).toBe(3);
    expect(res.batchesRun).toBe(2);
    expect(sb.deletedBatches).toEqual([['a', 'b'], ['c']]);
    expect(res.hitMaxBatches).toBe(false);
  });

  it('does nothing when no rows are older than cutoff', async () => {
    const sb = fakeSupabase([[]]);
    const res = await runScrapeJobsPrune({ supabase: sb as any, dryRun: false, batchSize: 2, maxBatches: 10 });
    expect(res.rowsDeleted).toBe(0);
    expect(res.batchesRun).toBe(0);
    expect(sb.deletedBatches).toEqual([]);
  });

  it('dry-run reports candidate count and deletes nothing', async () => {
    const sb = fakeSupabase([], 42);
    const res = await runScrapeJobsPrune({ supabase: sb as any, dryRun: true });
    expect(res.candidateCount).toBe(42);
    expect(res.rowsDeleted).toBe(0);
    expect(sb.deletedBatches).toEqual([]);
  });

  it('stops at maxBatches and flags it', async () => {
    const sb = fakeSupabase([['a', 'b'], ['c', 'd'], ['e', 'f']]);
    const res = await runScrapeJobsPrune({ supabase: sb as any, dryRun: false, batchSize: 2, maxBatches: 2 });
    expect(res.batchesRun).toBe(2);
    expect(res.rowsDeleted).toBe(4);
    expect(res.hitMaxBatches).toBe(true);
  });

  it('aborts early and flags it when a delete batch errors', async () => {
    const sb = fakeSupabase([['a', 'b']], 0, 'delete boom');
    const res = await runScrapeJobsPrune({ supabase: sb as any, dryRun: false, batchSize: 2, maxBatches: 10 });
    expect(res.abortedEarly).toBe(true);
    expect(res.rowsDeleted).toBe(0);
  });
});

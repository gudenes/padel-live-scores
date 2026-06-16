import { describe, it, expect, vi, beforeEach } from 'vitest';

const applyDiff = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../lib/point-reconstruction.js', async (orig) => ({
  ...(await orig<any>()),
  applyDiff,
}));

import { runWebtugaLiveFetcher } from '../../workers/webtuga-live-fetcher.js';
import * as client from '../../lib/webtuga-client.js';
import * as cache from '../../lib/webtuga-cache.js';

const LIVE_ROW = {
  id: 2, court: 'Central Court', time: '10:00', round: 'Qualifiers',
  category: 'Femininos', status: 'Live',
  teamA: 'A. Garcia / C. Sánchez', teamB: 'I. Caño / C. Aguila',
  setsA: 1, setsB: 0, gamesA: 1, gamesB: 0,
  pointsA: '30', pointsB: '15', setsHistoryA: '6', setsHistoryB: '2',
  live: true, finished: false, updatedAt: '2026-06-16T09:40:00',
};

const CANDIDATE = {
  id: 'uuid-garcia', category: 'women',
  pair1_player1_id: 'p1', pair1_player2_id: 'p2',
  pair2_player1_id: 'p3', pair2_player2_id: 'p4',
  pair1_player1_name: 'Aitana Garcia Roman', pair1_player2_name: 'Cayetana Sanchez Vera',
  pair2_player1_name: 'Vega Cano Ortin', pair2_player2_name: 'Carla Aguila Tello',
  status: 'scheduled',
};

function makeSupabase() {
  const statusUpdate = vi.fn(() => ({ eq: () => ({ eq: async () => ({ error: null }) }) }));
  const supabase: any = {
    from: vi.fn((table: string) => {
      if (table === 'matches') {
        return {
          select: () => ({ eq: () => ({ then: (r: any) => r({ data: [CANDIDATE], error: null }) }) }),
          update: statusUpdate,
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
    _statusUpdate: statusUpdate,
  };
  return supabase;
}

function baseSpies() {
  vi.spyOn(client, 'fetchResultsFeed').mockResolvedValue([LIVE_ROW as any]);
  vi.spyOn(cache, 'discoverWebtugaTournaments').mockResolvedValue([
    { tournamentId: 't1', baseUrl: 'https://x.win.webtuga.net' },
  ]);
  vi.spyOn(cache, 'loadMatchCache').mockResolvedValue(new Map());
  vi.spyOn(cache, 'upsertMatchCache').mockResolvedValue();
  vi.spyOn(cache, 'writeLastState').mockResolvedValue();
}

const logger = { info() {}, warn() {} } as any;

describe('runWebtugaLiveFetcher', () => {
  beforeEach(() => {
    applyDiff.mockReset();
    applyDiff.mockResolvedValue(undefined);
    vi.restoreAllMocks();
  });

  it('first tick: resolves, writes cache, flips status, applyDiff runs (prev=null no-op inside)', async () => {
    baseSpies();
    const upsert = vi.spyOn(cache, 'upsertMatchCache').mockResolvedValue();
    const writeLast = vi.spyOn(cache, 'writeLastState').mockResolvedValue();
    const supabase = makeSupabase();

    const res = await runWebtugaLiveFetcher(
      { supabase, httpClient: {} as any, logger },
      { dryRun: false },
    );

    expect(res.resolved).toBe(1);
    expect(res.applied).toBe(1);
    expect(res.errors).toBe(0);
    expect(upsert).toHaveBeenCalled();
    expect(supabase._statusUpdate).toHaveBeenCalled();
    expect(applyDiff).toHaveBeenCalledTimes(1);
    expect(writeLast).toHaveBeenCalled();
  });

  it('dryRun: does not call applyDiff or status update', async () => {
    baseSpies();
    const supabase = makeSupabase();

    const res = await runWebtugaLiveFetcher(
      { supabase, httpClient: {} as any, logger },
      { dryRun: true },
    );

    expect(res.resolved).toBe(1);
    expect(res.applied).toBe(0);
    expect(applyDiff).not.toHaveBeenCalled();
    expect(supabase._statusUpdate).not.toHaveBeenCalled();
  });

  it('an error processing one row is caught + counted, never thrown', async () => {
    baseSpies();
    applyDiff.mockRejectedValueOnce(new Error('boom'));
    const supabase = makeSupabase();

    const res = await runWebtugaLiveFetcher(
      { supabase, httpClient: {} as any, logger },
      { dryRun: false },
    );

    expect(res.errors).toBe(1);
    expect(res.applied).toBe(0);
    expect(res.resolved).toBe(1); // still resolved, just failed to write
  });
});

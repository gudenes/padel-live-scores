const writeProgress = vi.hoisted(() => vi.fn(async () => null));
vi.mock('../../lib/puntuate-progress.js', async (orig) => ({...(await orig<any>()), writePuntuateProgress: writeProgress}));
import { describe, it, expect, vi, beforeEach } from 'vitest';

const applyDiff = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../lib/point-reconstruction.js', async (orig) => ({
  ...(await orig<any>()),
  applyDiff,
}));

const notifyLiveTransition = vi.hoisted(() => vi.fn());
vi.mock('../../lib/notify.js', () => ({ notifyLiveTransition }));

import { runPuntuateLiveFetcher } from '../../workers/puntuate-live-fetcher.js';
import * as client from '../../lib/puntuate-client.js';
import * as cache from '../../lib/puntuate-cache.js';

const LIVE_ROW = {
  id: 'sample', date: '2026-10-21', court: 'COURT 1', round: 'Round of 32',
  category: 'women', status: 'Live',
  teamA: 'A. Garcia / C. Sánchez', teamB: 'V. Caño / C. Aguila',
  setsA: [6, 1], setsB: [2, 0], pointsA: '30', pointsB: '15', servingTeam: 1,
};

const CANDIDATE = {
  id: 'uuid-garcia', category: 'women',
  pair1_player1_id: 'p1', pair1_player2_id: 'p2',
  pair2_player1_id: 'p3', pair2_player2_id: 'p4',
  pair1_player1_name: 'Aitana Garcia Roman', pair1_player2_name: 'Cayetana Sanchez Vera',
  pair2_player1_name: 'Vega Cano Ortin', pair2_player2_name: 'Carla Aguila Tello',
  status: 'scheduled',
};

function makeSupabase(opts: { flipped?: boolean } = {}) {
  const flipped = opts.flipped ?? true;
  // .update(...).eq('id',..).eq('status','scheduled').select('id') → affected rows
  const statusUpdate = vi.fn(() => ({
    eq: () => ({
      eq: () => ({
        select: async () => ({
          data: flipped ? [{ id: 'uuid-garcia' }] : [],
          error: null,
        }),
      }),
    }),
  }));
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
  vi.spyOn(cache, 'discoverPuntuateTournaments').mockResolvedValue([
    { tournamentId: 't1', baseUrl: 'https://x.win.puntuate.net' },
  ]);
  vi.spyOn(cache, 'loadMatchCache').mockResolvedValue(new Map());
  vi.spyOn(cache, 'upsertMatchCache').mockResolvedValue();
  vi.spyOn(cache, 'writeLastState').mockResolvedValue();
}

const logger = { info() {}, warn() {} } as any;
const notify = { baseUrl: 'https://x', cronSecret: 'y', logger } as any;

describe('runPuntuateLiveFetcher', () => {
  beforeEach(() => {
    applyDiff.mockReset();
    applyDiff.mockResolvedValue(undefined);
    notifyLiveTransition.mockReset();
    vi.restoreAllMocks();
  });

  it('first tick: resolves, writes cache, flips status, applyDiff runs (prev=null no-op inside)', async () => {
    baseSpies();
    const upsert = vi.spyOn(cache, 'upsertMatchCache').mockResolvedValue();
    const writeLast = vi.spyOn(cache, 'writeLastState').mockResolvedValue();
    const supabase = makeSupabase();

    const res = await runPuntuateLiveFetcher(
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

    const res = await runPuntuateLiveFetcher(
      { supabase, httpClient: {} as any, logger },
      { dryRun: true },
    );

    expect(res.resolved).toBe(1);
    expect(res.applied).toBe(0);
    expect(cache.upsertMatchCache).not.toHaveBeenCalled();
    expect(cache.writeLastState).not.toHaveBeenCalled();
    expect(applyDiff).not.toHaveBeenCalled();
    expect(supabase._statusUpdate).not.toHaveBeenCalled();
  });

  it('fires notifyLiveTransition once on a genuine scheduled→live flip', async () => {
    baseSpies();
    const supabase = makeSupabase({ flipped: true });

    await runPuntuateLiveFetcher(
      { supabase, httpClient: {} as any, logger, notify },
      { dryRun: false },
    );

    expect(notifyLiveTransition).toHaveBeenCalledTimes(1);
    expect(notifyLiveTransition).toHaveBeenCalledWith('uuid-garcia', notify);
  });

  it('does NOT fire notify when the row did not flip (already live/finished)', async () => {
    baseSpies();
    const supabase = makeSupabase({ flipped: false });

    await runPuntuateLiveFetcher(
      { supabase, httpClient: {} as any, logger, notify },
      { dryRun: false },
    );

    expect(notifyLiveTransition).not.toHaveBeenCalled();
  });

  it('does NOT fire notify in dryRun mode', async () => {
    baseSpies();
    const supabase = makeSupabase({ flipped: true });

    await runPuntuateLiveFetcher(
      { supabase, httpClient: {} as any, logger, notify },
      { dryRun: true },
    );

    expect(notifyLiveTransition).not.toHaveBeenCalled();
  });

  it('does NOT fire notify when deps.notify is undefined, and does not throw', async () => {
    baseSpies();
    const supabase = makeSupabase({ flipped: true });

    const res = await runPuntuateLiveFetcher(
      { supabase, httpClient: {} as any, logger },
      { dryRun: false },
    );

    expect(notifyLiveTransition).not.toHaveBeenCalled();
    expect(res.errors).toBe(0);
    expect(res.applied).toBe(1);
  });

  it('an error processing one row is caught + counted, never thrown', async () => {
    baseSpies();
    applyDiff.mockRejectedValueOnce(new Error('boom'));
    const supabase = makeSupabase();

    const res = await runPuntuateLiveFetcher(
      { supabase, httpClient: {} as any, logger },
      { dryRun: false },
    );

    expect(res.errors).toBe(1);
    expect(res.applied).toBe(0);
    expect(res.resolved).toBe(1); // still resolved, just failed to write
  });
});

beforeEach(() => { vi.restoreAllMocks(); applyDiff.mockReset(); notifyLiveTransition.mockReset(); });
it('validates malformed points even in dry run', async () => {
  baseSpies();
  vi.spyOn(client, 'fetchResultsFeed').mockResolvedValue([{ ...LIVE_ROW, pointsA: '?' } as any]);
  const result = await runPuntuateLiveFetcher({ supabase: makeSupabase(), httpClient: {} as any, logger }, { dryRun: true });
  expect(result.errors).toBe(1);
});
it('does not write finished or absent live rows', async () => {
  baseSpies();
  vi.spyOn(client, 'fetchResultsFeed').mockResolvedValue([{ ...LIVE_ROW, status: 'Finished' } as any]);
  const result = await runPuntuateLiveFetcher({ supabase: makeSupabase(), httpClient: {} as any, logger }, { dryRun: false });
  expect(result.applied).toBe(0);
  expect(cache.upsertMatchCache).not.toHaveBeenCalled();
});

it('revalidates cached matches and skips terminal candidates', async () => {
  baseSpies();
  vi.spyOn(cache, 'loadMatchCache').mockResolvedValue(new Map([['uuid-garcia', { matchId: 'uuid-garcia', orientation: 'AB', lastState: null }]]));
  const db = makeSupabase();
  const original = CANDIDATE.status;
  CANDIDATE.status = 'finished';
  try {
    const result = await runPuntuateLiveFetcher({ supabase: db, httpClient: {} as any, logger }, { dryRun: false });
    expect(result.unresolved).toBe(1);
    expect(applyDiff).not.toHaveBeenCalled();
    expect(cache.writeLastState).not.toHaveBeenCalled();
  } finally { CANDIDATE.status = original; }
});

it('retains persisted state for restart continuity', async () => {
  baseSpies();
  const lastState: any = { matchId: 'uuid-garcia', team1Sets: [{ games: 6, tiebreak: null }, { games: 1, tiebreak: null }], team2Sets: [{ games: 2, tiebreak: null }, { games: 0, tiebreak: null }], pointState: { kind: 'regular', team1: 15, team2: 15 }, servingTeam: 1, status: 'live', matchWidgetId: 'sample' };
  vi.spyOn(cache, 'loadMatchCache').mockResolvedValue(new Map([['uuid-garcia', { matchId: 'uuid-garcia', orientation: 'AB', lastState }]]));
  const result = await runPuntuateLiveFetcher({ supabase: makeSupabase(), httpClient: {} as any, logger }, { dryRun: false });
  expect(result.applied).toBe(1);
  expect(applyDiff.mock.calls[0]?.[2]).toEqual(lastState);
  expect(cache.writeLastState).toHaveBeenCalledWith(expect.anything(), 't1', 'uuid-garcia', 'AB', expect.anything());
});

it('marks scoreless live presence and notifies without inventing scores', async () => {
  baseSpies();
  vi.spyOn(client, 'fetchResultsFeed').mockResolvedValue([{ ...LIVE_ROW, setsA: [], setsB: [] } as any]);
  const db = makeSupabase();
  const result = await runPuntuateLiveFetcher({ supabase: db, httpClient: {} as any, logger, notify }, { dryRun: false });
  expect(result).toMatchObject({ liveSeen: 1, resolved: 1, applied: 1, errors: 0 });
  expect(db._statusUpdate).toHaveBeenCalled();
  expect(notifyLiveTransition).toHaveBeenCalledWith('uuid-garcia', notify);
  expect(applyDiff).not.toHaveBeenCalled();
  expect(cache.writeLastState).not.toHaveBeenCalled();
});
it('does not renotify already-live scoreless matches or overwrite cached scores', async () => {
  baseSpies();
  const lastState: any = { matchId: 'uuid-garcia', team1Sets: [{ games: 3 }], team2Sets: [{ games: 2 }] };
  vi.spyOn(cache, 'loadMatchCache').mockResolvedValue(new Map([['uuid-garcia', { matchId: 'uuid-garcia', orientation: 'AB', lastState }]]));
  vi.spyOn(client, 'fetchResultsFeed').mockResolvedValue([{ ...LIVE_ROW, setsA: [], setsB: [] } as any]);
  await runPuntuateLiveFetcher({ supabase: makeSupabase({ flipped: false }), httpClient: {} as any, logger, notify }, { dryRun: false });
  expect(notifyLiveTransition).not.toHaveBeenCalled();
  expect(cache.upsertMatchCache).toHaveBeenCalledWith(expect.anything(), 't1', 'uuid-garcia', 'uuid-garcia', 'AB', lastState);
  expect(cache.writeLastState).not.toHaveBeenCalled();
  expect(applyDiff).not.toHaveBeenCalled();
});
it('keeps scoreless live dry-run read-only', async () => {
  baseSpies();
  vi.spyOn(client, 'fetchResultsFeed').mockResolvedValue([{ ...LIVE_ROW, setsA: [], setsB: [] } as any]);
  const db = makeSupabase();
  const result = await runPuntuateLiveFetcher({ supabase: db, httpClient: {} as any, logger, notify }, { dryRun: true });
  expect(result).toMatchObject({ liveSeen: 1, resolved: 1, errors: 0, applied: 0 });
  expect(db._statusUpdate).not.toHaveBeenCalled();
  expect(cache.upsertMatchCache).not.toHaveBeenCalled();
  expect(notifyLiveTransition).not.toHaveBeenCalled();
});

it('closes a decisive finished card without point labels or live notification', async () => {
 baseSpies(); writeProgress.mockClear(); notifyLiveTransition.mockClear(); applyDiff.mockClear();
 vi.spyOn(client,'fetchResultsFeed').mockResolvedValue([{...LIVE_ROW,status:'Finished',setsA:[6,7],setsB:[2,5],pointsA:'',pointsB:''} as any]);
 const res=await runPuntuateLiveFetcher({supabase:makeSupabase(),httpClient:{} as any,logger,notify},{dryRun:false});
 expect(res.errors).toBe(0);expect(res.applied).toBe(1);expect(writeProgress).toHaveBeenCalledOnce();
 expect(applyDiff).not.toHaveBeenCalled();expect(notifyLiveTransition).not.toHaveBeenCalled();
});
it('does not infer a final from an incomplete third set', async () => {
 baseSpies();writeProgress.mockClear();
 vi.spyOn(client,'fetchResultsFeed').mockResolvedValue([{...LIVE_ROW,status:'Finished',setsA:[6,3,5],setsB:[2,6,3]} as any]);
 const res=await runPuntuateLiveFetcher({supabase:makeSupabase(),httpClient:{} as any,logger},{dryRun:false});
 expect(res.applied).toBe(0);expect(writeProgress).not.toHaveBeenCalled();
});

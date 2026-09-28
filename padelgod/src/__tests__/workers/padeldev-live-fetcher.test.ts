import { describe, it, expect, vi, beforeEach } from 'vitest';

const applyDiff = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../lib/point-reconstruction.js', async (orig) => ({
  ...(await orig<any>()),
  applyDiff,
}));

const notifyLiveTransition = vi.hoisted(() => vi.fn());
vi.mock('../../lib/notify.js', () => ({ notifyLiveTransition }));

import { runPadeldevLiveFetcher } from '../../workers/padeldev-live-fetcher.js';
import * as client from '../../lib/padeldev-client.js';
import * as cache from '../../lib/padeldev-cache.js';

const ENTRY = {
  url: 'https://feed/?id=vcfqri.json',
  idlocal: 0, idwatch: 0,
  category: 'Women - Round of 32',
  scheduled: '20260923173000000',
  playername1: 'S. Merah', nationality1: 'FR',
  playername2: 'C. Soubrie', nationality2: 'FR',
  playername3: 'G. Rosi', nationality3: 'IT',
  playername4: 'M. Delgado', nationality4: 'ES',
  isfinished: 0, winningteam: 0, retiredteam: 0,
  score: '30-40 1/0 3/6 0/0 0/0',
};

const FEED = { tournament: { '20260923': { 'Piste 2': [ENTRY] } } };

function matchFeed(lastupdate: number) {
  return {
    id_match: 1, idmatch: 'VCFQRI',
    playername1: 'S. Merah', playername2: 'C. Soubrie',
    playername3: 'G. Rosi', playername4: 'M. Delgado',
    isfinished: 0, winningteam: 0, retiredteam: 0,
    court: 'Piste 2', lastupdate,
    score: {
      teamserving: 1, playerserving: 1, winningteam: 0, retiredteam: 0,
      value: '30-40 1/0 3/6 0/0 0/0', starpoint: 0,
      extratop: null, extrabottom: null,
    },
  };
}

const CANDIDATE = {
  id: 'uuid-merah', category: 'women',
  pair1_player1_id: 'p1', pair1_player2_id: 'p2',
  pair2_player1_id: 'p3', pair2_player2_id: 'p4',
  pair1_player1_name: 'Sarah Merah', pair1_player2_name: 'Celine Soubrie',
  pair2_player1_name: 'Marta Delgado Medina', pair2_player2_name: 'Giulia Rosi',
};

function makeSupabase(opts: { flipped?: boolean } = {}) {
  const flipped = opts.flipped ?? true;
  const statusUpdate = vi.fn(() => ({
    eq: () => ({
      eq: () => ({
        select: async () => ({ data: flipped ? [{ id: 'uuid-merah' }] : [], error: null }),
      }),
    }),
  }));
  return {
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
  } as any;
}

function deps(supabase: any) {
  return {
    supabase,
    httpClient: {} as any,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    notify: { baseUrl: 'https://x', secret: 's' } as any,
  };
}

function baseSpies(lastupdate = 111) {
  vi.spyOn(client, 'fetchTournamentFeed').mockResolvedValue(FEED as any);
  vi.spyOn(client, 'fetchMatchFeed').mockResolvedValue(matchFeed(lastupdate) as any);
  vi.spyOn(cache, 'discoverPadeldevTournaments').mockResolvedValue([
    { tournamentId: 't1', key: 'key-uuid' },
  ]);
  vi.spyOn(cache, 'loadMatchCache').mockResolvedValue(new Map());
  vi.spyOn(cache, 'upsertMatchCache').mockResolvedValue();
  vi.spyOn(cache, 'writeLastState').mockResolvedValue();
}

beforeEach(() => {
  vi.restoreAllMocks();
  applyDiff.mockClear();
  notifyLiveTransition.mockClear();
});

describe('runPadeldevLiveFetcher', () => {
  it('resolves, applies, flips status and notifies once', async () => {
    baseSpies();
    const sb = makeSupabase();
    const res = await runPadeldevLiveFetcher(deps(sb), { dryRun: false });
    expect(res.resolved).toBe(1);
    expect(res.applied).toBe(1);
    expect(res.unresolved).toBe(0);
    expect(res.ambiguous).toBe(0);
    expect(applyDiff).toHaveBeenCalledTimes(1);
    expect(notifyLiveTransition).toHaveBeenCalledTimes(1);
  });

  it('does not notify when the status flip was a no-op', async () => {
    baseSpies();
    const res = await runPadeldevLiveFetcher(deps(makeSupabase({ flipped: false })), { dryRun: false });
    expect(res.applied).toBe(1);
    expect(notifyLiveTransition).not.toHaveBeenCalled();
  });

  it('writes nothing in dry-run but still reports resolution', async () => {
    baseSpies();
    const upsert = vi.spyOn(cache, 'upsertMatchCache');
    const res = await runPadeldevLiveFetcher(deps(makeSupabase()), { dryRun: true });
    expect(res.resolved).toBe(1);
    expect(res.applied).toBe(0);
    expect(applyDiff).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(notifyLiveTransition).not.toHaveBeenCalled();
  });

  it('skips a match whose lastupdate has not moved', async () => {
    baseSpies(111);
    vi.spyOn(cache, 'loadMatchCache').mockResolvedValue(
      new Map([['vcfqri.json', {
        matchId: 'uuid-merah', orientation: 'AB' as const,
        lastState: null, lastUpdate: 111,
      }]]),
    );
    const res = await runPadeldevLiveFetcher(deps(makeSupabase()), { dryRun: false });
    expect(res.unchanged).toBe(1);
    expect(res.applied).toBe(0);
    expect(applyDiff).not.toHaveBeenCalled();
  });

  it('processes a match whose lastupdate HAS moved', async () => {
    baseSpies(222);
    vi.spyOn(cache, 'loadMatchCache').mockResolvedValue(
      new Map([['vcfqri.json', {
        matchId: 'uuid-merah', orientation: 'AB' as const,
        lastState: null, lastUpdate: 111,
      }]]),
    );
    const res = await runPadeldevLiveFetcher(deps(makeSupabase()), { dryRun: false });
    expect(res.unchanged).toBe(0);
    expect(res.applied).toBe(1);
  });

  it('skips not-started matches without fetching their per-match feed', async () => {
    baseSpies();
    const fetchMatch = vi.spyOn(client, 'fetchMatchFeed');
    vi.spyOn(client, 'fetchTournamentFeed').mockResolvedValue({
      tournament: { '20260923': { 'Piste 2': [{ ...ENTRY, score: '0-0 0/0 0/0 0/0 0/0' }] } },
    } as any);
    const res = await runPadeldevLiveFetcher(deps(makeSupabase()), { dryRun: false });
    expect(res.liveSeen).toBe(0);
    expect(fetchMatch).not.toHaveBeenCalled();
  });

  it('isolates a bad match to one row instead of aborting the tick', async () => {
    baseSpies();
    vi.spyOn(client, 'fetchMatchFeed').mockResolvedValue({
      ...matchFeed(999),
      score: { ...matchFeed(999).score, value: 'nonsense' },
    } as any);
    const res = await runPadeldevLiveFetcher(deps(makeSupabase()), { dryRun: false });
    expect(res.errors).toBe(1);
    expect(res.applied).toBe(0);
  });

  it('counts an unresolved match without writing', async () => {
    baseSpies();
    vi.spyOn(client, 'fetchTournamentFeed').mockResolvedValue({
      tournament: { '20260923': { 'Piste 2': [{
        ...ENTRY,
        playername1: 'X. Nobody', playername2: 'Y. Nobody',
        playername3: 'Z. Nobody', playername4: 'W. Nobody',
      }] } },
    } as any);
    const res = await runPadeldevLiveFetcher(deps(makeSupabase()), { dryRun: false });
    expect(res.unresolved).toBe(1);
    expect(res.applied).toBe(0);
    expect(applyDiff).not.toHaveBeenCalled();
  });
});

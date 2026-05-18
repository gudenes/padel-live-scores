import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPlayerRankings } from '../../workers/player-rankings.js';

// vi.mock must be hoisted before ESM imports so that vi.spyOn inside test
// bodies can override captureException (ESM namespace is not configurable
// without a hoisted mock factory).
vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
  init: vi.fn(),
  setTag: vi.fn(),
  withScope: vi.fn((_scope: unknown, cb: () => void) => cb()),
}));

// ── HTTP mock ────────────────────────────────────────────────────────────
//
// Padelgod workers receive an injected `httpClient` (axios instance). For
// the rankings worker we mock GET on two endpoints:
//   1. /wp-json/fip/v1/ranking/load-more/        — official rankings
//   2. /wp-json/fip/v1/player/search?search_type=race — race rankings
//
// Tests configure per-URL responses via setHttpResponses().

interface MockedResponse {
  status: number;
  data: unknown;
}

const httpResponses = new Map<string, MockedResponse>();

function setHttpResponse(urlSubstring: string, data: unknown, status = 200) {
  httpResponses.set(urlSubstring, { status, data });
}

function makeHttpClient() {
  return {
    get: vi.fn(async (url: string) => {
      for (const [substring, response] of httpResponses.entries()) {
        if (url.includes(substring)) {
          return response;
        }
      }
      throw new Error(`MOCK: no response configured for URL: ${url}`);
    }),
  } as any;
}

// ── FIP row builders ─────────────────────────────────────────────────────

interface FipOfficialRow {
  player_id: string;
  name: string;
  surname: string;
  rank: number;
  points: number;
  move: number;
  url: string;
  thumbnail: string;
  country_name: string;
  country_flag: string;
}

interface FipRaceRow {
  player_id: string;
  name: string;
  surname: string;
  race_rank: number;
  race_points: number;
  race_move: number;
  url: string;
  thumbnail: string;
  country_name: string;
  country_flag: string;
}

function officialRow(overrides: Partial<FipOfficialRow> & { player_id: string; rank: number }): FipOfficialRow {
  return {
    player_id: overrides.player_id,
    name: overrides.name ?? 'Player',
    surname: overrides.surname ?? overrides.player_id,
    rank: overrides.rank,
    points: overrides.points ?? 1000 - overrides.rank,
    move: overrides.move ?? 0,
    url: overrides.url ?? `https://www.padelfip.com/player/${overrides.player_id.toLowerCase()}/`,
    thumbnail: overrides.thumbnail ?? `https://www.padelfip.com/wp-content/uploads/${overrides.player_id}.png`,
    country_name: overrides.country_name ?? 'ESP',
    country_flag: overrides.country_flag ?? '',
  };
}

function raceRow(overrides: Partial<FipRaceRow> & { player_id: string; race_rank: number }): FipRaceRow {
  return {
    player_id: overrides.player_id,
    name: overrides.name ?? 'Player',
    surname: overrides.surname ?? overrides.player_id,
    race_rank: overrides.race_rank,
    race_points: overrides.race_points ?? 500 - overrides.race_rank,
    race_move: overrides.race_move ?? 0,
    url: overrides.url ?? `https://www.padelfip.com/player/${overrides.player_id.toLowerCase()}/`,
    thumbnail: overrides.thumbnail ?? `https://www.padelfip.com/wp-content/uploads/${overrides.player_id}.png`,
    country_name: overrides.country_name ?? 'ARG',
    country_flag: overrides.country_flag ?? '',
  };
}

// ── Supabase mock ────────────────────────────────────────────────────────
//
// Captures all `players` reads/writes + `player_ranking_snapshots` writes +
// `padelgod.scrape_jobs` writes. Returns deterministic UUIDs for inserted
// players so snapshot rows can be cross-referenced.
//
// playersTable is the in-memory state. Tests can seed it via the
// `seedPlayer()` helper before invoking runPlayerRankings.

interface PlayerRow {
  id: string;
  fip_id: string | null;
  name: string;
  country: string | null;
  category: 'men' | 'women';
  ranking: number | null;
  points: number | null;
  ranking_move: number | null;
  race_ranking: number | null;
  race_points: number | null;
  race_move: number | null;
  avatar_url: string | null;
  profile_url: string | null;
  last_updated_by: string | null;
}

interface SnapshotRow {
  player_id: string;
  type: 'official' | 'race';
  gender: 'men' | 'women';
  year: number;
  week: number;
  ranking_date: string;
  ranking: number;
  points: number | null;
  ranking_move: number | null;
  source: string;
}

interface ScrapeJobRow {
  id: string;
  job_type: string;
  target_url: string;
  status: 'running' | 'success' | 'failed';
  parser_version: string;
  error_message: string | null;
}

interface FakeSupabaseState {
  players: PlayerRow[];
  snapshots: SnapshotRow[];
  scrapeJobs: ScrapeJobRow[];
  storageUploads: Array<{ bucket: string; path: string }>;
}

let state: FakeSupabaseState;

function freshState(): FakeSupabaseState {
  return { players: [], snapshots: [], scrapeJobs: [], storageUploads: [] };
}

function seedPlayer(p: Partial<PlayerRow> & { id: string; fip_id: string; category: 'men' | 'women' }) {
  state.players.push({
    id: p.id,
    fip_id: p.fip_id,
    name: p.name ?? 'Seeded Player',
    country: p.country ?? null,
    category: p.category,
    ranking: p.ranking ?? null,
    points: p.points ?? null,
    ranking_move: p.ranking_move ?? null,
    race_ranking: p.race_ranking ?? null,
    race_points: p.race_points ?? null,
    race_move: p.race_move ?? null,
    avatar_url: p.avatar_url ?? null,
    profile_url: p.profile_url ?? null,
    last_updated_by: p.last_updated_by ?? null,
  });
}

let nextUuidCounter = 0;
function nextUuid(): string {
  nextUuidCounter += 1;
  return `00000000-0000-0000-0000-${nextUuidCounter.toString().padStart(12, '0')}`;
}

function makeSupabase() {
  // Builder pattern mimicking @supabase/supabase-js's PostgrestQueryBuilder.
  // Each .from(...) call returns a queryShape that accumulates filter
  // conditions and is itself a thenable, so `await chain` resolves to
  // { data, error } applying all accumulated filters.
  function fromTable(table: string) {
    const filters: Array<(row: any) => boolean> = [];

    const queryShape: any = {
      schema: (_s: string) => fromTable(table),
      select: vi.fn(function (_cols?: string) {
        return queryShape;
      }),
      insert: vi.fn(function (row: any) {
        if (table === 'scrape_jobs') {
          const sj: ScrapeJobRow = {
            id: nextUuid(),
            job_type: row.job_type,
            target_url: row.target_url,
            status: 'running',
            parser_version: row.parser_version,
            error_message: null,
          };
          state.scrapeJobs.push(sj);
          return {
            select: () => ({ single: async () => ({ data: sj, error: null }) }),
          };
        }
        if (table === 'players') {
          const inserted: PlayerRow = {
            id: nextUuid(),
            fip_id: row.fip_id ?? null,
            name: row.name,
            country: row.country ?? null,
            category: row.category,
            ranking: row.ranking ?? null,
            points: row.points ?? null,
            ranking_move: row.ranking_move ?? null,
            race_ranking: row.race_ranking ?? null,
            race_points: row.race_points ?? null,
            race_move: row.race_move ?? null,
            avatar_url: null,
            profile_url: row.profile_url ?? null,
            last_updated_by: row.last_updated_by ?? null,
          };
          state.players.push(inserted);
          return {
            select: () => ({
              single: async () => ({ data: inserted, error: null }),
            }),
          };
        }
        throw new Error(`MOCK: insert on unknown table ${table}`);
      }),
      upsert: vi.fn(async function (rows: any, _opts: any) {
        if (table === 'player_ranking_snapshots') {
          const arr = Array.isArray(rows) ? rows : [rows];
          for (const r of arr) {
            // Replace any existing matching row (mimic onConflict)
            const idx = state.snapshots.findIndex(
              s =>
                s.player_id === r.player_id &&
                s.type === r.type &&
                s.year === r.year &&
                s.week === r.week,
            );
            if (idx >= 0) state.snapshots[idx] = r;
            else state.snapshots.push(r);
          }
          return { error: null };
        }
        throw new Error(`MOCK: upsert on unknown table ${table}`);
      }),
      update: vi.fn(function (patch: any) {
        return {
          eq: async (col: string, val: any) => {
            if (table === 'scrape_jobs') {
              const row = state.scrapeJobs.find(s => s.id === val);
              if (row) {
                row.status = patch.status;
                row.error_message = patch.error_message ?? null;
              }
              return { error: null };
            }
            if (table === 'players') {
              const row = state.players.find(p => p.id === val);
              if (row) Object.assign(row, patch);
              return { error: null };
            }
            return { error: null };
          },
          in: async (col: string, vals: any[]) => {
            if (table === 'players') {
              for (const v of vals) {
                const row = state.players.find(p => p.id === v);
                if (row) Object.assign(row, patch);
              }
              return { error: null };
            }
            return { error: null };
          },
        };
      }),
      in: vi.fn(function (col: string, vals: any[]) {
        if (table === 'players') {
          const data = state.players.filter(
            p => vals.includes((p as any)[col]) && filters.every(f => f(p)),
          );
          return Promise.resolve({ data, error: null });
        }
        return Promise.resolve({ data: [], error: null });
      }),
      eq: vi.fn(function (col: string, val: any) {
        filters.push(row => row[col] === val);
        return queryShape;
      }),
      not: vi.fn(function (col: string, op: string, val: any) {
        // 'is' + null → "is not null"
        if (op === 'is' && val === null) {
          filters.push(row => row[col] != null);
        }
        return queryShape;
      }),
      maybeSingle: vi.fn(async () => {
        if (table === 'players') {
          const row = state.players.find(p => filters.every(f => f(p)));
          return { data: row ?? null, error: null };
        }
        return { data: null, error: null };
      }),
      // CRITICAL: make queryShape itself a thenable so `await chain` works
      then: (resolve: (v: any) => void) => {
        if (table === 'players') {
          const data = state.players.filter(p => filters.every(f => f(p)));
          resolve({ data, error: null });
          return;
        }
        resolve({ data: [], error: null });
      },
    };

    return queryShape;
  }

  return {
    from: vi.fn((table: string) => fromTable(table)),
    schema: vi.fn(() => ({ from: (table: string) => fromTable(table) })),
    storage: {
      from: () => ({
        upload: async (path: string) => {
          state.storageUploads.push({ bucket: 'avatars', path });
          return { error: null };
        },
      }),
      createBucket: async () => ({ error: null }),
    },
  } as any;
}

// ── Test bootstrap ───────────────────────────────────────────────────────

beforeEach(() => {
  state = freshState();
  httpResponses.clear();
  nextUuidCounter = 0;
  // Re-mock global fetch (avatar-rehost uses it). Default to skip-already-hosted
  // by short-circuiting on the storage marker.
  vi.stubGlobal('fetch', vi.fn(async () => {
    return new Response(new ArrayBuffer(8), { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
  }));
});

// ── Helpers re-exported for use in test cases (subsequent tasks) ─────────

export { setHttpResponse, makeHttpClient, makeSupabase, officialRow, raceRow, seedPlayer, state };

// Placeholder describe — test cases land here task-by-task.
describe('runPlayerRankings (WP JSON API rewrite)', () => {
  it('happy path: all 4 phases populated, mixed existing + new players', async () => {
    // Seed: one existing men's player, one existing women's player.
    seedPlayer({ id: 'aaaa1111-0000-0000-0000-000000000001', fip_id: 'P000001', category: 'men', name: 'Old Name', ranking: 99, points: 100 });
    seedPlayer({ id: 'bbbb2222-0000-0000-0000-000000000002', fip_id: 'P000002', category: 'women', name: 'Old Name W', ranking: 99, points: 100 });

    // Official men: 1 existing (P000001) + 1 new (P000003)
    setHttpResponse('search_type=race&gender=male', [
      raceRow({ player_id: 'P000001', race_rank: 1, race_points: 500, race_move: 0 }),
    ]);
    setHttpResponse('search_type=race&gender=female', [
      raceRow({ player_id: 'P000002', race_rank: 1, race_points: 500, race_move: 0 }),
    ]);
    setHttpResponse('gender=male&limit', [
      officialRow({ player_id: 'P000001', rank: 1, points: 21000 }),
      officialRow({ player_id: 'P000003', rank: 2, points: 20000 }),
    ]);
    setHttpResponse('gender=female&limit', [
      officialRow({ player_id: 'P000002', rank: 1, points: 18000 }),
    ]);

    const httpClient = makeHttpClient();
    const supabase = makeSupabase();
    const result = await runPlayerRankings({ supabase, httpClient });

    // scrape_jobs: 4 rows, all success
    expect(state.scrapeJobs).toHaveLength(4);
    expect(state.scrapeJobs.every(s => s.status === 'success')).toBe(true);
    const urls = state.scrapeJobs.map(s => s.target_url);
    expect(urls.some(u => u.includes('ranking/load-more') && u.includes('gender=male'))).toBe(true);
    expect(urls.some(u => u.includes('ranking/load-more') && u.includes('gender=female'))).toBe(true);
    expect(urls.some(u => u.includes('search_type=race') && u.includes('gender=male'))).toBe(true);
    expect(urls.some(u => u.includes('search_type=race') && u.includes('gender=female'))).toBe(true);

    // Existing player updated, not duplicated
    const p1 = state.players.find(p => p.fip_id === 'P000001')!;
    expect(state.players.filter(p => p.fip_id === 'P000001')).toHaveLength(1);
    expect(p1.ranking).toBe(1);
    expect(p1.points).toBe(21000);
    expect(p1.last_updated_by).toBe('padelgod');

    // New player inserted with fip_id
    const p3 = state.players.find(p => p.fip_id === 'P000003')!;
    expect(p3).toBeDefined();
    expect(p3.category).toBe('men');
    expect(p3.ranking).toBe(2);

    // Snapshots: 3 official + 2 race = 5 rows tagged 'padelgod-fip'
    expect(state.snapshots).toHaveLength(5);
    expect(state.snapshots.every(s => s.source === 'padelgod-fip')).toBe(true);
    expect(state.snapshots.filter(s => s.type === 'official')).toHaveLength(3);
    expect(state.snapshots.filter(s => s.type === 'race')).toHaveLength(2);

    // Result shape
    expect(result.official.men.fetched).toBe(2);
    expect(result.official.women.fetched).toBe(1);
    expect(result.race.men.fetched).toBe(1);
    expect(result.race.women.fetched).toBe(1);
    expect(result.snapshotsWritten).toBe(5);
  });

  it('official current week empty, falls back to a prior week with data', async () => {
    // Configure the men's official endpoint to return [] for the CURRENT week
    // and data for the previous week. The URL substring matching only sees
    // gender — we differentiate by week via a custom handler.
    const httpClient = {
      get: vi.fn(async (url: string) => {
        const weekMatch = url.match(/week=(\d+)/);
        const week = weekMatch ? parseInt(weekMatch[1], 10) : 0;
        const currentWeek = (() => {
          const now = new Date();
          const start = new Date(now.getFullYear(), 0, 1);
          return Math.ceil(((now.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7);
        })();
        if (url.includes('gender=male') && url.includes('ranking/load-more')) {
          if (week === currentWeek) return { status: 200, data: [] };
          return { status: 200, data: [officialRow({ player_id: 'P000001', rank: 1 })] };
        }
        if (url.includes('gender=female') && url.includes('ranking/load-more')) {
          return { status: 200, data: [officialRow({ player_id: 'P000002', rank: 1 })] };
        }
        if (url.includes('search_type=race') && url.includes('gender=male')) {
          return { status: 200, data: [raceRow({ player_id: 'P000001', race_rank: 1 })] };
        }
        if (url.includes('search_type=race') && url.includes('gender=female')) {
          return { status: 200, data: [raceRow({ player_id: 'P000002', race_rank: 1 })] };
        }
        return { status: 200, data: [] };
      }),
    } as any;

    const supabase = makeSupabase();
    const result = await runPlayerRankings({ supabase, httpClient });

    // Men fetched from fallback week, women from current week
    expect(result.official.men.fetched).toBe(1);
    expect(result.official.women.fetched).toBe(1);
    // No PARSED_ZERO_ROWS thrown (the fallback succeeded)
    expect(state.scrapeJobs.filter(s => s.status === 'failed')).toHaveLength(0);
  });

  it('official all 3 fallback weeks empty: throws PARSED_ZERO_ROWS + Sentry capture', async () => {
    const sentrySpy = vi.spyOn(await import('@sentry/node'), 'captureException').mockImplementation(() => 'event-id');

    const httpClient = {
      get: vi.fn(async (url: string) => {
        // Men's official: empty for all 4 attempted weeks
        if (url.includes('gender=male') && url.includes('ranking/load-more')) {
          return { status: 200, data: [] };
        }
        return { status: 200, data: [] };
      }),
    } as any;

    const supabase = makeSupabase();
    await expect(runPlayerRankings({ supabase, httpClient })).rejects.toThrow(/PARSED_ZERO_ROWS/);

    // First failing scrape_jobs row is official-male
    const failed = state.scrapeJobs.filter(s => s.status === 'failed');
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0].target_url).toContain('gender=male');
    expect(failed[0].error_message).toContain('PARSED_ZERO_ROWS');

    // Sentry was called with the right tags
    expect(sentrySpy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ worker: 'player-rankings', phase: 'official-male' }) }),
    );

    sentrySpy.mockRestore();
  });
  it('race response with series boundary trims at 50% halving', async () => {
    // Build a race response that simulates the dual-series concatenation:
    //   Series 1: race_rank 1..100 (Premier-circuit main race)
    //   Series 2: race_rank starts at 17 (sub-tier, reset numbering)
    // Boundary should be detected at the first row where race_rank < max/2.
    const series1: ReturnType<typeof raceRow>[] = [];
    for (let r = 1; r <= 100; r++) series1.push(raceRow({ player_id: `P${(1000 + r).toString().padStart(6, '0')}`, race_rank: r }));
    const series2: ReturnType<typeof raceRow>[] = [];
    for (let r = 17; r <= 30; r++) series2.push(raceRow({ player_id: `P${(2000 + r).toString().padStart(6, '0')}`, race_rank: r }));

    setHttpResponse('search_type=race&gender=male', [...series1, ...series2]);
    setHttpResponse('search_type=race&gender=female', [raceRow({ player_id: 'P000002', race_rank: 1 })]);
    setHttpResponse('gender=male&limit', [officialRow({ player_id: 'P001001', rank: 1 })]);
    setHttpResponse('gender=female&limit', [officialRow({ player_id: 'P000002', rank: 1 })]);

    const supabase = makeSupabase();
    const result = await runPlayerRankings({ supabase, httpClient: makeHttpClient() });

    // Series 1 has 100 rows, series 2 starts at rank=17 which is < 100/2.
    // Trim should cut at the boundary, keeping exactly 100 rows from men's race.
    expect(result.race.men.fetched).toBe(100);
    // Snapshots: 100 race-men + 1 race-women + 1 official-men + 1 official-women = 103
    expect(state.snapshots.filter(s => s.type === 'race' && s.gender === 'men')).toHaveLength(100);
  });
  it('race dropouts: previously-ranked players not in current run get race fields NULLed', async () => {
    // Seed two men's players with existing race_ranking. Only one shows up
    // in this run's race response; the other should be NULLed.
    seedPlayer({
      id: 'dddd1111-0000-0000-0000-000000000001', fip_id: 'P000010', category: 'men',
      race_ranking: 5, race_points: 100, race_move: 1,
    });
    seedPlayer({
      id: 'dddd1111-0000-0000-0000-000000000002', fip_id: 'P000020', category: 'men',
      race_ranking: 6, race_points: 90, race_move: 0,
    });

    // Only P000010 is in this run's race. P000020 should be NULLed.
    setHttpResponse('search_type=race&gender=male', [
      raceRow({ player_id: 'P000010', race_rank: 5, race_points: 100, race_move: 1 }),
    ]);
    setHttpResponse('search_type=race&gender=female', [raceRow({ player_id: 'P000099', race_rank: 1 })]);
    setHttpResponse('gender=male&limit', [officialRow({ player_id: 'P000010', rank: 50 })]);
    setHttpResponse('gender=female&limit', [officialRow({ player_id: 'P000099', rank: 1 })]);

    const supabase = makeSupabase();
    const result = await runPlayerRankings({ supabase, httpClient: makeHttpClient() });

    // P000010 retained
    const kept = state.players.find(p => p.fip_id === 'P000010')!;
    expect(kept.race_ranking).toBe(5);

    // P000020 NULLed
    const dropped = state.players.find(p => p.fip_id === 'P000020')!;
    expect(dropped.race_ranking).toBeNull();
    expect(dropped.race_points).toBeNull();
    expect(dropped.race_move).toBeNull();

    expect(result.race.men.dropoutsCleared).toBe(1);
  });
  it('race endpoint empty: throws PARSED_ZERO_ROWS + Sentry capture tagged race-male', async () => {
    const sentrySpy = vi.spyOn(await import('@sentry/node'), 'captureException').mockImplementation(() => 'event-id');

    // Official OK, race-men returns [], race-women OK.
    // Race entries registered before official entries so the Map iteration
    // resolves 'search_type=race&gender=male' before 'gender=male&limit'
    // (both substrings match the race URL; first-registered wins).
    setHttpResponse('search_type=race&gender=male', []);
    setHttpResponse('search_type=race&gender=female', [raceRow({ player_id: 'P000002', race_rank: 1 })]);
    setHttpResponse('gender=male&limit', [officialRow({ player_id: 'P000001', rank: 1 })]);
    setHttpResponse('gender=female&limit', [officialRow({ player_id: 'P000002', rank: 1 })]);

    const supabase = makeSupabase();
    await expect(runPlayerRankings({ supabase, httpClient: makeHttpClient() })).rejects.toThrow(/PARSED_ZERO_ROWS/);

    // race-male scrape_job marked failed
    const failed = state.scrapeJobs.find(s => s.target_url.includes('search_type=race') && s.target_url.includes('gender=male'));
    expect(failed?.status).toBe('failed');
    expect(failed?.error_message).toContain('race-male');

    expect(sentrySpy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ worker: 'player-rankings', phase: 'race-male' }) }),
    );

    sentrySpy.mockRestore();
  });
  it.todo('Task 9 — NO_SNAPSHOTS_WRITTEN floor: throws if every phase parsed but every upsert failed');
});

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  runMatchStatsFetcher,
  decomposeWidgetCompositeId,
} from '../../workers/match-stats-fetcher.js';

const FIXTURE_PATH = join(
  __dirname,
  '../fixtures/crionet-match-stats-brussels.html',
);

interface FakeSupabaseOptions {
  /** entity_external_ids rows: { entity_id, external_id } */
  mappings: Array<{ entity_id: string; external_id: string }>;
  /** match ids whose status='finished' */
  finishedMatchIds: string[];
  /** match_stats rows that already exist (per match + source) */
  existingStatsRows?: Array<{ match_id: string; source: string }>;
  /** Simulate PostgREST's URL-length cap: when set, any .in(col, ids) call
   *  with more than this many ids returns an error instead of data.
   *  Real production limit is ~210 UUIDs before Nginx 414s. */
  maxInChunk?: number;
  /** Tournament tier rows. When omitted, the fake serves a single
   *  Premier-tier "default" tournament that all finished matches belong
   *  to — keeps the existing tests valid without rewriting their setup. */
  tournaments?: Array<{ id: string; level: string | null }>;
  /** Map of match_id → tournament_id. When a finished match isn't in
   *  this map, it falls back to the implicit default Premier tournament. */
  matchTournaments?: Record<string, string>;
}

function fakeSupabase(opts: FakeSupabaseOptions) {
  const inserted: { table: string; rows: any[] }[] = [];
  const upserted: any[] = [];
  const existingStatsRows = opts.existingStatsRows ?? [];

  // Public schema ops (matches, match_stats, entity_external_ids)
  const publicFrom = (t: string) => {
    if (t === 'entity_external_ids') {
      return {
        select: () => ({
          eq: (_col1: string, _val1: string) => ({
            eq: async (_col2: string, _val2: string) => ({
              data: opts.mappings,
              error: null,
            }),
          }),
        }),
      };
    }
    if (t === 'matches') {
      return {
        select: () => ({
          in: (_col: string, ids: string[]) => ({
            eq: async (_statusCol: string, status: string) => {
              if (opts.maxInChunk != null && ids.length > opts.maxInChunk) {
                return {
                  data: null,
                  error: {
                    message: `URI Too Long (${ids.length} ids exceeds ${opts.maxInChunk}-id cap)`,
                  },
                };
              }
              if (status !== 'finished') return { data: [], error: null };
              const DEFAULT_TOURNAMENT_ID = 'default-premier-tournament';
              const filtered = ids
                .filter((id) => opts.finishedMatchIds.includes(id))
                .map((id) => ({
                  id,
                  tournament_id: opts.matchTournaments?.[id] ?? DEFAULT_TOURNAMENT_ID,
                }));
              return { data: filtered, error: null };
            },
          }),
        }),
      };
    }
    if (t === 'tournaments') {
      // Awaitable thenable: `await supabase.from('tournaments').select('id, level')`
      const DEFAULT_TOURNAMENTS = [
        { id: 'default-premier-tournament', level: 'p1' },
      ];
      const rows = opts.tournaments ?? DEFAULT_TOURNAMENTS;
      return {
        select: () => ({
          then: (
            resolve: (v: { data: Array<{ id: string; level: string | null }>; error: null }) => void,
          ) => {
            resolve({ data: rows, error: null });
          },
        }),
      };
    }
    if (t === 'match_stats') {
      return {
        select: () => ({
          in: (_col: string, ids: string[]) => ({
            eq: async (_sourceCol: string, sourceVal: string) => {
              if (opts.maxInChunk != null && ids.length > opts.maxInChunk) {
                return {
                  data: null,
                  error: {
                    message: `URI Too Long (${ids.length} ids exceeds ${opts.maxInChunk}-id cap)`,
                  },
                };
              }
              const filtered = existingStatsRows
                .filter(
                  (row) => ids.includes(row.match_id) && row.source === sourceVal,
                )
                .map((row) => ({ match_id: row.match_id }));
              return { data: filtered, error: null };
            },
          }),
        }),
        upsert: async (rows: any, _options: any) => {
          const arr = Array.isArray(rows) ? rows : [rows];
          upserted.push(...arr);
          return { data: arr, error: null };
        },
      };
    }
    return {
      select: () => ({}),
    } as any;
  };

  // Padelgod schema ops (scrape_jobs, raw_payloads) — minimal stubs for runScrapeJob
  const padelgodFrom = (t: string) => {
    if (t === 'scrape_jobs') {
      return {
        insert: (row: any) => ({
          select: () => ({
            single: async () => ({ data: { id: 'job-uuid', ...row }, error: null }),
          }),
        }),
        update: () => ({ eq: async () => ({ data: null, error: null }) }),
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: { id: 'job-uuid' }, error: null }),
                }),
              }),
            }),
          }),
        }),
      };
    }
    if (t === 'raw_payloads') {
      return {
        insert: (row: any) => ({
          select: () => ({
            single: async () => ({ data: { id: 'payload-uuid', ...row }, error: null }),
          }),
        }),
      };
    }
    return {
      insert: () => ({ data: null, error: { message: 'unexpected padelgod table' } }),
    } as any;
  };

  return {
    upserted,
    inserted,
    from: publicFrom,
    schema: (_s: string) => ({ from: padelgodFrom }),
    rpc: vi.fn(async () => ({ data: [], error: null })),
  };
}

describe('decomposeWidgetCompositeId', () => {
  it('parses a real widget composite id', () => {
    const parts = decomposeWidgetCompositeId('FIP-2026-1701:MQ012');
    expect(parts).toEqual({
      tournamentWidgetId: 'FIP-2026-1701',
      matchWidgetId: 'MQ012',
      organization: 'FIP',
      year: '2026',
      tournamentId: '1701',
    });
  });

  it('returns null for synthetic draw ids', () => {
    expect(decomposeWidgetCompositeId('draw:men:main_draw:F:1')).toBeNull();
  });

  it('returns null for malformed composites', () => {
    expect(decomposeWidgetCompositeId('')).toBeNull();
    expect(decomposeWidgetCompositeId('FIP-2026-1701')).toBeNull();
    expect(decomposeWidgetCompositeId(':MQ012')).toBeNull();
    expect(decomposeWidgetCompositeId('FIP-1701:MQ012')).toBeNull();
  });
});

describe('runMatchStatsFetcher', () => {
  it('fetches stats for a finished match without existing match_stats and upserts per-set rows', async () => {
    const matchId = 'match-uuid-1';
    const supabase = fakeSupabase({
      mappings: [{ entity_id: matchId, external_id: 'FIP-2026-1701:MQ012' }],
      finishedMatchIds: [matchId],
    });
    const html = readFileSync(FIXTURE_PATH, 'utf-8');
    const httpClient = {
      post: vi.fn(async () => ({ data: html })),
    };

    const result = await runMatchStatsFetcher({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });

    expect(httpClient.post).toHaveBeenCalledTimes(1);
    // Fixture has 3 tabs (period-0 aggregate, period-1, period-2) → 3 upserted rows
    expect(result.fetched).toBe(1);
    expect(result.rowsUpserted).toBe(3);
    expect(supabase.upserted).toHaveLength(3);
    const setNumbers = supabase.upserted.map((r: any) => r.set_number).sort();
    expect(setNumbers).toEqual([0, 1, 2]);
    // Shape checks on the aggregate row
    const agg = supabase.upserted.find((r: any) => r.set_number === 0);
    expect(agg.source).toBe('crionet_widget');
    expect(agg.source_match_id).toBe('MQ012');
    expect(agg.match_id).toBe(matchId);
    expect(agg.team1_service_games).toBe(7);
    expect(agg.team2_service_games).toBe(6);
    expect(agg.raw_payload.team1.totalPointsWonPct).toBe(29);
    expect(agg.raw_payload.team2.totalPointsWonPct).toBe(71);
  });

  it('writes all schema columns (counts + percentage value/100 pairs) for the aggregate row', async () => {
    // Brussels fixture period-0 (match aggregate). Values cross-referenced from
    // the raw HTML — see the parseCrionetMatchStats test for the source of truth.
    const matchId = 'match-uuid-1';
    const supabase = fakeSupabase({
      mappings: [{ entity_id: matchId, external_id: 'FIP-2026-1701:MQ012' }],
      finishedMatchIds: [matchId],
    });
    const html = readFileSync(FIXTURE_PATH, 'utf-8');
    const httpClient = { post: vi.fn(async () => ({ data: html })) };

    await runMatchStatsFetcher({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });

    const agg = supabase.upserted.find((r: any) => r.set_number === 0);
    expect(agg).toBeDefined();

    // Percentage stats are stored as (value, 100) pairs so the UI's
    // `kind="percentage"` bars render correctly (same convention as
    // /api/match-stats for padelapi-sourced rows).
    expect(agg.team1_first_serve_won).toBe(23);
    expect(agg.team1_first_serve_played).toBe(100);
    expect(agg.team2_first_serve_won).toBe(72);
    expect(agg.team2_first_serve_played).toBe(100);

    expect(agg.team1_second_serve_won).toBe(45);
    expect(agg.team1_second_serve_played).toBe(100);
    expect(agg.team2_second_serve_won).toBe(60);
    expect(agg.team2_second_serve_played).toBe(100);

    expect(agg.team1_first_return_won).toBe(28);
    expect(agg.team1_first_return_played).toBe(100);
    expect(agg.team2_first_return_won).toBe(77);
    expect(agg.team2_first_return_played).toBe(100);

    expect(agg.team1_second_return_won).toBe(40);
    expect(agg.team1_second_return_played).toBe(100);
    expect(agg.team2_second_return_won).toBe(55);
    expect(agg.team2_second_return_played).toBe(100);

    // Match-aggregate-only totals (schema's `_total_/_serve_/_return_points_*`
    // columns are commented "ONLY populated on set_number = 0" in the migration,
    // but Crionet exposes them per-set too — we write them everywhere and let
    // the UI gate by `isMatchTab` for display.)
    expect(agg.team1_total_points_won).toBe(29);
    expect(agg.team1_total_points_played).toBe(100);
    expect(agg.team2_total_points_won).toBe(71);
    expect(agg.team2_total_points_played).toBe(100);

    expect(agg.team1_serve_points_won).toBe(29);
    expect(agg.team1_serve_points_played).toBe(100);
    expect(agg.team1_return_points_won).toBe(29);
    expect(agg.team1_return_points_played).toBe(100);

    // Count-native columns
    expect(agg.team1_service_games).toBe(7);
    expect(agg.team2_service_games).toBe(6);
    expect(agg.team1_return_games).toBe(6);
    expect(agg.team2_return_games).toBe(7);
    expect(agg.team1_longest_streak).toBe(3);
    expect(agg.team2_longest_streak).toBe(13);
  });

  it('writes the same percentage-pair columns to per-set rows too', async () => {
    // Per-set rows (set_number=1/2) also get all 14 fields filled. The UI only
    // displays the middle 6 on per-set tabs but the data lands in DB regardless.
    const matchId = 'match-uuid-1';
    const supabase = fakeSupabase({
      mappings: [{ entity_id: matchId, external_id: 'FIP-2026-1701:MQ012' }],
      finishedMatchIds: [matchId],
    });
    const html = readFileSync(FIXTURE_PATH, 'utf-8');
    const httpClient = { post: vi.fn(async () => ({ data: html })) };

    await runMatchStatsFetcher({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });

    const set1 = supabase.upserted.find((r: any) => r.set_number === 1);
    expect(set1).toBeDefined();
    // Set 1 fields just need to be populated — exact values vary by set but the
    // shape (counts as numbers, percentages paired with 100) must hold.
    expect(set1.team1_first_serve_played).toBe(100);
    expect(set1.team1_second_serve_played).toBe(100);
    expect(set1.team1_first_return_played).toBe(100);
    expect(set1.team1_second_return_played).toBe(100);
    expect(typeof set1.team1_first_serve_won).toBe('number');
    expect(typeof set1.team1_service_games).toBe('number');
  });

  it('skips matches that already have a crionet_widget row', async () => {
    const matchId = 'match-uuid-1';
    const supabase = fakeSupabase({
      mappings: [{ entity_id: matchId, external_id: 'FIP-2026-1701:MQ012' }],
      finishedMatchIds: [matchId],
      existingStatsRows: [{ match_id: matchId, source: 'crionet_widget' }],
    });
    const httpClient = { post: vi.fn() };

    const result = await runMatchStatsFetcher({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });

    expect(httpClient.post).not.toHaveBeenCalled();
    expect(result.fetched).toBe(0);
    expect(result.rowsUpserted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(supabase.upserted).toHaveLength(0);
  });

  it('refreshes matches that only have legacy non-crionet rows (premierpadel, padelapi)', async () => {
    // After Crionet became the canonical stats source, legacy rows from other
    // sources should be overwritten so they pick up the full column coverage.
    const matchId = 'match-uuid-1';
    const supabase = fakeSupabase({
      mappings: [{ entity_id: matchId, external_id: 'FIP-2026-1701:MQ012' }],
      finishedMatchIds: [matchId],
      existingStatsRows: [{ match_id: matchId, source: 'premierpadel' }],
    });
    const html = readFileSync(FIXTURE_PATH, 'utf-8');
    const httpClient = { post: vi.fn(async () => ({ data: html })) };

    const result = await runMatchStatsFetcher({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });

    expect(httpClient.post).toHaveBeenCalledTimes(1);
    expect(result.fetched).toBe(1);
    expect(result.rowsUpserted).toBe(3);
    expect(supabase.upserted[0].source).toBe('crionet_widget');
  });

  it('skips synthetic draw widget ids that are not real match widgets', async () => {
    const matchId = 'draw-match-uuid';
    const supabase = fakeSupabase({
      mappings: [{ entity_id: matchId, external_id: 'draw:men:main_draw:F:1' }],
      finishedMatchIds: [matchId],
    });
    const httpClient = { post: vi.fn() };

    const result = await runMatchStatsFetcher({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });

    expect(httpClient.post).not.toHaveBeenCalled();
    expect(result.fetched).toBe(0);
    expect(result.skipped).toBe(1);
    expect(supabase.upserted).toHaveLength(0);
  });

  // 2026-05-16 BUE-P1 incident root cause: the worker passes every
  // crionet_widget mapping's match_id to a single `.in('id', […])` call.
  // Once the project accumulated >~210 mappings (we had 2041 by 2026-05-16),
  // the PostgREST URL exceeded Nginx's request-line limit and the query
  // failed silently — the worker hadn't recorded a single match_stats row
  // since 2026-05-11. The fake supabase here mimics the URL-length cap;
  // unchunked .in() calls fail. After the fix, the worker must split the
  // filter into safely-sized chunks and still find finished matches.
  // Crionet only publishes match-stats for Premier-tier events (P1/P2/Major/
  // Premier_Mens/Premier_Womens). FIP-tier events (Bronze/Silver/Gold) have
  // entity_external_ids → crionet_widget mappings — the discovery worker
  // writes them whether or not stats will ever be served — but the stats
  // endpoint returns no useful data for them. We must NOT fetch those:
  //   - they burn a HTTP request to Crionet for nothing,
  //   - they consume slots in the 20-match-per-run batch budget, starving
  //     the genuinely eligible Premier matches,
  //   - they pollute scrape_jobs with no-op runs.
  // The fetcher must filter to Premier-tier tournaments before it ever
  // touches Crionet.
  it('only fetches stats for Premier-tier tournaments (P1/P2/Major/Premier_*) — skips FIP-tier', async () => {
    const fixtureHtml = readFileSync(FIXTURE_PATH, 'utf-8');
    const premierMatchId = 'match-premier-uuid';
    const fipBronzeMatchId = 'match-fip-bronze-uuid';
    const fipGoldMatchId = 'match-fip-gold-uuid';

    const supabase = fakeSupabase({
      mappings: [
        { entity_id: premierMatchId, external_id: 'FIP-2026-1701:MQ012' },
        { entity_id: fipBronzeMatchId, external_id: 'FIP-2026-9001:MQ001' },
        { entity_id: fipGoldMatchId, external_id: 'FIP-2026-9002:MQ002' },
      ],
      finishedMatchIds: [premierMatchId, fipBronzeMatchId, fipGoldMatchId],
      tournaments: [
        { id: 't-premier', level: 'p1' },
        { id: 't-fip-bronze', level: 'Bronze' },
        { id: 't-fip-gold', level: 'Gold' },
      ],
      matchTournaments: {
        [premierMatchId]: 't-premier',
        [fipBronzeMatchId]: 't-fip-bronze',
        [fipGoldMatchId]: 't-fip-gold',
      },
    });
    const httpClient = { post: vi.fn(async () => ({ data: fixtureHtml })) };

    const result = await runMatchStatsFetcher({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });

    // Only the Premier match should hit Crionet.
    expect(httpClient.post).toHaveBeenCalledTimes(1);
    expect(result.fetched).toBe(1);
    // The two FIP-tier mappings should be counted as skipped (not eligible).
    expect(result.skippedNonPremier).toBe(2);
  });

  it('treats Major and Premier_Mens / Premier_Womens labels as Premier-tier (case-insensitive)', async () => {
    const fixtureHtml = readFileSync(FIXTURE_PATH, 'utf-8');
    const ids = ['m-p1', 'm-p2', 'm-major', 'm-pm', 'm-pw'];

    const supabase = fakeSupabase({
      mappings: ids.map((id, i) => ({
        entity_id: id,
        external_id: `FIP-2026-${1000 + i}:MQ001`,
      })),
      finishedMatchIds: ids,
      tournaments: [
        { id: 't-p1', level: 'P1' },
        { id: 't-p2', level: 'p2' },
        { id: 't-major', level: 'Major' },
        { id: 't-pm', level: 'Premier_Mens' },
        { id: 't-pw', level: 'Premier_Womens' },
      ],
      matchTournaments: {
        'm-p1': 't-p1',
        'm-p2': 't-p2',
        'm-major': 't-major',
        'm-pm': 't-pm',
        'm-pw': 't-pw',
      },
    });
    const httpClient = { post: vi.fn(async () => ({ data: fixtureHtml })) };

    const result = await runMatchStatsFetcher({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });

    expect(result.fetched).toBe(5);
    expect(result.skippedNonPremier).toBe(0);
  });

  it('handles thousands of mappings by chunking the .in() filter beneath PostgREST URL-length cap', async () => {
    const fixtureHtml = readFileSync(FIXTURE_PATH, 'utf-8');
    // 500 mappings — well past PostgREST's safe-for-UUID-.in() cap of ~210.
    const allMatchIds: string[] = Array.from({ length: 500 }, (_, i) =>
      `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    );
    const mappings = allMatchIds.map((id, i) => ({
      entity_id: id,
      external_id: `FIP-2026-1701:MQ${String(i).padStart(3, '0')}`,
    }));
    // Only 5 of the 500 are actually finished — proves the chunked filter
    // still narrows correctly across chunks.
    const finishedIds = allMatchIds.slice(0, 5);

    const supabase = fakeSupabase({
      mappings,
      finishedMatchIds: finishedIds,
      maxInChunk: 250,
    });
    const httpClient = {
      post: vi.fn(async () => ({ data: fixtureHtml })),
    };

    const result = await runMatchStatsFetcher({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });

    // Pre-fix: this throws because the first `.in()` is called with 500 ids
    // and the fake returns a URI-Too-Long error.
    // Post-fix: the 5 finished matches without stats are fetched.
    expect(result.fetched).toBe(5);
    expect(httpClient.post).toHaveBeenCalledTimes(5);
  });
});

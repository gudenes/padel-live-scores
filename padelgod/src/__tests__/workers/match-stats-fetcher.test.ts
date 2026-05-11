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
              if (status !== 'finished') return { data: [], error: null };
              const filtered = ids
                .filter((id) => opts.finishedMatchIds.includes(id))
                .map((id) => ({ id }));
              return { data: filtered, error: null };
            },
          }),
        }),
      };
    }
    if (t === 'match_stats') {
      return {
        select: () => ({
          in: (_col: string, ids: string[]) => ({
            eq: async (_sourceCol: string, sourceVal: string) => {
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
});

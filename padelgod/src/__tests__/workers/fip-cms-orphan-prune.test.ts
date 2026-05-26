import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  runFipCmsOrphanPrune,
  type FipCmsOrphanPruneDeps,
} from '../../workers/fip-cms-orphan-prune.js';

// Frozen "now" so the age-based prune predicate is deterministic.
const NOW = new Date('2026-06-01T12:00:00.000Z');
const TEN_DAYS_AGO = new Date(NOW.getTime() - 10 * 24 * 3600 * 1000).toISOString();
const TWO_DAYS_AGO = new Date(NOW.getTime() - 2 * 24 * 3600 * 1000).toISOString();

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

interface FipRow {
  id: string;
  slug: string;
  name: string;
  padelapi_id: string | null;
  last_missing_from_cms_at: string | null;
  source?: string;
}

interface SetupOpts {
  cmsSlugs: string[];
  fipRows: FipRow[];
  /** Tournament ids that have ≥1 match. */
  tournamentsWithMatches?: string[];
  /** Tournament ids that have ≥1 widget_id_cache row. */
  tournamentsWithWidgets?: string[];
}

function fakeSupabase(opts: SetupOpts) {
  const fipRows: FipRow[] = opts.fipRows.map((r) => ({ source: 'fip', ...r }));
  const matchTids = new Set(opts.tournamentsWithMatches ?? []);
  const widgetTids = new Set(opts.tournamentsWithWidgets ?? []);
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const deletes: string[] = [];

  const tournamentsTable = () => ({
    select: (_cols: string) => {
      const builder: any = {
        eq: (col: string, val: unknown) => {
          builder._filters ||= [];
          builder._filters.push((r: FipRow) => (r as any)[col] === val);
          return builder;
        },
        not: (col: string, op: string, _val: unknown) => {
          if (op === 'is') {
            builder._filters ||= [];
            builder._filters.push((r: FipRow) => (r as any)[col] != null);
          }
          return builder;
        },
        then: (resolve: (v: any) => void) => {
          const filtered = (builder._filters ?? []).reduce(
            (acc: FipRow[], f: (r: FipRow) => boolean) => acc.filter(f),
            fipRows,
          );
          return Promise.resolve({ data: filtered, error: null }).then(resolve);
        },
      };
      return builder;
    },
    update: (patch: Record<string, unknown>) => ({
      eq: (col: string, val: string) => {
        if (col !== 'id') throw new Error(`unexpected update filter ${col}`);
        updates.push({ id: val, patch });
        // Reflect into the in-memory rows so the second loadFipCandidates pass sees it.
        const row = fipRows.find((r) => r.id === val);
        if (row) Object.assign(row, patch);
        return Promise.resolve({ data: null, error: null });
      },
    }),
    delete: (_opts?: any) => ({
      in: (col: string, vals: string[]) => {
        if (col !== 'id') throw new Error(`unexpected delete filter ${col}`);
        deletes.push(...vals);
        for (const v of vals) {
          const idx = fipRows.findIndex((r) => r.id === v);
          if (idx >= 0) fipRows.splice(idx, 1);
        }
        return Promise.resolve({ data: null, error: null, count: vals.length });
      },
    }),
  });

  const matchesTable = () => ({
    select: (_cols: string) => ({
      in: (_col: string, ids: string[]) => {
        const data = ids
          .filter((id) => matchTids.has(id))
          .map((tournament_id) => ({ tournament_id }));
        return Promise.resolve({ data, error: null });
      },
    }),
  });

  const widgetTable = () => ({
    select: (_cols: string) => ({
      in: (_col: string, ids: string[]) => {
        const data = ids
          .filter((id) => widgetTids.has(id))
          .map((tournament_id) => ({ tournament_id }));
        return Promise.resolve({ data, error: null });
      },
    }),
  });

  return {
    updates,
    deletes,
    from: (t: string) => {
      if (t === 'tournaments') return tournamentsTable();
      if (t === 'matches') return matchesTable();
      throw new Error(`unexpected public table: ${t}`);
    },
    schema: (_name: string) => ({
      from: (t: string) => {
        if (t === 'widget_id_cache') return widgetTable();
        throw new Error(`unexpected padelgod table: ${t}`);
      },
    }),
  };
}

function fakeHttpClient(cmsSlugs: string[]) {
  return {
    get: vi.fn(async () => ({
      data: cmsSlugs.map((slug) => ({ slug })),
    })),
  };
}

const baseDeps = (opts: SetupOpts): FipCmsOrphanPruneDeps => ({
  supabase: fakeSupabase(opts) as any,
  httpClient: fakeHttpClient(opts.cmsSlugs) as any,
  dryRun: false,
  // 7-day threshold matches production default. Tests with rows
  // stamped TEN_DAYS_AGO trip it; rows stamped TWO_DAYS_AGO don't.
  missingThresholdMs: 7 * 24 * 3600 * 1000,
});

describe('runFipCmsOrphanPrune', () => {
  it('clears the stamp when a previously-missing row reappears in the CMS', async () => {
    const deps = baseDeps({
      cmsSlugs: ['fip-bronze-aaa-2026'],
      fipRows: [
        {
          id: 't-aaa',
          slug: 'fip-bronze-aaa-2026',
          name: 'AAA',
          padelapi_id: null,
          last_missing_from_cms_at: TEN_DAYS_AGO,
        },
      ],
    });
    const result = await runFipCmsOrphanPrune(deps);
    expect(result.rowsCleared).toBe(1);
    expect(result.rowsDeleted).toBe(0);
  });

  it('stamps a row newly absent from CMS', async () => {
    const deps = baseDeps({
      cmsSlugs: [], // wait, will short-circuit; provide at least one
      fipRows: [],
    });
    // Re-build with one CMS slug so the safety guard passes.
    const deps2 = baseDeps({
      cmsSlugs: ['some-other-slug'],
      fipRows: [
        {
          id: 't-bbb',
          slug: 'fip-bronze-bbb-2026',
          name: 'BBB',
          padelapi_id: null,
          last_missing_from_cms_at: null,
        },
      ],
    });
    const result = await runFipCmsOrphanPrune(deps2);
    expect(result.rowsStamped).toBe(1);
    expect(result.rowsDeleted).toBe(0);
  });

  it('does NOT re-stamp a row that already has a missing timestamp', async () => {
    const deps = baseDeps({
      cmsSlugs: ['some-other-slug'],
      fipRows: [
        {
          id: 't-ccc',
          slug: 'fip-bronze-ccc-2026',
          name: 'CCC',
          padelapi_id: null,
          last_missing_from_cms_at: TWO_DAYS_AGO, // newer than threshold, won't delete either
        },
      ],
    });
    const result = await runFipCmsOrphanPrune(deps);
    expect(result.rowsStamped).toBe(0);
    expect(result.rowsSkippedTooRecent).toBe(1);
  });

  it('deletes a row that has been missing past the threshold + has no matches/widgets', async () => {
    const deps = baseDeps({
      cmsSlugs: ['some-other-slug'],
      fipRows: [
        {
          id: 't-ddd',
          slug: 'fip-bronze-ddd-2026',
          name: 'DDD',
          padelapi_id: null,
          last_missing_from_cms_at: TEN_DAYS_AGO,
        },
      ],
    });
    const result = await runFipCmsOrphanPrune(deps);
    expect(result.rowsDeleted).toBe(1);
  });

  it('NEVER deletes a row with padelapi_id set, even if otherwise eligible', async () => {
    const deps = baseDeps({
      cmsSlugs: ['some-other-slug'],
      fipRows: [
        {
          id: 't-eee',
          slug: 'fip-bronze-eee-2026',
          name: 'EEE',
          padelapi_id: '12345',
          last_missing_from_cms_at: TEN_DAYS_AGO,
        },
      ],
    });
    const result = await runFipCmsOrphanPrune(deps);
    expect(result.rowsDeleted).toBe(0);
    expect(result.rowsSkippedHasPadelapiId).toBe(1);
  });

  it('NEVER deletes a row with matches, even if otherwise eligible', async () => {
    const deps = baseDeps({
      cmsSlugs: ['some-other-slug'],
      fipRows: [
        {
          id: 't-fff',
          slug: 'fip-bronze-fff-2026',
          name: 'FFF',
          padelapi_id: null,
          last_missing_from_cms_at: TEN_DAYS_AGO,
        },
      ],
      tournamentsWithMatches: ['t-fff'],
    });
    const result = await runFipCmsOrphanPrune(deps);
    expect(result.rowsDeleted).toBe(0);
    expect(result.rowsSkippedHasMatches).toBe(1);
  });

  it('NEVER deletes a row with widget_id_cache, even if otherwise eligible', async () => {
    const deps = baseDeps({
      cmsSlugs: ['some-other-slug'],
      fipRows: [
        {
          id: 't-ggg',
          slug: 'fip-bronze-ggg-2026',
          name: 'GGG',
          padelapi_id: null,
          last_missing_from_cms_at: TEN_DAYS_AGO,
        },
      ],
      tournamentsWithWidgets: ['t-ggg'],
    });
    const result = await runFipCmsOrphanPrune(deps);
    expect(result.rowsDeleted).toBe(0);
    expect(result.rowsSkippedHasWidget).toBe(1);
  });

  it('refuses to do anything when CMS returns zero slugs (safety guard)', async () => {
    const deps = baseDeps({
      cmsSlugs: [],
      fipRows: [
        {
          id: 't-hhh',
          slug: 'fip-bronze-hhh-2026',
          name: 'HHH',
          padelapi_id: null,
          last_missing_from_cms_at: TEN_DAYS_AGO,
        },
      ],
    });
    const result = await runFipCmsOrphanPrune(deps);
    expect(result.cmsSlugsChecked).toBe(0);
    expect(result.rowsStamped).toBe(0);
    expect(result.rowsCleared).toBe(0);
    expect(result.rowsDeleted).toBe(0);
  });

  it('dry-run: ticks counters, makes no writes', async () => {
    const opts: SetupOpts = {
      cmsSlugs: ['some-other-slug'],
      fipRows: [
        {
          id: 't-iii',
          slug: 'fip-bronze-iii-2026',
          name: 'III',
          padelapi_id: null,
          last_missing_from_cms_at: TEN_DAYS_AGO,
        },
      ],
    };
    const supabase = fakeSupabase(opts) as any;
    const result = await runFipCmsOrphanPrune({
      supabase,
      httpClient: fakeHttpClient(opts.cmsSlugs) as any,
      dryRun: true,
      missingThresholdMs: 7 * 24 * 3600 * 1000,
    });
    expect(result.rowsDeleted).toBe(1);
    expect(supabase.updates).toHaveLength(0);
    expect(supabase.deletes).toHaveLength(0);
  });

  it('stamps + deletes in the same run when a different row crosses the threshold', async () => {
    const deps = baseDeps({
      cmsSlugs: ['some-other-slug'],
      fipRows: [
        // Already-stamped + past threshold — should be DELETED this run.
        {
          id: 't-old',
          slug: 'fip-bronze-old-2026',
          name: 'OLD',
          padelapi_id: null,
          last_missing_from_cms_at: TEN_DAYS_AGO,
        },
        // Newly absent — gets stamped, not deleted (stamp too fresh).
        {
          id: 't-new',
          slug: 'fip-bronze-new-2026',
          name: 'NEW',
          padelapi_id: null,
          last_missing_from_cms_at: null,
        },
      ],
    });
    const result = await runFipCmsOrphanPrune(deps);
    expect(result.rowsStamped).toBe(1); // t-new
    expect(result.rowsDeleted).toBe(1); // t-old
  });
});

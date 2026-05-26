import { describe, it, expect } from 'vitest';
import { runShadowDiffOcr } from '../../workers/shadow-diff-ocr.js';

interface OcrSnapshotSeed {
  id: number;
  match_id: string | null;
  frame_at: string;
  captured_at: string;
  parsed_score: {
    sets_completed: string[];
    current_game: string | null;
    pair1_label: string | null;
    pair2_label: string | null;
    parse_error: boolean;
  };
}

interface PublicSetSeed {
  set_number: number;
  pair1_games: number | null;
  pair2_games: number | null;
}

interface FakeInputs {
  snapshots: OcrSnapshotSeed[];
  setsByMatchId: Record<string, PublicSetSeed[]>;
}

function fakeSupabase(inputs: Partial<FakeInputs> = {}) {
  const snapshots = inputs.snapshots ?? [];
  const setsByMatchId = inputs.setsByMatchId ?? {};

  const ocrDiffInserted: any[] = [];

  // Snapshot query chain:
  //   supabase.schema('padelgod').from('ocr_snapshots')
  //     .select(...).gte('captured_at', cutoff).not('match_id', 'is', null).order(...)
  function ocrSnapshotsTable() {
    return {
      select: (_cols: string) => ({
        gte: (_col: string, cutoff: string) => ({
          not: (_col2: string, _op: string, _val: any) => ({
            order: (_col3: string, _opts: any) => {
              // Return snapshots with match_id != null, captured after cutoff,
              // sorted descending by frame_at (latest first).
              const filtered = snapshots
                .filter((s) => s.match_id !== null && s.captured_at >= cutoff)
                .sort((a, b) => b.frame_at.localeCompare(a.frame_at));
              return Promise.resolve({ data: filtered, error: null });
            },
          }),
        }),
      }),
    };
  }

  // Sets query chain:
  //   supabase.from('sets').select(...).eq('match_id', id).order(...)
  function setsTable() {
    return {
      select: (_cols: string) => ({
        eq: (_col: string, matchId: string) => ({
          order: (_col2: string, _opts: any) => {
            const rows = (setsByMatchId[matchId] ?? []).slice().sort(
              (a, b) => a.set_number - b.set_number,
            );
            return Promise.resolve({ data: rows, error: null });
          },
        }),
      }),
    };
  }

  // ocr_diff_events insert chain:
  //   supabase.schema('padelgod').from('ocr_diff_events').insert({...})
  function ocrDiffEventsTable() {
    return {
      insert: (row: any) => {
        ocrDiffInserted.push(row);
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  return {
    ocrDiffInserted,
    schema: (_schemaName: string) => ({
      from: (tableName: string) => {
        if (tableName === 'ocr_snapshots') return ocrSnapshotsTable();
        if (tableName === 'ocr_diff_events') return ocrDiffEventsTable();
        throw new Error(`unexpected padelgod-schema table: ${tableName}`);
      },
    }),
    from: (tableName: string) => {
      if (tableName === 'sets') return setsTable();
      throw new Error(`unexpected public-schema table: ${tableName}`);
    },
  };
}

// A timestamp well within the default 5-minute window.
const RECENT = new Date(Date.now() - 60_000).toISOString();
const MATCH_A = 'match-aaaaaaaa-0000-0000-0000-000000000001';
const MATCH_B = 'match-bbbbbbbb-0000-0000-0000-000000000002';

function makeSnapshot(
  id: number,
  matchId: string | null,
  setsCompleted: string[],
  opts: { parseError?: boolean; frameOffset?: number } = {},
): OcrSnapshotSeed {
  const offsetMs = opts.frameOffset ?? 0;
  return {
    id,
    match_id: matchId,
    captured_at: RECENT,
    frame_at: new Date(Date.now() - 120_000 + offsetMs).toISOString(),
    parsed_score: {
      sets_completed: setsCompleted,
      current_game: null,
      pair1_label: null,
      pair2_label: null,
      parse_error: opts.parseError ?? false,
    },
  };
}

describe('runShadowDiffOcr', () => {
  it('agreement=match when OCR sets_completed matches public.sets', async () => {
    const supabase = fakeSupabase({
      snapshots: [makeSnapshot(1, MATCH_A, ['6-3'])],
      setsByMatchId: {
        [MATCH_A]: [{ set_number: 1, pair1_games: 6, pair2_games: 3 }],
      },
    });

    const result = await runShadowDiffOcr({ supabase: supabase as any });

    expect(result.snapshotsConsidered).toBe(1);
    expect(result.diffsWritten).toBe(1);
    expect(result.agreementCounts).toEqual({ match: 1 });

    expect(supabase.ocrDiffInserted).toHaveLength(1);
    const row = supabase.ocrDiffInserted[0];
    expect(row.match_id).toBe(MATCH_A);
    expect(row.agreement).toBe('match');
    expect(row.ocr_snapshot_id).toBe(1);
    expect(row.ocr_score.sets_completed).toEqual(['6-3']);
    expect(Array.isArray(row.crionet_score)).toBe(true);
    expect(row.crionet_score).toHaveLength(1);
    expect(typeof row.lag_seconds).toBe('number');
  });

  it('agreement=sets_disagree when OCR score differs from public.sets', async () => {
    const supabase = fakeSupabase({
      snapshots: [makeSnapshot(2, MATCH_A, ['6-3'])],
      setsByMatchId: {
        [MATCH_A]: [{ set_number: 1, pair1_games: 6, pair2_games: 2 }],
      },
    });

    const result = await runShadowDiffOcr({ supabase: supabase as any });

    expect(result.snapshotsConsidered).toBe(1);
    expect(result.diffsWritten).toBe(1);
    expect(result.agreementCounts).toEqual({ sets_disagree: 1 });

    expect(supabase.ocrDiffInserted[0].agreement).toBe('sets_disagree');
  });

  it('agreement=no_crionet_baseline when public.sets is empty for the match', async () => {
    const supabase = fakeSupabase({
      snapshots: [makeSnapshot(3, MATCH_A, ['6-3'])],
      setsByMatchId: {
        // MATCH_A has no sets in public.sets
      },
    });

    const result = await runShadowDiffOcr({ supabase: supabase as any });

    expect(result.snapshotsConsidered).toBe(1);
    expect(result.diffsWritten).toBe(1);
    expect(result.agreementCounts).toEqual({ no_crionet_baseline: 1 });

    const row = supabase.ocrDiffInserted[0];
    expect(row.agreement).toBe('no_crionet_baseline');
    // sets returns [] when no rows exist; `sets ?? null` keeps [] since [] is not nullish.
    expect(row.crionet_score).toEqual([]);
  });

  it('agreement=no_crionet_baseline when snapshot has parse_error=true', async () => {
    const supabase = fakeSupabase({
      snapshots: [makeSnapshot(4, MATCH_A, [], { parseError: true })],
      setsByMatchId: {
        [MATCH_A]: [{ set_number: 1, pair1_games: 6, pair2_games: 3 }],
      },
    });

    const result = await runShadowDiffOcr({ supabase: supabase as any });

    expect(result.snapshotsConsidered).toBe(1);
    expect(result.diffsWritten).toBe(1);
    expect(result.agreementCounts).toEqual({ no_crionet_baseline: 1 });

    expect(supabase.ocrDiffInserted[0].agreement).toBe('no_crionet_baseline');
  });

  it('multiple snapshots for same match — only latest (first in DESC order) is diffed', async () => {
    // snapshot id=10 is the newest (frameOffset=0 means most recent),
    // id=11 is older (frameOffset=-5000 means 5s earlier).
    const snapshots = [
      makeSnapshot(10, MATCH_A, ['6-3'], { frameOffset: 0 }),     // latest
      makeSnapshot(11, MATCH_A, ['6-1'], { frameOffset: -5000 }), // older
    ];

    const supabase = fakeSupabase({
      snapshots,
      setsByMatchId: {
        [MATCH_A]: [{ set_number: 1, pair1_games: 6, pair2_games: 3 }],
      },
    });

    const result = await runShadowDiffOcr({ supabase: supabase as any });

    // Only 1 unique match_id → 1 snapshot considered, 1 diff written.
    expect(result.snapshotsConsidered).toBe(1);
    expect(result.diffsWritten).toBe(1);

    // The latest snapshot (id=10, sets_completed=['6-3']) agrees with public.sets.
    expect(result.agreementCounts).toEqual({ match: 1 });
    expect(supabase.ocrDiffInserted[0].ocr_snapshot_id).toBe(10);
    expect(supabase.ocrDiffInserted[0].agreement).toBe('match');
  });

  it('multiple different match_ids — one diff per match', async () => {
    const supabase = fakeSupabase({
      snapshots: [
        makeSnapshot(20, MATCH_A, ['6-3']),
        makeSnapshot(21, MATCH_B, ['7-5']),
      ],
      setsByMatchId: {
        [MATCH_A]: [{ set_number: 1, pair1_games: 6, pair2_games: 3 }],
        [MATCH_B]: [{ set_number: 1, pair1_games: 7, pair2_games: 4 }], // disagrees
      },
    });

    const result = await runShadowDiffOcr({ supabase: supabase as any });

    expect(result.snapshotsConsidered).toBe(2);
    expect(result.diffsWritten).toBe(2);
    expect(result.agreementCounts).toEqual({ match: 1, sets_disagree: 1 });
    expect(supabase.ocrDiffInserted).toHaveLength(2);
  });

  it('snapshot with null match_id is excluded from processing', async () => {
    // The fakeSupabase filter mirrors what the DB `.not('match_id','is',null)` does.
    const supabase = fakeSupabase({
      snapshots: [makeSnapshot(30, null, ['6-3'])],
      setsByMatchId: {},
    });

    const result = await runShadowDiffOcr({ supabase: supabase as any });

    expect(result.snapshotsConsidered).toBe(0);
    expect(result.diffsWritten).toBe(0);
    expect(supabase.ocrDiffInserted).toHaveLength(0);
  });
});

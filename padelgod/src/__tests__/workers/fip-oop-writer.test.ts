import { describe, it, expect, vi } from 'vitest';
import {
  runFipOopWriter,
  buildOopPatch,
  isPlaceholderScheduledAt,
  isScheduledAtWriteEligible,
} from '../../workers/fip-oop-writer.js';

describe('isPlaceholderScheduledAt', () => {
  it('returns true for midnight UTC with Z suffix', () => {
    expect(isPlaceholderScheduledAt('2026-05-02T00:00:00Z')).toBe(true);
  });
  it('returns true for midnight UTC with +00:00 offset', () => {
    expect(isPlaceholderScheduledAt('2026-05-02T00:00:00+00:00')).toBe(true);
  });
  it('returns true for midnight UTC with sub-second precision', () => {
    expect(isPlaceholderScheduledAt('2026-05-02T00:00:00.000+00:00')).toBe(true);
  });
  it('returns true for midnight UTC bare ISO (no tz)', () => {
    expect(isPlaceholderScheduledAt('2026-05-02T00:00:00')).toBe(true);
  });
  it('returns false for any non-midnight time', () => {
    expect(isPlaceholderScheduledAt('2026-05-02T14:30:00+00:00')).toBe(false);
    expect(isPlaceholderScheduledAt('2026-05-02T00:30:00+00:00')).toBe(false);
    expect(isPlaceholderScheduledAt('2026-05-02T00:00:01+00:00')).toBe(false);
  });
  it('returns false for null and empty', () => {
    expect(isPlaceholderScheduledAt(null)).toBe(false);
    expect(isPlaceholderScheduledAt('')).toBe(false);
  });
  it('returns false for midnight LOCAL time with non-zero UTC offset', () => {
    // A real Madrid-midnight match would store as ...T22:00:00+00:00
    // (UTC), not midnight UTC. Hypothetical exact midnight in a non-UTC
    // tz isn't a placeholder.
    expect(isPlaceholderScheduledAt('2026-05-01T22:00:00+00:00')).toBe(false);
  });
});

describe('isScheduledAtWriteEligible', () => {
  it('eligible when scheduled_at is null (never been set)', () => {
    expect(isScheduledAtWriteEligible(null, null)).toBe(true);
    expect(isScheduledAtWriteEligible(null, 'Followed by')).toBe(true);
    expect(isScheduledAtWriteEligible(null, 'Starting at 5:00 PM')).toBe(true);
  });

  it('eligible when scheduled_at is the midnight-UTC padelapi placeholder', () => {
    expect(isScheduledAtWriteEligible('2026-05-02T00:00:00+00:00', null)).toBe(true);
    expect(isScheduledAtWriteEligible('2026-05-02T00:00:00Z', 'Followed by')).toBe(true);
  });

  it('eligible when current value is a "Followed by" estimate (chain can shift)', () => {
    // Regression: FIP PLATINUM ALBANIA Q3 (2026-05-25) — the Q3 "Followed by"
    // match was estimated at 12:00 UTC early in the day off a 09:00-anchored
    // chain. Later in the day the OOP grew to include Q2 "Not before 3 PM"
    // and Q3 "Not before 5 PM" rows; court_order rolled to 5, but
    // scheduled_at stayed stuck at 12:00 UTC because the firm-only filter
    // refused to overwrite. Allowing "Followed by" rows to re-enter the
    // estimation pool fixes this — the chain now resolves to 16:30 UTC
    // (15:00 + 90 min) on the next run.
    expect(isScheduledAtWriteEligible('2026-05-25T12:00:00+00:00', 'Followed by')).toBe(true);
    // Case-insensitive match — OOP capitalisation has wobbled historically.
    expect(isScheduledAtWriteEligible('2026-05-25T12:00:00+00:00', 'followed by')).toBe(true);
    expect(isScheduledAtWriteEligible('2026-05-25T12:00:00+00:00', 'FOLLOWED BY')).toBe(true);
  });

  it('NOT eligible when current value is firm — "Starting at" or "Not before"', () => {
    // Absolute-time labels carry an authoritative time we must not clobber.
    // Manual ops Schedule Review edits and padelapi-sourced firm times both
    // land here, and re-estimating would undo operator intent.
    expect(
      isScheduledAtWriteEligible('2026-05-25T15:00:00+00:00', 'Starting at 5:00 PM'),
    ).toBe(false);
    expect(
      isScheduledAtWriteEligible('2026-05-25T15:00:00+00:00', 'Not before 5:00 PM'),
    ).toBe(false);
  });

  it('NOT eligible when scheduled_at is firm and schedule_label is null', () => {
    // Defensive: a real scheduled_at with no label is treated as firm
    // (e.g. a hand-set value or a legacy row predating schedule_label).
    expect(isScheduledAtWriteEligible('2026-05-25T15:00:00+00:00', null)).toBe(false);
  });
});

const TOURNAMENT_ID = 't-isla';
const TOURNAMENT_SLUG = 'fip-bronze-aquahobby-isla-de-la-palma-2026';
const TOURNAMENT_WIDGET = 'FIP-2026-1706';

interface OopSeed {
  tournament_id: string;
  match_widget_id: string | null;
  category: 'men' | 'women';
  round_label: string | null;
  court: string | null;
  court_position: number | null;
  scheduled_label: string | null;
  captured_at: string;
}

interface ExistingMatchSeed {
  id: string;
  widget_id_composite: string;
  round: string | null;
  court: string | null;
  court_order: number | null;
}

interface Options {
  tournaments?: Array<{
    tournament_id: string;
    tournament_name: string;
    slug: string;
  }>;
  widgetCodeByTournament?: Record<string, string | null>;
  oopRows?: OopSeed[];
  existingMatches?: ExistingMatchSeed[];
}

function fakeSupabase(opts: Options) {
  const tournaments = opts.tournaments ?? [];
  const widgetCode = opts.widgetCodeByTournament ?? {};
  const oopRows = opts.oopRows ?? [];
  const existing: ExistingMatchSeed[] = [...(opts.existingMatches ?? [])];

  const updated: Array<{ id: string; patch: Record<string, unknown> }> = [];

  const matchesTable = () => ({
    select: (_cols: string) => ({
      like: (_col: string, pattern: string) => {
        const prefix = pattern.slice(0, -1);
        const data = existing.filter((m) =>
          m.widget_id_composite.startsWith(prefix)
        );
        return Promise.resolve({ data, error: null });
      },
    }),
    update: (patch: Record<string, unknown>) => ({
      eq: (col: string, val: string) => {
        if (col !== 'id') throw new Error(`unexpected UPDATE filter: ${col}`);
        updated.push({ id: val, patch });
        return Promise.resolve({ data: null, error: null });
      },
    }),
  });

  // Mocks `.from('oop_snapshots').select(...).eq(...).order(...).range(start, end)` —
  // the writer now paginates this read (Asuncion P2 2026-05-08 incident:
  // unbounded select silently truncated past PostgREST's 10k cap and
  // skipped every QF widget's latest snapshot). The fake honours
  // `.range()` slicing so tests can also exercise the pagination loop
  // by seeding more rows than the helper's pageSize.
  const oopSnapshotsTable = () => ({
    select: (_cols: string) => ({
      eq: (col: string, val: string) => {
        const filtered = oopRows.filter(
          (r) => col !== 'tournament_id' || r.tournament_id === val
        );
        return {
          order: (
            orderCol: string,
            opts: { ascending?: boolean } = {},
          ) => {
            const sorted = [...filtered].sort((a, b) => {
              const av = (a as Record<string, unknown>)[orderCol] as string;
              const bv = (b as Record<string, unknown>)[orderCol] as string;
              if (av === bv) return 0;
              const cmp = av < bv ? -1 : 1;
              return opts.ascending === false ? -cmp : cmp;
            });
            return {
              range: (start: number, end: number) =>
                Promise.resolve({
                  data: sorted.slice(start, end + 1),
                  error: null,
                }),
            };
          },
        };
      },
    }),
  });

  const widgetIdCacheTable = () => ({
    select: (_cols: string) => ({
      eq: (_c1: string, v1: string) => ({
        eq: (_c2: string, _v2: boolean) => ({
          maybeSingle: () => {
            const code = widgetCode[v1];
            return Promise.resolve({
              data: code ? { widget_id: code } : null,
              error: null,
            });
          },
        }),
      }),
    }),
  });

  return {
    updated,
    schema: (_name: string) => ({
      from: (t: string) => {
        if (t === 'oop_snapshots') return oopSnapshotsTable();
        if (t === 'widget_id_cache') return widgetIdCacheTable();
        throw new Error(`unexpected padelgod table: ${t}`);
      },
    }),
    from: (t: string) => {
      if (t === 'matches') return matchesTable();
      throw new Error(`unexpected public table: ${t}`);
    },
    rpc: vi.fn(async (name: string) => {
      if (name !== 'padelgod_active_tournaments_with_slug') {
        throw new Error(`unexpected RPC: ${name}`);
      }
      return { data: tournaments, error: null };
    }),
  };
}

// ── buildOopPatch (pure helper) ─────────────────────────────────────────

describe('buildOopPatch', () => {
  const baseSnapshot: any = {
    tournament_id: TOURNAMENT_ID,
    match_widget_id: 'MD017',
    category: 'men',
    round_label: 'Round of 32',
    court: 'CLUB, PISTA OMEYA',
    court_position: 0,
    scheduled_label: 'Starting at 4:00 PM',
    captured_at: '2026-04-24T10:00:00Z',
  };

  const baseExisting: any = {
    id: 'm-1',
    widget_id_composite: 'FIP-2026-1706:MD017',
    round: 'R32',           // populator's canonical short form
    court: null,            // not yet enriched
    court_order: null,
  };

  it('writes court + court_order on a fresh match; leaves round when normalised match', () => {
    // existing.round = 'R32', snapshot.round_label = 'Round of 32' →
    // normalised both to 'R32', so no round write.
    const patch = buildOopPatch(baseSnapshot, baseExisting);
    expect(patch).toEqual({
      court: 'CLUB, PISTA OMEYA',
      court_order: 1, // 0-based court_position + 1
    });
    expect(patch).not.toHaveProperty('round');
  });

  it('DOES fill round when existing.round is null', () => {
    const patch = buildOopPatch(baseSnapshot, { ...baseExisting, round: null });
    expect(patch).toHaveProperty('round', 'Round of 32');
  });

  it('writes round_canonical alongside round so indexed lookups stay in sync', () => {
    const patch = buildOopPatch(baseSnapshot, { ...baseExisting, round: null });
    expect(patch).toHaveProperty('round_canonical', 'R32');
  });

  it('does NOT clobber existing round when normalised forms match (R32 vs "Round of 32")', () => {
    const patch = buildOopPatch(baseSnapshot, { ...baseExisting, round: 'R32' });
    expect(patch).not.toHaveProperty('round');
  });

  it('OVERWRITES existing round when OOP says a different round (R32 → Q3 mismatch)', () => {
    // The Mendoza Apr 2026 case: populator wrote round='R32' from the
    // main-draw bracket, but the OOP for Apr 29 says the same widget
    // is actually playing Q3 (qualifier). OOP wins.
    const patch = buildOopPatch(
      { ...baseSnapshot, round_label: 'Q3' },
      { ...baseExisting, round: 'R32' },
    );
    expect(patch).toHaveProperty('round', 'Q3');
    expect(patch).toHaveProperty('round_canonical', 'Q3');
  });

  it('skips round write when OOP label is unrecognised (e.g. typo)', () => {
    // Defensive: bad data on the FIP side shouldn't blank a good
    // existing label. Unknown input → no write.
    const patch = buildOopPatch(
      { ...baseSnapshot, round_label: 'gibberish' },
      { ...baseExisting, round: 'R32' },
    );
    expect(patch).not.toHaveProperty('round');
  });

  it('skips court_order write when snapshot has null court_position', () => {
    const patch = buildOopPatch(
      { ...baseSnapshot, court_position: null },
      baseExisting,
    );
    expect(patch).toEqual({ court: 'CLUB, PISTA OMEYA' });
    expect(patch).not.toHaveProperty('court_order');
  });

  it('no-op when nothing would change', () => {
    const patch = buildOopPatch(baseSnapshot, {
      ...baseExisting,
      court: 'CLUB, PISTA OMEYA',
      court_order: 1,
      round: 'R32', // normalises to same canonical as snapshot's "Round of 32"
    });
    expect(patch).toBeNull();
  });

  it('writes court change when OOP moves match to a different court', () => {
    const patch = buildOopPatch(
      { ...baseSnapshot, court: 'PISTA CENTRAL BAGATAZO', court_position: 2 },
      {
        ...baseExisting,
        court: 'CLUB, PISTA OMEYA',
        court_order: 1,
      },
    );
    expect(patch).toEqual({
      court: 'PISTA CENTRAL BAGATAZO',
      court_order: 3,
    });
  });

  it('stays source-faithful: bad snapshot data propagates (documents known parser bug)', () => {
    // Known Brussels bug: court column contains scheduled_label text
    // like "Starting at 10:00 AM". Fix is in crionet-oop.ts parser,
    // not here. This test documents the behaviour so anyone revisiting
    // sees why we don't validate.
    const buggySnapshot: any = {
      ...baseSnapshot,
      court: 'Starting at 10:00 AM',
      court_position: null,
    };
    const patch = buildOopPatch(buggySnapshot, baseExisting);
    expect(patch).toEqual({ court: 'Starting at 10:00 AM' });
  });
});

// ── runFipOopWriter ────────────────────────────────────────────────────

const isla = {
  tournament_id: TOURNAMENT_ID,
  tournament_name: 'Isla',
  slug: TOURNAMENT_SLUG,
};

const md017Snapshot: OopSeed = {
  tournament_id: TOURNAMENT_ID,
  match_widget_id: 'MD017',
  category: 'men',
  round_label: 'Round of 32',
  court: 'CLUB, PISTA OMEYA',
  court_position: 0,
  scheduled_label: 'Starting at 4:00 PM',
  captured_at: '2026-04-24T10:00:00Z',
};

const md017Existing: ExistingMatchSeed = {
  id: 'm-md017',
  widget_id_composite: 'FIP-2026-1706:MD017',
  round: 'R32',
  court: null,
  court_order: null,
};

describe('runFipOopWriter', () => {
  it('UPDATEs court + court_order when match exists + snapshot has fresh data', async () => {
    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      oopRows: [md017Snapshot],
      existingMatches: [md017Existing],
    });

    const result = await runFipOopWriter({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.tournamentsProcessed).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.skippedNoMatch).toBe(0);
    expect(supabase.updated).toHaveLength(1);
    expect(supabase.updated[0].id).toBe('m-md017');
    expect(supabase.updated[0].patch).toEqual({
      court: 'CLUB, PISTA OMEYA',
      court_order: 1,
    });
  });

  it('dry-run: ticks counters, writes nothing', async () => {
    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      oopRows: [md017Snapshot],
      existingMatches: [md017Existing],
    });

    const result = await runFipOopWriter({
      supabase: supabase as any,
      dryRun: true,
    });

    expect(result.updated).toBe(1);
    expect(result.dryRun).toBe(true);
    expect(supabase.updated).toHaveLength(0);
  });

  it('SKIPs OOP rows when no composite-keyed match exists (populator not caught up yet)', async () => {
    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      oopRows: [md017Snapshot],
      existingMatches: [], // nothing created yet by populator
    });

    const result = await runFipOopWriter({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.tournamentsProcessed).toBe(1);
    expect(result.skippedNoMatch).toBe(1);
    expect(result.updated).toBe(0);
    expect(supabase.updated).toHaveLength(0);
  });

  it('SKIPs tournaments with no widget_id_cache row', async () => {
    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: {}, // no code
      oopRows: [md017Snapshot],
      existingMatches: [md017Existing],
    });

    const result = await runFipOopWriter({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.tournamentsSkippedNoWidget).toBe(1);
    expect(result.tournamentsProcessed).toBe(0);
    expect(supabase.updated).toHaveLength(0);
  });

  it('null match_widget_id rows are filtered at load time — no write, no counter tick', async () => {
    // Rows without a match_widget_id can't be keyed to a match at all —
    // `loadLatestOopRows` drops them before iteration so they don't even
    // reach the "considered" counter. That's intentional: the counter is
    // for "real" OOP rows worth reasoning about; malformed-at-source
    // rows get silently discarded (operator sees them via the ops
    // dashboard, not here).
    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      oopRows: [{ ...md017Snapshot, match_widget_id: null }],
      existingMatches: [md017Existing],
    });

    const result = await runFipOopWriter({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.oopRowsConsidered).toBe(0);
    expect(result.updated).toBe(0);
    expect(supabase.updated).toHaveLength(0);
  });

  it('no-op when match is already enriched (idempotent re-runs)', async () => {
    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      oopRows: [md017Snapshot],
      existingMatches: [
        {
          ...md017Existing,
          court: 'CLUB, PISTA OMEYA',
          court_order: 1,
        },
      ],
    });

    const result = await runFipOopWriter({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.updated).toBe(0);
    expect(result.skippedNothingToChange).toBe(1);
    expect(supabase.updated).toHaveLength(0);
  });

  it('picks the latest captured_at per widget when multiple snapshots exist (paginated)', async () => {
    // Regression for the Asuncion P2 2026-05-08 incident: when the
    // oop_snapshots read isn't paginated, PostgREST silently truncates
    // past `db_max_rows` (10k) and returns a non-deterministic slice
    // that often excludes each widget's latest capture. The writer
    // would then dedup against stale data (or skip widgets entirely)
    // and leave matches stuck with court=null / scheduled_at=null.
    //
    // We seed THREE captures for the same widget — older two with bad
    // court ('OLD-A', 'OLD-B'), newest with the real court — and
    // verify the writer applies the newest. This locks in both the
    // dedup-latest-wins behaviour and the new desc-ordered + paginated
    // read. The fake's `.range()` honours pagination, so this also
    // exercises the pagination loop on the writer side.
    const olderA: OopSeed = {
      ...md017Snapshot,
      court: 'OLD-A',
      captured_at: '2026-04-23T10:00:00Z',
    };
    const olderB: OopSeed = {
      ...md017Snapshot,
      court: 'OLD-B',
      captured_at: '2026-04-23T22:00:00Z',
    };
    const newest: OopSeed = {
      ...md017Snapshot,
      court: 'CLUB, PISTA OMEYA',
      captured_at: '2026-04-24T10:00:00Z',
    };
    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      // Insertion order intentionally NOT chronological — proves the
      // writer's dedup logic doesn't rely on input ordering.
      oopRows: [olderB, newest, olderA],
      existingMatches: [md017Existing],
    });

    const result = await runFipOopWriter({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.updated).toBe(1);
    expect(supabase.updated).toHaveLength(1);
    expect(supabase.updated[0].patch).toEqual({
      court: 'CLUB, PISTA OMEYA',
      court_order: 1,
    });
  });

  it('does NOT touch matches outside the composite prefix (legacy reconciler rows)', async () => {
    // Legacy row with synthetic-style composite is not exposed via
    // .like('widget_id_composite', 'FIP-...%') because legacy rows
    // have widget_id_composite NULL. Simulate that the seed list
    // only contains a composite-keyed row from a different tournament.
    const otherTournamentRow: ExistingMatchSeed = {
      id: 'm-other',
      widget_id_composite: 'FIP-2026-9999:MD001', // different tournament code
      round: null,
      court: null,
      court_order: null,
    };
    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      oopRows: [md017Snapshot],
      existingMatches: [otherTournamentRow],
    });

    const result = await runFipOopWriter({
      supabase: supabase as any,
      dryRun: false,
    });

    // The OOP row's composite FIP-2026-1706:MD017 doesn't match the
    // other-tournament row at FIP-2026-9999:MD001 → skipped.
    expect(result.skippedNoMatch).toBe(1);
    expect(supabase.updated).toHaveLength(0);
  });
});

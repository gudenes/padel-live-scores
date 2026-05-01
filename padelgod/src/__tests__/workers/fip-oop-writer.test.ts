import { describe, it, expect, vi } from 'vitest';
import {
  runFipOopWriter,
  buildOopPatch,
  isPlaceholderScheduledAt,
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

  const oopSnapshotsTable = () => ({
    select: (_cols: string) => ({
      eq: (col: string, val: string) => {
        const data = oopRows.filter(
          (r) => col !== 'tournament_id' || r.tournament_id === val
        );
        return Promise.resolve({ data, error: null });
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

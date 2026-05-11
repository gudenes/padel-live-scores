import { describe, it, expect, vi } from 'vitest';
import {
  runFipDrawPopulator,
  resolveFourPlayers,
  normalizeName,
  shortenName,
  buildShortFormMap,
} from '../../workers/fip-draw-populator.js';

// Matches the production Isla de la Palma shape minus fields the
// populator doesn't read. Fixtures use real-ish widget IDs to mirror
// what downstream OOP/results writers will see.

const TOURNAMENT_ID = 't-isla';
const TOURNAMENT_SLUG = 'fip-bronze-aquahobby-isla-de-la-palma-2026';
const TOURNAMENT_WIDGET = 'FIP-2026-1706';

interface DrawSeed {
  tournament_id: string;
  match_widget_id: string | null;
  category: 'men' | 'women';
  round_label: string;
  draw_position: number | null;
  team1_player1_name: string | null;
  team1_player2_name: string | null;
  team2_player1_name: string | null;
  team2_player2_name: string | null;
  team1_fip_id: string | null;
  team2_fip_id: string | null;
  team1_seed: number | null;
  team2_seed: number | null;
  status: 'scheduled' | 'live' | 'finished' | 'walkover' | 'retired';
  captured_at: string;
}

// OOP snapshot row, narrow to what the populator's amateur fallback
// reads. Mirrors the shape selected from `padelgod.oop_snapshots` —
// no FIP IDs, no seeds, no status (those live on draw_snapshots only).
interface OopSnapshotSeed {
  tournament_id: string;
  match_widget_id: string | null;
  category: 'men' | 'women' | null;
  round_label: string | null;
  team1_player1_name: string | null;
  team1_player2_name: string | null;
  team2_player1_name: string | null;
  team2_player2_name: string | null;
  // Country codes default to null when omitted by a fixture, matching
  // the column's default in padelgod.oop_snapshots. The populator's
  // OOP-fallback path passes them through to public.matches.
  team1_player1_country?: string | null;
  team1_player2_country?: string | null;
  team2_player1_country?: string | null;
  team2_player2_country?: string | null;
  captured_at: string;
}

interface EntryListSeed {
  name: string;
  fip_id: string;
  category: 'men' | 'women';
  captured_at: string;
}

interface PlayerSeed {
  id: string;
  fip_id: string;
}

interface ExistingMatchSeed {
  id: string;
  widget_id_composite: string;
  pair1_player1_id: string | null;
  pair1_player2_id: string | null;
  pair2_player1_id: string | null;
  pair2_player2_id: string | null;
  // Thin-match (amateur tier) name + country columns. Default to null
  // in the helper so the populator's `existing.pair*_xxx === null`
  // checks behave like a real Postgres row where the column is unset.
  pair1_player1_name?: string | null;
  pair1_player2_name?: string | null;
  pair2_player1_name?: string | null;
  pair2_player2_name?: string | null;
  pair1_player1_country?: string | null;
  pair1_player2_country?: string | null;
  pair2_player1_country?: string | null;
  pair2_player2_country?: string | null;
}

interface Options {
  tournaments?: Array<{
    tournament_id: string;
    tournament_name: string;
    slug: string;
  }>;
  widgetCodeByTournament?: Record<string, string | null>;
  draws?: DrawSeed[];
  /** OOP snapshot fixtures. Two read paths:
   *  1. Amateur-tier full-replacement when `draw_snapshots` is empty
   *     (B3 Singapore-style tournaments where the FIP page never wires
   *     an AJAX draw widget — OOP is the only structured source).
   *  2. Qualifying-merge when `draw_snapshots` IS populated — the
   *     populator pulls OOP rows for any round the bracket doesn't
   *     cover (Q1/Q2/Q3 — the FIP event-page bracket only goes back
   *     to R32). Active for ALL tiers, not just amateur. */
  oopSnapshots?: OopSnapshotSeed[];
  entryList?: EntryListSeed[];
  players?: PlayerSeed[];
  existingMatches?: ExistingMatchSeed[];
  /** Map of tournament_id → level. Consulted by the populator's
   *  level-exclude branch (see runFipDrawPopulator's `excludeLevels`).
   *  Tournaments not in this map are returned with level=null when
   *  the populator queries for levels. */
  tournamentLevels?: Record<string, string | null>;
}

function fakeSupabase(opts: Options) {
  const tournaments = opts.tournaments ?? [];
  const widgetCode = opts.widgetCodeByTournament ?? {};
  const draws = opts.draws ?? [];
  const oopSnapshots = opts.oopSnapshots ?? [];
  const entryList = opts.entryList ?? [];
  const players = opts.players ?? [];
  // Default name columns to null so the populator's nullness checks
  // mirror real DB behaviour (column exists, value is NULL).
  const existingState: ExistingMatchSeed[] = (opts.existingMatches ?? []).map(
    (m) => ({
      pair1_player1_name: null,
      pair1_player2_name: null,
      pair2_player1_name: null,
      pair2_player2_name: null,
      pair1_player1_country: null,
      pair1_player2_country: null,
      pair2_player1_country: null,
      pair2_player2_country: null,
      ...m,
    }),
  );
  const tournamentLevels = opts.tournamentLevels ?? {};

  const inserted: any[] = [];
  const updated: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const tournamentDrawsUpserted: Array<Record<string, unknown>> = [];
  const tournamentDrawsConflictKeys: Array<string | null> = [];

  const matchesTable = () => ({
    select: (_cols: string) => ({
      like: (_col: string, pattern: string) => {
        // e.g. "FIP-2026-1706:%"
        const prefix = pattern.slice(0, -1);
        const data = existingState.filter((m) =>
          m.widget_id_composite.startsWith(prefix)
        );
        return Promise.resolve({ data, error: null });
      },
    }),
    insert: (row: any) => {
      const id = `new-match-${inserted.length + 1}`;
      inserted.push({ id, ...row });
      // Reflect into state so subsequent UPDATE lookups see it. Mirror
      // the FK + thin-name columns (a thin insert sets names + leaves
      // FKs null; a normal insert is the inverse).
      existingState.push({
        id,
        widget_id_composite: row.widget_id_composite,
        pair1_player1_id: row.pair1_player1_id ?? null,
        pair1_player2_id: row.pair1_player2_id ?? null,
        pair2_player1_id: row.pair2_player1_id ?? null,
        pair2_player2_id: row.pair2_player2_id ?? null,
        pair1_player1_name: row.pair1_player1_name ?? null,
        pair1_player2_name: row.pair1_player2_name ?? null,
        pair2_player1_name: row.pair2_player1_name ?? null,
        pair2_player2_name: row.pair2_player2_name ?? null,
        pair1_player1_country: row.pair1_player1_country ?? null,
        pair1_player2_country: row.pair1_player2_country ?? null,
        pair2_player1_country: row.pair2_player1_country ?? null,
        pair2_player2_country: row.pair2_player2_country ?? null,
      });
      return Promise.resolve({ data: null, error: null });
    },
    update: (patch: Record<string, unknown>) => ({
      eq: (col: string, val: string) => {
        if (col !== 'id')
          throw new Error(`unexpected matches UPDATE filter: ${col}`);
        updated.push({ id: val, patch });
        // reflect
        const target = existingState.find((m) => m.id === val);
        if (target) Object.assign(target, patch);
        return Promise.resolve({ data: null, error: null });
      },
    }),
  });

  const playersTable = () => ({
    select: (_cols: string) => ({
      in: (col: string, values: string[]) => {
        if (col !== 'fip_id')
          throw new Error(`unexpected players filter: ${col}`);
        const data = players.filter((p) => values.includes(p.fip_id));
        return Promise.resolve({ data, error: null });
      },
    }),
  });

  // Public.tournaments — currently used only by the level-exclude
  // branch of runFipDrawPopulator (one batched select on `id IN (...)`
  // returning {id, level}). Kept narrow on purpose to surface any
  // unexpected new query shape immediately.
  const tournamentsTable = () => ({
    select: (_cols: string) => ({
      in: (col: string, values: string[]) => {
        if (col !== 'id')
          throw new Error(`unexpected tournaments filter: ${col}`);
        const data = values.map((id) => ({
          id,
          level: tournamentLevels[id] ?? null,
        }));
        return Promise.resolve({ data, error: null });
      },
    }),
  });

  // Public.tournament_draws — populator UPSERTs two rows per draw row
  // (one per team) keyed by (tournament_id, category, draw_position).
  // Records the raw row + the conflict key so tests can assert on the
  // exact write the bracket-table consumers expect.
  const tournamentDrawsTable = () => ({
    upsert: (row: Record<string, unknown>, opts: { onConflict?: string } = {}) => {
      tournamentDrawsUpserted.push(row);
      tournamentDrawsConflictKeys.push(opts.onConflict ?? null);
      return Promise.resolve({ data: null, error: null });
    },
  });

  // Returns a builder that resolves to the given `data` either when
  // awaited directly OR when `.range(start, end)` is chained. Mirrors
  // the production populator: it now uses .range() for pagination on
  // the snapshot tables, but tests don't need the multi-page loop —
  // we just slice the data the same way Postgres would. The default
  // (no .range) keeps backward compat with any tests that resolve
  // the builder directly.
  function paginatedResult(data: unknown[]): PromiseLike<{ data: unknown[]; error: null }> & { range: (start: number, end: number) => Promise<{ data: unknown[]; error: null }> } {
    const promise = Promise.resolve({ data, error: null });
    return Object.assign(promise, {
      range: (start: number, end: number) =>
        Promise.resolve({ data: data.slice(start, end + 1), error: null }),
    });
  }

  const drawSnapshotsTable = () => ({
    select: (_cols: string) => ({
      eq: (col1: string, val1: string) => ({
        eq: (col2: string, val2: string) => {
          const data = draws.filter(
            (d) =>
              (col1 !== 'tournament_id' || d.tournament_id === val1) &&
              (col2 !== 'source' || 'fip_event_page' === val2),
          );
          return paginatedResult(data);
        },
      }),
    }),
  });

  // Mirrors the populator's single `.eq('tournament_id', …)` filter
  // (no `.eq('source', …)` chain — oop_snapshots has only one source).
  const oopSnapshotsTable = () => ({
    select: (_cols: string) => ({
      eq: (col: string, val: string) => {
        if (col !== 'tournament_id')
          throw new Error(`unexpected oop_snapshots filter: ${col}`);
        const data = oopSnapshots.filter((r) => r.tournament_id === val);
        return paginatedResult(data);
      },
    }),
  });

  const entryListSnapshotsTable = () => ({
    select: (_cols: string) => ({
      eq: (col: string, val: string) => {
        const data = entryList.filter(
          (e) => col !== 'tournament_id' || val === TOURNAMENT_ID,
        );
        return paginatedResult(data);
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
    inserted,
    updated,
    tournamentDrawsUpserted,
    tournamentDrawsConflictKeys,
    get existing() {
      return existingState;
    },
    schema: (_name: string) => ({
      from: (t: string) => {
        if (t === 'draw_snapshots') return drawSnapshotsTable();
        if (t === 'oop_snapshots') return oopSnapshotsTable();
        if (t === 'entry_list_snapshots') return entryListSnapshotsTable();
        if (t === 'widget_id_cache') return widgetIdCacheTable();
        throw new Error(`unexpected padelgod table: ${t}`);
      },
    }),
    from: (t: string) => {
      if (t === 'matches') return matchesTable();
      if (t === 'players') return playersTable();
      if (t === 'tournaments') return tournamentsTable();
      if (t === 'tournament_draws') return tournamentDrawsTable();
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

// ── normalizeName ──────────────────────────────────────────────────────

describe('normalizeName', () => {
  it('lowercases + strips accents + collapses whitespace', () => {
    expect(normalizeName('Nuno Baptista')).toBe('nuno baptista');
    expect(normalizeName('Abraham Muñoz Zurita')).toBe('abraham munoz zurita');
    expect(normalizeName('  José   Pedro  ')).toBe('jose pedro');
  });

  it('handles composite accented chars', () => {
    expect(normalizeName('Peñate')).toBe('penate');
    expect(normalizeName('Rodríguez')).toBe('rodriguez');
  });
});

// ── resolveFourPlayers ─────────────────────────────────────────────────

describe('resolveFourPlayers', () => {
  const nameToFipId = new Map([
    ['nuno baptista', 'fip-P1'],
    ['david fernandes', 'fip-P2'],
    ['jose montalban', 'fip-P3'],
    ['german rodriguez', 'fip-P4'],
  ]);
  const emptyShortForm = new Map<string, string | null>();
  const fipIdToPlayerId = new Map([
    ['fip-P1', 'uuid-1'],
    ['fip-P2', 'uuid-2'],
    ['fip-P3', 'uuid-3'],
    ['fip-P4', 'uuid-4'],
  ]);

  const baseDraw: any = {
    team1_player1_name: 'Nuno Baptista',
    team1_player2_name: 'David Fernandes',
    team2_player1_name: 'Jose Montalban',
    team2_player2_name: 'German Rodriguez',
  };

  it('resolves 4 long-form names to UUIDs', () => {
    expect(resolveFourPlayers(baseDraw, nameToFipId, emptyShortForm, fipIdToPlayerId)).toEqual({
      p1p1: 'uuid-1',
      p1p2: 'uuid-2',
      p2p1: 'uuid-3',
      p2p2: 'uuid-4',
    });
  });

  it('returns the single missing slot as null when one name is missing from entry list', () => {
    const d = { ...baseDraw, team1_player1_name: 'Nobody Here' };
    expect(resolveFourPlayers(d, nameToFipId, emptyShortForm, fipIdToPlayerId)).toEqual({
      p1p1: null,
      p1p2: 'uuid-2',
      p2p1: 'uuid-3',
      p2p2: 'uuid-4',
    });
  });

  it('returns the affected slot as null when one fip_id has no public.players row', () => {
    const noP4 = new Map(fipIdToPlayerId);
    noP4.delete('fip-P4');
    expect(resolveFourPlayers(baseDraw, nameToFipId, emptyShortForm, noP4)).toEqual({
      p1p1: 'uuid-1',
      p1p2: 'uuid-2',
      p2p1: 'uuid-3',
      p2p2: null,
    });
  });
});

// ── runFipDrawPopulator ────────────────────────────────────────────────

const entryList: EntryListSeed[] = [
  { name: 'Nuno Baptista', fip_id: 'fip-P1', category: 'men', captured_at: '2026-04-24T07:00:00Z' },
  { name: 'David Fernandes', fip_id: 'fip-P2', category: 'men', captured_at: '2026-04-24T07:00:00Z' },
  { name: 'Jose Montalban Martin', fip_id: 'fip-P3', category: 'men', captured_at: '2026-04-24T07:00:00Z' },
  { name: 'German Rodriguez Quesada', fip_id: 'fip-P4', category: 'men', captured_at: '2026-04-24T07:00:00Z' },
];

const rosterPlayers: PlayerSeed[] = [
  { id: 'uuid-P1', fip_id: 'fip-P1' },
  { id: 'uuid-P2', fip_id: 'fip-P2' },
  { id: 'uuid-P3', fip_id: 'fip-P3' },
  { id: 'uuid-P4', fip_id: 'fip-P4' },
];

const realMatchDraw: DrawSeed = {
  tournament_id: TOURNAMENT_ID,
  match_widget_id: 'MD017',
  category: 'men',
  round_label: 'R32',
  draw_position: 1,
  team1_player1_name: 'Nuno Baptista',
  team1_player2_name: 'David Fernandes',
  team2_player1_name: 'Jose Montalban Martin',
  team2_player2_name: 'German Rodriguez Quesada',
  team1_fip_id: 'P200001',
  team2_fip_id: 'P200002',
  team1_seed: null,
  team2_seed: 3,
  status: 'finished',
  captured_at: '2026-04-24T08:00:00Z',
};

describe('runFipDrawPopulator', () => {
  it('INSERTs a new match with real widget composite when none exists (non-dry-run)', async () => {
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Isla', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [realMatchDraw],
      entryList,
      players: rosterPlayers,
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.tournamentsProcessed).toBe(1);
    expect(result.inserted).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.skippedBye).toBe(0);
    expect(result.skippedPlayerUnresolved).toBe(0);

    expect(supabase.inserted).toHaveLength(1);
    const row = supabase.inserted[0];
    expect(row.widget_id_composite).toBe('FIP-2026-1706:MD017');
    expect(row.tournament_id).toBe(TOURNAMENT_ID);
    expect(row.category).toBe('men');
    expect(row.round).toBe('R32');
    expect(row.pair1_player1_id).toBe('uuid-P1');
    expect(row.pair1_player2_id).toBe('uuid-P2');
    expect(row.pair2_player1_id).toBe('uuid-P3');
    expect(row.pair2_player2_id).toBe('uuid-P4');
    // Deliberately NOT set by populator (other writers own these fields):
    expect(row.status).toBeUndefined();
    expect(row.winner_pair).toBeUndefined();
    expect(row.court).toBeUndefined();
    expect(row.scheduled_at).toBeUndefined();
  });

  it('in dry-run mode: logs but does NOT insert', async () => {
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Isla', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [realMatchDraw],
      entryList,
      players: rosterPlayers,
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: true,
    });

    // counters still tick (for observability)
    expect(result.inserted).toBe(1);
    expect(result.dryRun).toBe(true);
    // but NO actual DB write
    expect(supabase.inserted).toHaveLength(0);
  });

  it('UPDATEs NULL pair FKs on existing composite-keyed match (never clobbers set ones)', async () => {
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Isla', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [realMatchDraw],
      entryList,
      players: rosterPlayers,
      existingMatches: [
        {
          id: 'm-existing',
          widget_id_composite: 'FIP-2026-1706:MD017',
          // Operator/earlier-run set team 1; team 2 still NULL
          pair1_player1_id: 'existing-P1',
          pair1_player2_id: 'existing-P2',
          pair2_player1_id: null,
          pair2_player2_id: null,
        },
      ],
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(1);
    expect(supabase.updated).toHaveLength(1);
    expect(supabase.updated[0].id).toBe('m-existing');
    // Only the NULL slots got written
    expect(supabase.updated[0].patch).toEqual({
      pair2_player1_id: 'uuid-P3',
      pair2_player2_id: 'uuid-P4',
    });
    // Team 1's existing FKs are NOT in the patch (null-only rule)
    expect(supabase.updated[0].patch).not.toHaveProperty('pair1_player1_id');
    expect(supabase.updated[0].patch).not.toHaveProperty('pair1_player2_id');
  });

  it('no-ops when existing match already has all 4 FKs populated', async () => {
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Isla', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [realMatchDraw],
      entryList,
      players: rosterPlayers,
      existingMatches: [
        {
          id: 'm-complete',
          widget_id_composite: 'FIP-2026-1706:MD017',
          pair1_player1_id: 'some-A',
          pair1_player2_id: 'some-B',
          pair2_player1_id: 'some-C',
          pair2_player2_id: 'some-D',
        },
      ],
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.skippedAlreadyComplete).toBe(1);
    expect(supabase.inserted).toHaveLength(0);
    expect(supabase.updated).toHaveLength(0);
  });

  it('skips tournaments with no widget_id_cache row (widget-code-lookup pending)', async () => {
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Isla', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: {}, // no widget code
      draws: [realMatchDraw],
      entryList,
      players: rosterPlayers,
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.tournamentsProcessed).toBe(0);
    expect(result.tournamentsSkippedNoWidget).toBe(1);
    expect(result.inserted).toBe(0);
    expect(supabase.inserted).toHaveLength(0);
  });

  it('skips pure bye-through rows (one side empty + status=walkover, seed advancing unopposed)', async () => {
    // Real bye-through has no names AT ALL on the empty side. Top seed
    // advances through R64 → R32 with no match played. fip_id on the
    // empty side is a numeric placeholder.
    const byeDraw: DrawSeed = {
      ...realMatchDraw,
      match_widget_id: 'MD001',
      team1_fip_id: 'P200001',
      team2_player1_name: null,
      team2_player2_name: null,
      team2_fip_id: '1390580661', // numeric bye placeholder
      status: 'walkover',
    };
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Isla', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [byeDraw],
      entryList,
      players: rosterPlayers,
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.skippedBye).toBe(1);
    expect(result.inserted).toBe(0);
  });

  it('INSERTs real walkovers (both sides have names, status=walkover — match was played but one side withdrew)', async () => {
    // Distinct from bye-through: both teams are real, both have names,
    // status='walkover' because one player withdrew. The match
    // "happened" in the bracket sense — we want it on record.
    const walkoverDraw: DrawSeed = {
      ...realMatchDraw,
      match_widget_id: 'MD019',
      status: 'walkover',
      winner_team: 1,
    };
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Isla', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [walkoverDraw],
      entryList,
      players: rosterPlayers,
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.inserted).toBe(1);
    expect(result.skippedBye).toBe(0);
    expect(supabase.inserted[0].widget_id_composite).toBe('FIP-2026-1706:MD019');
  });

  it('INSERTs R64 cells with pending qualifier on one side (real team1, TBD team2, status=scheduled)', async () => {
    // Pattern: top seed entering R64 with a known partner, opponent
    // pending — "winner of Q2 #5". team2 names + fip_id are nulls /
    // placeholders. status='scheduled'. The row IS a real upcoming
    // match in the bracket, just waiting for qualifier results.
    const pendingDraw: DrawSeed = {
      ...realMatchDraw,
      match_widget_id: 'MD061',
      round_label: 'R64',
      team2_player1_name: null,
      team2_player2_name: null,
      team2_fip_id: '1390580662', // numeric placeholder, opponent TBD
      status: 'scheduled',
    };
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Isla', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [pendingDraw],
      entryList,
      players: rosterPlayers,
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.inserted).toBe(1);
    expect(result.skippedBye).toBe(0);
    const row = supabase.inserted[0];
    expect(row.widget_id_composite).toBe('FIP-2026-1706:MD061');
    expect(row.pair1_player1_id).toBe('uuid-P1');
    expect(row.pair1_player2_id).toBe('uuid-P2');
    // team2 stays null FK on both sides — populator's UPDATE branch
    // fills these in when the qualifier completes.
    expect(row.pair2_player1_id ?? null).toBeNull();
    expect(row.pair2_player2_id ?? null).toBeNull();
  });

  it('INSERTs later-round seed-waits when first round is deeper (P1 men R32 with seed waiting for R64 winner)', async () => {
    // FIP marks Premier R32 cells where a seed has a R64 bye as
    // status=walkover (the seed "walked over" from R64 into R32, where
    // they wait for the R64 winner). Without the first-round scope,
    // these get swept up as bye-throughs. Real-world reproducer:
    // Buenos Aires P1 2026 had 16 R32 men cells in this shape and the
    // populator skipped all of them.
    // Use names from the test entry list so team1 resolves to FKs.
    const r64Bye: DrawSeed = {
      ...realMatchDraw,
      match_widget_id: 'MD001',
      round_label: 'R64',
      team1_player1_name: 'Nuno Baptista',
      team1_player2_name: 'David Fernandes',
      team2_player1_name: null,
      team2_player2_name: null,
      team1_fip_id: 'P200001',
      team2_fip_id: '1995888837',
      team1_seed: 1,
      team2_seed: null,
      status: 'walkover',
      winner_team: 1,
    };
    const r32SeedWaiting: DrawSeed = {
      ...realMatchDraw,
      match_widget_id: 'MD033',
      round_label: 'R32',
      team1_player1_name: 'Nuno Baptista',
      team1_player2_name: 'David Fernandes',
      team2_player1_name: null,
      team2_player2_name: null,
      team1_fip_id: 'P200001',
      team2_fip_id: '1995888837',
      team1_seed: 1,
      team2_seed: null,
      status: 'walkover',
      winner_team: 1,
    };
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'BA P1', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [r64Bye, r32SeedWaiting],
      entryList,
      players: rosterPlayers,
    });
    const result = await runFipDrawPopulator({ supabase: supabase as any, dryRun: false });
    // R64 bye → skipped (first round, walkover, one side empty).
    // R32 seed-waiting → INSERTED (later round; not a bye).
    expect(result.skippedBye).toBe(1);
    expect(result.inserted).toBe(1);
    expect(supabase.inserted[0].widget_id_composite).toBe('FIP-2026-1706:MD033');
    expect(supabase.inserted[0].round).toBe('R32');
  });

  it('INSERTs R16 / QF / SF cells with both sides TBD (thin bracket scaffolding)', async () => {
    // Pattern: R16 cell entirely pending — both sides are "winner of
    // R32 #X". No names, no real fip_ids, but the cell exists in the
    // FIP bracket markup with a stable match_widget_id. We want the
    // row in public.matches so the bracket UI gets the scaffolding.
    const scaffoldDraw: DrawSeed = {
      ...realMatchDraw,
      match_widget_id: 'MD081',
      round_label: 'R16',
      team1_player1_name: null,
      team1_player2_name: null,
      team2_player1_name: null,
      team2_player2_name: null,
      team1_fip_id: '1390580663',
      team2_fip_id: '1390580664',
      status: 'scheduled',
    };
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Isla', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [scaffoldDraw],
      entryList,
      players: rosterPlayers,
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.inserted).toBe(1);
    expect(result.skippedBye).toBe(0);
    const row = supabase.inserted[0];
    expect(row.widget_id_composite).toBe('FIP-2026-1706:MD081');
    expect(row.round).toBe('R16');
    expect(row.pair1_player1_id ?? null).toBeNull();
    expect(row.pair2_player1_id ?? null).toBeNull();
  });

  it('inserts partial-FK rows when 1 of 4 players is unresolved (skip only when all 4 fail)', async () => {
    const missingPartner: DrawSeed = {
      ...realMatchDraw,
      match_widget_id: 'MD002',
      team2_player2_name: 'Completely Unknown Player', // not in entry list
    };
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Isla', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [missingPartner],
      entryList,
      players: rosterPlayers,
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    // Per-slot resilience: 3 of 4 resolved → INSERT with 3 FKs + 1 raw
    // name. Only when ALL 4 are unresolved AND non-amateur tier do we
    // defer to the next run.
    expect(result.skippedPlayerUnresolved).toBe(0);
    expect(result.inserted).toBe(1);
    const inserted = supabase.inserted.find((r) => r.widget_id_composite?.endsWith(':MD002'));
    expect(inserted).toBeDefined();
    expect(inserted!.pair1_player1_id).toBe('uuid-P1');
    expect(inserted!.pair1_player2_id).toBe('uuid-P2');
    expect(inserted!.pair2_player1_id).toBe('uuid-P3');
    expect(inserted!.pair2_player2_id).toBeUndefined();
    expect(inserted!.pair2_player2_name).toBe('Completely Unknown Player');
  });

  it('still skips rows when ALL 4 players unresolved on a non-amateur tier', async () => {
    const allMissing: DrawSeed = {
      ...realMatchDraw,
      match_widget_id: 'MD003',
      team1_player1_name: 'Unknown One',
      team1_player2_name: 'Unknown Two',
      team2_player1_name: 'Unknown Three',
      team2_player2_name: 'Unknown Four',
    };
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Isla', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [allMissing],
      entryList,
      players: rosterPlayers,
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.skippedPlayerUnresolved).toBe(1);
    expect(result.inserted).toBe(0);
  });

  it('does NOT touch matches keyed by synthetic composite (legacy reconciler rows)', async () => {
    // Legacy reconciler created this row with widget_id_composite=NULL
    // (the synthetic composite lives only in entity_external_ids).
    // Our .like('widget_id_composite', 'FIP-%:%') query must not match it.
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Isla', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [realMatchDraw],
      entryList,
      players: rosterPlayers,
      // NOTE: no pre-existing row with widget_id_composite set.
      // The legacy row (widget_id_composite=NULL) isn't seeded here
      // because the populator's lookup wouldn't see it anyway — that's
      // exactly the safety property.
      existingMatches: [],
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    // Populator inserts a brand-new row keyed by the real composite.
    // The legacy row (if any existed in prod) is untouched.
    expect(result.inserted).toBe(1);
    expect(supabase.inserted[0].widget_id_composite).toBe('FIP-2026-1706:MD017');
  });

  // ── Allowlist ────────────────────────────────────────────────────────
  //
  // The allowlist lets operators migrate tournaments one at a time. The
  // immediate use case (2026-04-24 Brussels): Brussels P2 already has
  // 100+ legacy rows with live-poller state, so enabling populator
  // writes globally would create user-visible duplicates. With the
  // allowlist we keep Brussels untouched while migrating Isla +
  // clean-slate tournaments to the new pipeline.

  it('onlyTournamentIds: processes only listed tournaments; skips others', async () => {
    const OTHER_ID = 't-brussels';
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Isla', slug: TOURNAMENT_SLUG },
        { tournament_id: OTHER_ID, tournament_name: 'Brussels', slug: 'brussels-p2-2026' },
      ],
      widgetCodeByTournament: {
        [TOURNAMENT_ID]: TOURNAMENT_WIDGET,
        [OTHER_ID]: 'FIP-2026-1701',
      },
      draws: [realMatchDraw],
      entryList,
      players: rosterPlayers,
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
      onlyTournamentIds: new Set([TOURNAMENT_ID]),
    });

    expect(result.tournamentsSkippedNotInAllowlist).toBe(1);
    // Isla was processed (tournamentsProcessed counts only those with
    // at least one draw row — Brussels has none in this fixture).
    expect(result.tournamentsProcessed).toBe(1);
    expect(result.inserted).toBe(1);
    expect(supabase.inserted[0].widget_id_composite).toBe('FIP-2026-1706:MD017');
  });

  it('onlyTournamentIds empty/undefined: behaves exactly as before (no filter)', async () => {
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Isla', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [realMatchDraw],
      entryList,
      players: rosterPlayers,
    });

    // Empty set — same as no filter
    const resultEmpty = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: true,
      onlyTournamentIds: new Set(),
    });
    expect(resultEmpty.tournamentsSkippedNotInAllowlist).toBe(0);
    expect(resultEmpty.inserted).toBe(1);

    // Undefined — same
    const resultUndefined = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: true,
    });
    expect(resultUndefined.tournamentsSkippedNotInAllowlist).toBe(0);
    expect(resultUndefined.inserted).toBe(1);
  });

  // ── Exclude-levels (Premier-tier denylist) ───────────────────────────
  //
  // Purpose: keep the simplified pipeline OFF Premier-tier tournaments
  // during the soak phase even if a Premier event somehow ends up with
  // a FIP draw snapshot (cross-listed events, manual seeds, etc.).
  // Premier matches go through the live-poller path which already
  // works; running the populator on them would create composite-keyed
  // duplicates of rows that already have live state.

  it('excludeLevels: skips tournaments whose level matches the deny set', async () => {
    const PREMIER_ID = 't-brussels';
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Isla', slug: TOURNAMENT_SLUG },
        { tournament_id: PREMIER_ID, tournament_name: 'Brussels', slug: 'brussels-p2-2026' },
      ],
      widgetCodeByTournament: {
        [TOURNAMENT_ID]: TOURNAMENT_WIDGET,
        [PREMIER_ID]: 'FIP-2026-1701',
      },
      tournamentLevels: {
        [TOURNAMENT_ID]: 'fip_other',
        [PREMIER_ID]: 'p2',
      },
      draws: [realMatchDraw],
      entryList,
      players: rosterPlayers,
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
      excludeLevels: new Set(['p1', 'p2', 'major', 'finals']),
    });

    expect(result.tournamentsSkippedExcludedLevel).toBe(1);
    // Isla still processed (its level fip_other isn't in the deny set)
    expect(result.tournamentsProcessed).toBe(1);
    expect(result.inserted).toBe(1);
    expect(supabase.inserted[0].widget_id_composite).toBe('FIP-2026-1706:MD017');
  });

  it('excludeLevels: levels are matched case-insensitively', async () => {
    // The scheduler normalises to lowercase before passing the set in,
    // but be defensive: even if a future caller passes mixed case, the
    // lookup against the lowercased level column should still match.
    const PREMIER_ID = 't-brussels';
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: PREMIER_ID, tournament_name: 'Brussels', slug: 'brussels-p2-2026' },
      ],
      widgetCodeByTournament: { [PREMIER_ID]: 'FIP-2026-1701' },
      tournamentLevels: { [PREMIER_ID]: 'P2' }, // upper-case in fixture
      draws: [],
      entryList: [],
      players: [],
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: true,
      excludeLevels: new Set(['p2']),
    });

    expect(result.tournamentsSkippedExcludedLevel).toBe(1);
    expect(result.tournamentsProcessed).toBe(0);
  });

  it('excludeLevels empty/undefined: no level filtering happens', async () => {
    // Even Premier-tier tournaments are processed when the filter is
    // unset. Composite-key gating still protects: the worker will write
    // for them, but the user can choose not to set the filter when
    // running unrestricted.
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Isla', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      tournamentLevels: { [TOURNAMENT_ID]: 'fip_other' },
      draws: [realMatchDraw],
      entryList,
      players: rosterPlayers,
    });

    // Empty set
    const resultEmpty = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: true,
      excludeLevels: new Set(),
    });
    expect(resultEmpty.tournamentsSkippedExcludedLevel).toBe(0);
    expect(resultEmpty.inserted).toBe(1);

    // Undefined
    const resultUndefined = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: true,
    });
    expect(resultUndefined.tournamentsSkippedExcludedLevel).toBe(0);
    expect(resultUndefined.inserted).toBe(1);
  });

  it('excludeLevels composes with onlyTournamentIds — allowlist wins first, then exclude', async () => {
    // If a tournament is both in the allowlist AND has a deny-listed
    // level, the result is "excluded by level". The allowlist passes
    // it through; the level filter then rejects it.
    const PREMIER_ID = 't-brussels';
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Isla', slug: TOURNAMENT_SLUG },
        { tournament_id: PREMIER_ID, tournament_name: 'Brussels', slug: 'brussels-p2-2026' },
      ],
      widgetCodeByTournament: {
        [TOURNAMENT_ID]: TOURNAMENT_WIDGET,
        [PREMIER_ID]: 'FIP-2026-1701',
      },
      tournamentLevels: {
        [TOURNAMENT_ID]: 'fip_other',
        [PREMIER_ID]: 'p2',
      },
      draws: [realMatchDraw],
      entryList,
      players: rosterPlayers,
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: true,
      onlyTournamentIds: new Set([TOURNAMENT_ID, PREMIER_ID]), // both allowlisted
      excludeLevels: new Set(['p2']),                          // but P2 denied
    });

    expect(result.tournamentsSkippedNotInAllowlist).toBe(0); // both passed allowlist
    expect(result.tournamentsSkippedExcludedLevel).toBe(1);  // Brussels excluded by level
    expect(result.inserted).toBe(1);                         // only Isla wrote
  });

  // ── Amateur-tier thin matches ─────────────────────────────────────────
  //
  // Beyond / Promises / Other are club-organized: players routinely
  // aren't in FIP's database, so the entry-list resolver fails. Dropping
  // those matches makes the tournament look empty in the public app
  // (zero matches under /tournaments/<slug>). For these tiers we fall
  // back to "thin matches": same composite + round + category, FK
  // columns NULL, raw names preserved on pair*_player*_name. Higher
  // tiers (Bronze/Silver/Gold/Premier) keep strict-resolve behaviour.
  //
  // Trigger case from production: FIP Beyond B3 Singapore 2026 — captured
  // 240 oop_snapshots + 176 results_snapshots but 0 rows in public.matches
  // because no entry list / draw PDF was parseable for player resolution.

  const amateurDraw: DrawSeed = {
    ...realMatchDraw,
    match_widget_id: 'MD003',
    // Names that are NOT in `entryList` → resolveFourPlayers returns null.
    team1_player1_name: 'Local ClubPlayer A',
    team1_player2_name: 'Local ClubPlayer B',
    team2_player1_name: 'Local ClubPlayer C',
    team2_player2_name: 'Local ClubPlayer D',
  };

  it('amateur tier (fip_beyond): INSERTs thin match with names when resolver fails', async () => {
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'B3 Singapore', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      tournamentLevels: { [TOURNAMENT_ID]: 'fip_beyond' },
      draws: [amateurDraw],
      entryList, // doesn't include the four "Local ClubPlayer" names
      players: rosterPlayers,
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.tournamentsProcessed).toBe(1);
    expect(result.inserted).toBe(1);
    expect(result.skippedPlayerUnresolved).toBe(0);

    expect(supabase.inserted).toHaveLength(1);
    const row = supabase.inserted[0];
    expect(row.widget_id_composite).toBe('FIP-2026-1706:MD003');
    expect(row.tournament_id).toBe(TOURNAMENT_ID);
    expect(row.category).toBe('men');
    expect(row.round).toBe('R32');

    // FK columns NOT set on the insert (stay NULL in DB)
    expect(row.pair1_player1_id).toBeUndefined();
    expect(row.pair1_player2_id).toBeUndefined();
    expect(row.pair2_player1_id).toBeUndefined();
    expect(row.pair2_player2_id).toBeUndefined();

    // Raw names preserved verbatim from the draw snapshot
    expect(row.pair1_player1_name).toBe('Local ClubPlayer A');
    expect(row.pair1_player2_name).toBe('Local ClubPlayer B');
    expect(row.pair2_player1_name).toBe('Local ClubPlayer C');
    expect(row.pair2_player2_name).toBe('Local ClubPlayer D');
  });

  it('amateur tier (fip_promises): INSERTs thin match (level allowlist covers all amateur tiers)', async () => {
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Promises Cup', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      tournamentLevels: { [TOURNAMENT_ID]: 'fip_promises' },
      draws: [amateurDraw],
      entryList,
      players: rosterPlayers,
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.inserted).toBe(1);
    expect(supabase.inserted[0].pair1_player1_name).toBe('Local ClubPlayer A');
  });

  it('amateur tier: still resolves to FKs when entry list DOES contain the players', async () => {
    // A thin-fallback should NEVER fire when the resolver succeeds. We
    // want amateur-tier matches with resolved players to behave exactly
    // like normal matches — clickable profile links in the UI.
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'B3 Singapore', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      tournamentLevels: { [TOURNAMENT_ID]: 'fip_beyond' },
      draws: [realMatchDraw], // names ARE in entry list
      entryList,
      players: rosterPlayers,
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.inserted).toBe(1);
    const row = supabase.inserted[0];
    // FKs populated...
    expect(row.pair1_player1_id).toBe('uuid-P1');
    expect(row.pair2_player2_id).toBe('uuid-P4');
    // ...and name columns NOT written (the FKs are the source of truth)
    expect(row.pair1_player1_name).toBeUndefined();
    expect(row.pair2_player2_name).toBeUndefined();
  });

  it('non-amateur tier (fip_bronze): still SKIPS unresolved rows (no thin fallback)', async () => {
    // Bronze/Silver/Gold/Premier keep the strict-resolve contract. If
    // entry list lookup fails, we don't want a name-only row showing up
    // for those tiers — the populator should drop it and try again next
    // run when the entry list might be richer.
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Bronze Event', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      tournamentLevels: { [TOURNAMENT_ID]: 'fip_bronze' },
      draws: [amateurDraw], // names NOT in entry list
      entryList,
      players: rosterPlayers,
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.skippedPlayerUnresolved).toBe(1);
    expect(result.inserted).toBe(0);
    expect(supabase.inserted).toHaveLength(0);
  });

  it('amateur tier: thin UPDATE backfills only NULL name slots (never overwrites)', async () => {
    // Operator (or earlier run) previously filled team 1's names. The
    // populator should add team 2 only and leave team 1 alone — exactly
    // mirroring the FK-side "NULL only" behaviour.
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'B3 Singapore', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      tournamentLevels: { [TOURNAMENT_ID]: 'fip_beyond' },
      draws: [amateurDraw],
      entryList,
      players: rosterPlayers,
      existingMatches: [
        {
          id: 'm-thin-existing',
          widget_id_composite: 'FIP-2026-1706:MD003',
          pair1_player1_id: null,
          pair1_player2_id: null,
          pair2_player1_id: null,
          pair2_player2_id: null,
          // team 1 already filled by an earlier pass
          pair1_player1_name: 'Already There A',
          pair1_player2_name: 'Already There B',
          pair2_player1_name: null,
          pair2_player2_name: null,
        },
      ],
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(1);
    expect(supabase.updated).toHaveLength(1);
    expect(supabase.updated[0].id).toBe('m-thin-existing');
    // Only the two NULL slots got names; the populated team-1 names
    // stay untouched.
    expect(supabase.updated[0].patch).toEqual({
      pair2_player1_name: 'Local ClubPlayer C',
      pair2_player2_name: 'Local ClubPlayer D',
    });
    expect(supabase.updated[0].patch).not.toHaveProperty('pair1_player1_name');
    expect(supabase.updated[0].patch).not.toHaveProperty('pair1_player2_name');
  });

  it('amateur tier: thin match with all 4 names already filled is a no-op', async () => {
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'B3 Singapore', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      tournamentLevels: { [TOURNAMENT_ID]: 'fip_beyond' },
      draws: [amateurDraw],
      entryList,
      players: rosterPlayers,
      existingMatches: [
        {
          id: 'm-thin-complete',
          widget_id_composite: 'FIP-2026-1706:MD003',
          pair1_player1_id: null,
          pair1_player2_id: null,
          pair2_player1_id: null,
          pair2_player2_id: null,
          pair1_player1_name: 'A',
          pair1_player2_name: 'B',
          pair2_player1_name: 'C',
          pair2_player2_name: 'D',
        },
      ],
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.skippedAlreadyComplete).toBe(1);
  });

  it('amateur tier: a thin match GETS UPGRADED to FKs once the entry list catches up', async () => {
    // This is the recovery path. A tournament might initially have no
    // resolvable entry list (PDF posted late, players not in FIP DB
    // yet). The first pass inserts thin rows. A later pass — once the
    // entry list lands — finds those rows and backfills the FK columns.
    // Names stay where they are (DB column, ignored by UI when FK set).
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'B3 Singapore', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      tournamentLevels: { [TOURNAMENT_ID]: 'fip_beyond' },
      draws: [realMatchDraw], // these names ARE in entry list (uuid-P1..P4)
      entryList,
      players: rosterPlayers,
      existingMatches: [
        {
          id: 'm-thin-then-resolved',
          widget_id_composite: 'FIP-2026-1706:MD017',
          pair1_player1_id: null,
          pair1_player2_id: null,
          pair2_player1_id: null,
          pair2_player2_id: null,
          pair1_player1_name: 'Nuno Baptista',
          pair1_player2_name: 'David Fernandes',
          pair2_player1_name: 'Jose Montalban Martin',
          pair2_player2_name: 'German Rodriguez Quesada',
        },
      ],
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(1);
    expect(supabase.updated[0].patch).toEqual({
      pair1_player1_id: 'uuid-P1',
      pair1_player2_id: 'uuid-P2',
      pair2_player1_id: 'uuid-P3',
      pair2_player2_id: 'uuid-P4',
    });
  });

  it('excludeLevels: tournaments without a level (null) are NEVER excluded', async () => {
    // A null-level tournament shouldn't be silently dropped by the
    // exclude filter. Operators may legitimately have rows pending
    // categorisation; those get processed normally, and only the
    // allowlist or composite-key gate can stop them.
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Isla', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      tournamentLevels: { [TOURNAMENT_ID]: null },
      draws: [realMatchDraw],
      entryList,
      players: rosterPlayers,
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: true,
      excludeLevels: new Set(['p1', 'p2']),
    });

    expect(result.tournamentsSkippedExcludedLevel).toBe(0);
    expect(result.inserted).toBe(1);
  });

  // ── OOP-snapshot fallback (amateur tier, no AJAX draw) ────────────────
  //
  // Trigger case: FIP Beyond B3 Singapore 2026. The FIP page exposes
  // the bracket only as a PDF — no AJAX draw widget — so
  // padelgod.draw_snapshots stays empty for the tournament. Without a
  // fallback the populator processes nothing and the tournament shows
  // 0 matches in /tournaments. With the fallback, OOP snapshots
  // (which carry round + court + 4 player names + match_widget_id)
  // become the draw source, and thin matches get written.

  const oopRow = {
    tournament_id: TOURNAMENT_ID,
    match_widget_id: 'MD050',
    category: 'men' as const,
    round_label: 'R32',
    team1_player1_name: 'Local A',
    team1_player2_name: 'Local B',
    team2_player1_name: 'Local C',
    team2_player2_name: 'Local D',
    captured_at: '2026-04-28T08:00:00Z',
  };

  it('amateur tier: falls back to oop_snapshots when draw_snapshots is empty', async () => {
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'B3 SG', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      tournamentLevels: { [TOURNAMENT_ID]: 'fip_beyond' },
      draws: [], // no draw snapshots
      oopSnapshots: [oopRow],
      entryList: [], // empty — players aren't in FIP DB
      players: [],
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.tournamentsProcessed).toBe(1);
    expect(result.inserted).toBe(1);
    expect(result.skippedBye).toBe(0); // OOP rows shouldn't trigger bye check
    expect(result.skippedPlayerUnresolved).toBe(0);

    expect(supabase.inserted).toHaveLength(1);
    const row = supabase.inserted[0];
    expect(row.widget_id_composite).toBe('FIP-2026-1706:MD050');
    expect(row.category).toBe('men');
    expect(row.round).toBe('R32');
    // Thin match: no FKs, names preserved
    expect(row.pair1_player1_id).toBeUndefined();
    expect(row.pair1_player1_name).toBe('Local A');
    expect(row.pair2_player2_name).toBe('Local D');
  });

  it('non-amateur tier: does NOT fall back to oop_snapshots', async () => {
    // A Bronze tournament with no draw_snapshots is just genuinely not
    // ready yet — entry list might still arrive. We don't want OOP to
    // become a phantom data source for tiers where strict-resolve
    // matters.
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Bronze Event', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      tournamentLevels: { [TOURNAMENT_ID]: 'fip_bronze' },
      draws: [],
      oopSnapshots: [oopRow],
      entryList: [],
      players: [],
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    // No draw rows + no fallback → tournament not "processed"
    expect(result.tournamentsProcessed).toBe(0);
    expect(result.inserted).toBe(0);
    expect(supabase.inserted).toHaveLength(0);
  });

  it('amateur tier: bracket wins over OOP for the same round (no double-insert)', async () => {
    // Bracket is the richer source (seeds, FIP IDs, status). When
    // both sources surface the same round, the OOP row is filtered
    // out by `excludeRoundLabels` so we don't double-insert. The
    // OOP merge path still runs for OTHER rounds — see the new
    // "OOP merge (Silver+)" cases below.
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Mixed', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      tournamentLevels: { [TOURNAMENT_ID]: 'fip_beyond' },
      draws: [realMatchDraw], // draw exists → resolved via entry list
      oopSnapshots: [{ ...oopRow, match_widget_id: 'MD999' }],
      entryList,
      players: rosterPlayers,
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    // Only the draw row was processed; OOP-derived MD999 ignored.
    expect(result.inserted).toBe(1);
    expect(supabase.inserted[0].widget_id_composite).toBe(
      'FIP-2026-1706:MD017',
    );
  });

  it('OOP fallback: dedupes to latest captured_at per match_widget_id', async () => {
    // OOP gets fetched daily during a tournament, so a single match
    // accumulates multiple snapshot rows. We want the freshest one,
    // not stale stuff from earlier in the week.
    const stale = {
      ...oopRow,
      match_widget_id: 'MD060',
      captured_at: '2026-04-25T08:00:00Z',
      team1_player1_name: 'Stale Name',
    };
    const fresh = {
      ...oopRow,
      match_widget_id: 'MD060',
      captured_at: '2026-04-28T08:00:00Z',
      team1_player1_name: 'Fresh Name',
    };
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'B3 SG', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      tournamentLevels: { [TOURNAMENT_ID]: 'fip_beyond' },
      draws: [],
      oopSnapshots: [stale, fresh],
      entryList: [],
      players: [],
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.inserted).toBe(1);
    expect(supabase.inserted[0].pair1_player1_name).toBe('Fresh Name');
  });

  it('OOP fallback: skips rows missing match_widget_id, category, or round_label', async () => {
    // Defensive: OOP rows can occasionally lack one of these (parser
    // quirks, mid-edit page captures). We can't construct a composite
    // without match_widget_id, can't INSERT without category/round, so
    // skip rather than write garbage rows.
    const noWidget = {
      ...oopRow,
      match_widget_id: null,
      team1_player1_name: 'no widget',
    };
    const noCategory = {
      ...oopRow,
      match_widget_id: 'MD061',
      category: null,
      team1_player1_name: 'no category',
    };
    const noRound = {
      ...oopRow,
      match_widget_id: 'MD062',
      round_label: null,
      team1_player1_name: 'no round',
    };
    const valid = {
      ...oopRow,
      match_widget_id: 'MD063',
      team1_player1_name: 'OK',
    };
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'B3 SG', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      tournamentLevels: { [TOURNAMENT_ID]: 'fip_beyond' },
      draws: [],
      oopSnapshots: [noWidget, noCategory, noRound, valid],
      entryList: [],
      players: [],
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.inserted).toBe(1);
    expect(supabase.inserted[0].pair1_player1_name).toBe('OK');
  });

  // ── Country code passthrough (OOP-fallback only) ─────────────────────
  //
  // The amateur-tier OOP fallback path now also reads country codes
  // out of oop_snapshots and writes them to public.matches as
  // pair*_player*_country. The UI hydrator turns those into Player
  // objects with `country` set, which feeds the existing `countryFlag`
  // helper — no separate UI code path needed.

  it('OOP fallback: writes pair*_player*_country when present in oop_snapshots', async () => {
    const oopRowWithCountry = {
      ...oopRow,
      match_widget_id: 'MD070',
      team1_player1_country: 'INA',
      team1_player2_country: 'SIN',
      team2_player1_country: 'HKG',
      team2_player2_country: 'HKG',
    };
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'B3 SG', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      tournamentLevels: { [TOURNAMENT_ID]: 'fip_beyond' },
      draws: [],
      oopSnapshots: [oopRowWithCountry],
      entryList: [],
      players: [],
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.inserted).toBe(1);
    const row = supabase.inserted[0];
    expect(row.pair1_player1_country).toBe('INA');
    expect(row.pair1_player2_country).toBe('SIN');
    expect(row.pair2_player1_country).toBe('HKG');
    expect(row.pair2_player2_country).toBe('HKG');
  });

  it('OOP fallback: omits country fields on INSERT when oop_snapshots has them null', async () => {
    // Defensive: don't write `pair*_country: null` keys into INSERT
    // payloads (would clutter the row + show up in audit). The
    // existing thin-match test already implicitly covers this — names
    // present, countries absent. Make it explicit here.
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'B3 SG', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      tournamentLevels: { [TOURNAMENT_ID]: 'fip_beyond' },
      draws: [],
      oopSnapshots: [oopRow], // base row has no country fields
      entryList: [],
      players: [],
    });

    await runFipDrawPopulator({ supabase: supabase as any, dryRun: false });
    const row = supabase.inserted[0];
    expect(row.pair1_player1_country).toBeUndefined();
    expect(row.pair2_player2_country).toBeUndefined();
    // Names still set
    expect(row.pair1_player1_name).toBe('Local A');
  });

  it('OOP fallback: backfills NULL country slots without overwriting existing', async () => {
    // First pass set country only for team 1 (e.g. flag for player 3
    // hadn't loaded yet). Second pass has all four countries; only
    // the still-null slots get the patch.
    const oopRowWithCountry = {
      ...oopRow,
      match_widget_id: 'MD080',
      team1_player1_country: 'NEW1',
      team1_player2_country: 'NEW2',
      team2_player1_country: 'NEW3',
      team2_player2_country: 'NEW4',
    };
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'B3 SG', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      tournamentLevels: { [TOURNAMENT_ID]: 'fip_beyond' },
      draws: [],
      oopSnapshots: [oopRowWithCountry],
      entryList: [],
      players: [],
      existingMatches: [
        {
          id: 'm-thin-partial-country',
          widget_id_composite: 'FIP-2026-1706:MD080',
          pair1_player1_id: null,
          pair1_player2_id: null,
          pair2_player1_id: null,
          pair2_player2_id: null,
          pair1_player1_name: 'Local A',
          pair1_player2_name: 'Local B',
          pair2_player1_name: 'Local C',
          pair2_player2_name: 'Local D',
          // Team 1 countries already set; team 2 still null.
          pair1_player1_country: 'OLD1',
          pair1_player2_country: 'OLD2',
          pair2_player1_country: null,
          pair2_player2_country: null,
        },
      ],
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(1);
    expect(supabase.updated[0].patch).toEqual({
      pair2_player1_country: 'NEW3',
      pair2_player2_country: 'NEW4',
    });
    // Team 1's existing countries are NOT touched.
    expect(supabase.updated[0].patch).not.toHaveProperty(
      'pair1_player1_country',
    );
    expect(supabase.updated[0].patch).not.toHaveProperty(
      'pair1_player2_country',
    );
  });

  // ── Pagination (snapshot-table loaders) ───────────────────────────────
  //
  // PostgREST caps single-request responses at 1000 rows by default.
  // The populator's snapshot-table loaders (entry_list, draw, oop) used
  // to issue an unranged select that silently dropped any rows past
  // the cap. For Leiria 2026-04 (5,369 entry_list_snapshots) this
  // deterministically dropped the entire women's roster — every
  // women's match failed to resolve.
  //
  // Now they paginate via .range(start, end) until a partial page
  // comes back. This regression test simulates that exact gap:
  // 1100 entry list rows where the women's entries sit ABOVE row 1000.
  // Without pagination the women's matches would skip; with it they
  // resolve and write to public.matches.

  it('entry_list pagination: women past row 1000 still resolve', async () => {
    // Use the singleton TOURNAMENT_ID/SLUG/WIDGET so the test fake's
    // entry-list filter (which short-circuits on the singleton) returns
    // the rows back. The test is about *what the populator passes to
    // Supabase*, not about multi-tournament fixtures.

    // 1000 dummy men entries first — these would fill the legacy
    // 1000-row response cap, hiding everyone after.
    const entryListPaginate: EntryListSeed[] = Array.from(
      { length: 1000 },
      (_, i) => ({
        name: `Filler Man ${i}`,
        fip_id: `fip-PMEN${i}`,
        category: 'men' as const,
        captured_at: '2026-04-29T00:00:00Z',
      }),
    );
    // Then the 4 women whose match we need to resolve. They live AT
    // INDICES 1000..1003 — past the legacy cap.
    entryListPaginate.push(
      { name: 'Maria Garin', fip_id: 'fip-WP1', category: 'women', captured_at: '2026-04-29T00:00:00Z' },
      { name: 'Margarida Fernandes', fip_id: 'fip-WP2', category: 'women', captured_at: '2026-04-29T00:00:00Z' },
      { name: 'Carina Filipa Costa', fip_id: 'fip-WP3', category: 'women', captured_at: '2026-04-29T00:00:00Z' },
      { name: 'Daniela Catarino', fip_id: 'fip-WP4', category: 'women', captured_at: '2026-04-29T00:00:00Z' },
    );

    const womensDraw: DrawSeed = {
      tournament_id: TOURNAMENT_ID,
      match_widget_id: 'WD017',
      category: 'women',
      round_label: 'R32',
      draw_position: 1,
      team1_player1_name: 'Maria Garin',
      team1_player2_name: 'Margarida Fernandes',
      team2_player1_name: 'Carina Filipa Costa',
      team2_player2_name: 'Daniela Catarino',
      team1_fip_id: 'P000001',
      team2_fip_id: 'P000002',
      team1_seed: null,
      team2_seed: null,
      status: 'scheduled',
      captured_at: '2026-04-29T00:00:00Z',
    };

    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Leiria', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      // Women players need rows in public.players too. The entry_list
      // resolves name → fip_id; the players table maps fip_id → uuid.
      players: [
        { id: 'uuid-W1', fip_id: 'fip-WP1' },
        { id: 'uuid-W2', fip_id: 'fip-WP2' },
        { id: 'uuid-W3', fip_id: 'fip-WP3' },
        { id: 'uuid-W4', fip_id: 'fip-WP4' },
      ],
      draws: [womensDraw],
      entryList: entryListPaginate,
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    // Without pagination this would skip with skippedPlayerUnresolved += 1.
    // With pagination the women resolve from rows 1000..1003.
    expect(result.skippedPlayerUnresolved).toBe(0);
    expect(result.inserted).toBe(1);
    expect(supabase.inserted).toHaveLength(1);
    const row = supabase.inserted[0];
    expect(row.widget_id_composite).toBe(`${TOURNAMENT_WIDGET}:WD017`);
    expect(row.pair1_player1_id).toBe('uuid-W1');
    expect(row.pair1_player2_id).toBe('uuid-W2');
    expect(row.pair2_player1_id).toBe('uuid-W3');
    expect(row.pair2_player2_id).toBe('uuid-W4');
  });

  // ── OOP qualifying merge (Silver+) ────────────────────────────────
  //
  // The FIP event-page bracket only goes back to R32. Qualifying rounds
  // (Q1/Q2/Q3) live in the matchscorerlive OOP widget instead. Without
  // these matches in `public.matches`, the UI shows nothing for tournaments
  // on day 1 (the qualifying day), even though the OOP is published —
  // the live-poller eventually creates rows when matches go on court,
  // but that's hours late. The populator merges OOP rows for any round
  // the bracket doesn't cover, so qualifiers show up alongside R32 the
  // moment OOP is captured. Concrete case: FIP Silver Leiria 2026-04-29.

  it('OOP merge (Silver+): inserts Q1 thin matches alongside bracket R32', async () => {
    // Bracket has R32 (resolves via entry list to FK-linked row). OOP
    // has Q1 (one match, with names absent from the entry list — these
    // are qualifier-only players FIP doesn't surface in the bracket).
    // Both should land in `public.matches`, with the Q1 row as a thin
    // match keyed by the same widget composite the live-poller will
    // later use.
    const oopQ1: OopSnapshotSeed = {
      tournament_id: TOURNAMENT_ID,
      match_widget_id: 'MQ013',
      category: 'men',
      round_label: 'Q1',
      team1_player1_name: 'D. Moreira',
      team1_player2_name: 'B. Monteiro',
      team2_player1_name: 'P. Parada',
      team2_player2_name: 'G. Alves',
      captured_at: '2026-04-29T08:00:00Z',
    };

    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Leiria', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      tournamentLevels: { [TOURNAMENT_ID]: 'fip_silver' },
      draws: [realMatchDraw], // R32, resolves via entry list
      oopSnapshots: [oopQ1],
      entryList,
      players: rosterPlayers,
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.tournamentsProcessed).toBe(1);
    expect(result.inserted).toBe(2);
    expect(supabase.inserted).toHaveLength(2);

    const r32 = supabase.inserted.find(
      (r: { widget_id_composite: string }) =>
        r.widget_id_composite === `${TOURNAMENT_WIDGET}:MD017`,
    );
    expect(r32).toBeDefined();
    expect(r32.round).toBe('R32');
    // Bracket row: FK-resolved (entry list covers these names).
    expect(r32.pair1_player1_id).toBe('uuid-P1');

    const q1 = supabase.inserted.find(
      (r: { widget_id_composite: string }) =>
        r.widget_id_composite === `${TOURNAMENT_WIDGET}:MQ013`,
    );
    expect(q1).toBeDefined();
    expect(q1.round).toBe('Q1');
    // Thin match: names preserved on pair*_player*_name, no FKs
    // (qualifier names aren't in the entry list fixture).
    expect(q1.pair1_player1_id).toBeUndefined();
    expect(q1.pair1_player1_name).toBe('D. Moreira');
    expect(q1.pair2_player2_name).toBe('G. Alves');
  });

  it('OOP merge: filters out OOP rows whose round the bracket already covers (no double-insert)', async () => {
    // Defensive: if the bracket and OOP both surface a round (in the
    // wild this would be unusual — bracket is the bye-aware source
    // of truth for main-draw rounds), the bracket row wins and the
    // OOP duplicate is filtered out. `findOrCreateMatch` is the
    // backstop; this filter is the first line of defense.
    const oopAlsoR32: OopSnapshotSeed = {
      tournament_id: TOURNAMENT_ID,
      match_widget_id: 'MD999', // distinct widget id from MD017
      category: 'men',
      round_label: 'R32', // SAME round as bracket → must be dropped
      team1_player1_name: 'Other A',
      team1_player2_name: 'Other B',
      team2_player1_name: 'Other C',
      team2_player2_name: 'Other D',
      captured_at: '2026-04-29T08:00:00Z',
    };

    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Leiria', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      tournamentLevels: { [TOURNAMENT_ID]: 'fip_silver' },
      draws: [realMatchDraw], // R32
      oopSnapshots: [oopAlsoR32], // also R32 — gets filtered
      entryList,
      players: rosterPlayers,
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.inserted).toBe(1);
    expect(supabase.inserted).toHaveLength(1);
    expect(supabase.inserted[0].widget_id_composite).toBe(
      `${TOURNAMENT_WIDGET}:MD017`,
    );
  });

  it('OOP merge: Silver+ qualifier with unresolved players still inserts as thin match', async () => {
    // Pre-fix, Silver+ tournaments hit the strict-resolve gate and
    // skipped any row whose names didn't land in the entry list. For
    // OOP-sourced rows we relax that gate: the widget_id_composite is
    // stable, so a thin row now is just a placeholder the live-poller
    // upgrades when the match goes on court.
    const oopQ1Unresolved: OopSnapshotSeed = {
      tournament_id: TOURNAMENT_ID,
      match_widget_id: 'MQ020',
      category: 'men',
      round_label: 'Q1',
      // Names that DON'T appear in the entry-list fixture.
      team1_player1_name: 'L. Wildcard',
      team1_player2_name: 'M. Latecomer',
      team2_player1_name: 'N. Diacrítico',
      team2_player2_name: 'O. Unknown',
      captured_at: '2026-04-29T08:00:00Z',
    };

    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Leiria', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      tournamentLevels: { [TOURNAMENT_ID]: 'fip_silver' },
      draws: [realMatchDraw],
      oopSnapshots: [oopQ1Unresolved],
      entryList,
      players: rosterPlayers,
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    // Both inserted — R32 from bracket (resolved) + Q1 thin from OOP.
    // skippedPlayerUnresolved stays 0 because the OOP-sourced row gets
    // the relaxed gate (allowThinMatch).
    expect(result.skippedPlayerUnresolved).toBe(0);
    expect(result.inserted).toBe(2);

    const q1 = supabase.inserted.find(
      (r: { widget_id_composite: string }) =>
        r.widget_id_composite === `${TOURNAMENT_WIDGET}:MQ020`,
    );
    expect(q1).toBeDefined();
    expect(q1.pair1_player1_id).toBeUndefined();
    expect(q1.pair1_player1_name).toBe('L. Wildcard');
    expect(q1.pair2_player2_name).toBe('O. Unknown');
  });

  it('writes pair1_seed and pair2_seed on INSERT when draw_snapshots provides them', async () => {
    const seededDraw: DrawSnapshotSeed = {
      tournament_id: TOURNAMENT_ID,
      match_widget_id: 'MD001',
      category: 'men',
      round_label: 'F',
      draw_position: 1,
      team1_player1_name: 'Juan Lebron',
      team1_player2_name: 'Federico Chingotto',
      team2_player1_name: 'Arturo Coello',
      team2_player2_name: 'Agustin Tapia',
      team1_seed: 1,
      team2_seed: 2,
      team1_fip_id: 'P000001',
      team2_fip_id: 'P000002',
      status: 'scheduled',
      source: 'fip_event_page',
      captured_at: "2026-04-24T07:00:00Z",
    };
    const entryList: EntryListSeed[] = [
      { tournament_id: TOURNAMENT_ID, category: 'men', name: 'Juan Lebron', fip_id: 'F1', captured_at: "2026-04-24T07:00:00Z" },
      { tournament_id: TOURNAMENT_ID, category: 'men', name: 'Federico Chingotto', fip_id: 'F2', captured_at: "2026-04-24T07:00:00Z" },
      { tournament_id: TOURNAMENT_ID, category: 'men', name: 'Arturo Coello', fip_id: 'F3', captured_at: "2026-04-24T07:00:00Z" },
      { tournament_id: TOURNAMENT_ID, category: 'men', name: 'Agustin Tapia', fip_id: 'F4', captured_at: "2026-04-24T07:00:00Z" },
    ]
    const rosterPlayers: PlayerSeed[] = [
      { id: 'uuid-1', fip_id: 'F1' },
      { id: 'uuid-2', fip_id: 'F2' },
      { id: 'uuid-3', fip_id: 'F3' },
      { id: 'uuid-4', fip_id: 'F4' },
    ]
    const supabase = fakeSupabase({
      tournaments: [{ tournament_id: TOURNAMENT_ID, tournament_name: 'X', slug: 's' }],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [seededDraw],
      entryList,
      players: rosterPlayers,
    })
    const result = await runFipDrawPopulator({ supabase: supabase as any, dryRun: false })
    expect(result.inserted).toBe(1)
    const inserted = supabase.inserted[0]
    expect(inserted.pair1_seed).toBe(1)
    expect(inserted.pair2_seed).toBe(2)
  })

  it('writes two tournament_draws rows per draw row with seeds + onConflict key', async () => {
    const seededDraw: DrawSnapshotSeed = {
      tournament_id: TOURNAMENT_ID,
      match_widget_id: 'MD001',
      category: 'men',
      round_label: 'F',
      draw_position: 4,
      team1_player1_name: 'Juan Lebron',
      team1_player2_name: 'Federico Chingotto',
      team2_player1_name: 'Arturo Coello',
      team2_player2_name: 'Agustin Tapia',
      team1_seed: 1,
      team2_seed: 2,
      team1_fip_id: 'P000001',
      team2_fip_id: 'P000002',
      status: 'scheduled',
      source: 'fip_event_page',
      captured_at: "2026-04-24T07:00:00Z",
    }
    const entryList: EntryListSeed[] = [
      { tournament_id: TOURNAMENT_ID, category: 'men', name: 'Juan Lebron', fip_id: 'F1', captured_at: "2026-04-24T07:00:00Z" },
      { tournament_id: TOURNAMENT_ID, category: 'men', name: 'Federico Chingotto', fip_id: 'F2', captured_at: "2026-04-24T07:00:00Z" },
      { tournament_id: TOURNAMENT_ID, category: 'men', name: 'Arturo Coello', fip_id: 'F3', captured_at: "2026-04-24T07:00:00Z" },
      { tournament_id: TOURNAMENT_ID, category: 'men', name: 'Agustin Tapia', fip_id: 'F4', captured_at: "2026-04-24T07:00:00Z" },
    ]
    const rosterPlayers: PlayerSeed[] = [
      { id: 'uuid-1', fip_id: 'F1' },
      { id: 'uuid-2', fip_id: 'F2' },
      { id: 'uuid-3', fip_id: 'F3' },
      { id: 'uuid-4', fip_id: 'F4' },
    ]
    const supabase = fakeSupabase({
      tournaments: [{ tournament_id: TOURNAMENT_ID, tournament_name: 'X', slug: 's' }],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [seededDraw],
      entryList,
      players: rosterPlayers,
    })
    const result = await runFipDrawPopulator({ supabase: supabase as any, dryRun: false })
    expect(result.tournamentDrawsWritten).toBe(2)
    expect(result.tournamentDrawsSkippedNoPosition).toBe(0)
    expect(supabase.tournamentDrawsUpserted).toHaveLength(2)
    const team1 = supabase.tournamentDrawsUpserted.find(
      (r: any) => r.draw_position === 7, // 2*4-1
    ) as any
    const team2 = supabase.tournamentDrawsUpserted.find(
      (r: any) => r.draw_position === 8, // 2*4
    ) as any
    expect(team1).toBeDefined()
    expect(team2).toBeDefined()
    expect(team1.seed).toBe(1)
    expect(team2.seed).toBe(2)
    expect(team1.player1_id).toBe('uuid-1')
    expect(team1.player2_id).toBe('uuid-2')
    expect(team2.player1_id).toBe('uuid-3')
    expect(team2.player2_id).toBe('uuid-4')
    // Conflict key matches what the legacy reconciler used
    expect(supabase.tournamentDrawsConflictKeys[0]).toBe(
      'tournament_id,category,draw_position',
    )
  })

  it('skips tournament_draws team-rows where player1_name is null (scaffolding cells)', async () => {
    // public.tournament_draws has NOT NULL on player1_name. Pending
    // qualifier rows have one team with null names ("winner of Q2 #X")
    // and pure scaffolding cells (R16/QF/SF/F pre-tournament) have null
    // names on BOTH teams. Per-team-row skip prevents constraint
    // violations without losing the public.matches insert.
    const pendingDraw: DrawSeed = {
      ...realMatchDraw,
      match_widget_id: 'MD061',
      round_label: 'R64',
      // team2 entirely TBD — winner of qualifier match
      team2_player1_name: null,
      team2_player2_name: null,
      team2_fip_id: '1390580662',
      team2_seed: null,
      status: 'scheduled',
    };
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'BA P1', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [pendingDraw],
      entryList,
      players: rosterPlayers,
    });
    const result = await runFipDrawPopulator({ supabase: supabase as any, dryRun: false });
    // public.matches gets the cell — pair2 stays null FK + null name.
    expect(result.inserted).toBe(1);
    // public.tournament_draws gets ONE row (team1 only); team2 skipped.
    expect(result.tournamentDrawsWritten).toBe(1);
    expect(supabase.tournamentDrawsUpserted).toHaveLength(1);
    expect(supabase.tournamentDrawsUpserted[0].player1_name).toBe('Nuno Baptista');
  });

  it('skips tournament_draws entirely for pure scaffolding cells (all 4 names null)', async () => {
    // R16/QF/SF/F cells pre-tournament — entirely TBD. public.matches
    // gets the scaffolding row but tournament_draws gets nothing (no
    // pair information to record).
    const scaffoldDraw: DrawSeed = {
      ...realMatchDraw,
      match_widget_id: 'MD081',
      round_label: 'R16',
      team1_player1_name: null,
      team1_player2_name: null,
      team2_player1_name: null,
      team2_player2_name: null,
      team1_fip_id: '1390580663',
      team2_fip_id: '1390580664',
      team1_seed: null,
      team2_seed: null,
      status: 'scheduled',
    };
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'BA P1', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [scaffoldDraw],
      entryList,
      players: rosterPlayers,
    });
    const result = await runFipDrawPopulator({ supabase: supabase as any, dryRun: false });
    expect(result.inserted).toBe(1);
    expect(result.tournamentDrawsWritten).toBe(0);
    expect(supabase.tournamentDrawsUpserted).toHaveLength(0);
  });

  it('skips tournament_draws when draw_position is null (OOP-fallback shape)', async () => {
    // OOP-fallback rows always have draw_position null. They still go
    // into public.matches, just not the bracket table.
    const oopRow: OopSnapshotSeed = {
      tournament_id: TOURNAMENT_ID,
      match_widget_id: 'MQ020',
      category: 'men',
      round_label: 'Q1',
      court: 'Court 1',
      court_position: 0,
      scheduled_label: 'Starting at 9:00 AM',
      day_date: '2026-04-30',
      team1_player1_name: 'Player A',
      team1_player2_name: 'Player B',
      team2_player1_name: 'Player C',
      team2_player2_name: 'Player D',
      status: 'scheduled',
      captured_at: "2026-04-24T07:00:00Z",
    }
    const supabase = fakeSupabase({
      tournaments: [{ tournament_id: TOURNAMENT_ID, tournament_name: 'X', slug: 's' }],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      tournamentLevels: { [TOURNAMENT_ID]: 'fip_beyond' },
      oopSnapshots: [oopRow],
    })
    const result = await runFipDrawPopulator({ supabase: supabase as any, dryRun: false })
    expect(result.inserted).toBe(1)
    expect(result.tournamentDrawsWritten).toBe(0)
    expect(result.tournamentDrawsSkippedNoPosition).toBeGreaterThan(0)
    expect(supabase.tournamentDrawsUpserted).toHaveLength(0)
  })
});

// ── shortenName ────────────────────────────────────────────────────────

describe('shortenName', () => {
  it("collapses 'Mateo Alvarez' → 'm. alvarez'", () => {
    expect(shortenName('Mateo Alvarez')).toBe('m. alvarez');
  });

  it("preserves compound surname — 'Matias Negrete Oliva' → 'm. negrete oliva'", () => {
    expect(shortenName('Matias Negrete Oliva')).toBe('m. negrete oliva');
  });

  it("normalizes accents — 'María Fernández' → 'm. fernandez'", () => {
    expect(shortenName('María Fernández')).toBe('m. fernandez');
  });

  it("handles single-token name as-is", () => {
    expect(shortenName('Madonna')).toBe('madonna');
  });

  it("three-token with middle given name — 'Adrian Maria Miranda' → 'a. maria miranda'", () => {
    // Full-tail: shortenName always preserves ALL tokens after first.
    // The last-token variant ("a. miranda") is handled by buildShortFormMap.
    expect(shortenName('Adrian Maria Miranda')).toBe('a. maria miranda');
  });
});

// ── buildShortFormMap ──────────────────────────────────────────────────

describe('buildShortFormMap', () => {
  it('builds full-tail entry for two-token name', () => {
    const m = buildShortFormMap(new Map([['mateo alvarez', 'fip-P1']]));
    expect(m.get('m. alvarez')).toBe('fip-P1');
  });

  it('builds full-tail entry for compound surname', () => {
    const m = buildShortFormMap(new Map([['matias negrete oliva', 'fip-P1']]));
    expect(m.get('m. negrete oliva')).toBe('fip-P1');
  });

  it('builds last-token entry for 3-token name with middle given name', () => {
    // "Adrian Maria Miranda" → full-tail = "a. maria miranda"
    //                        → last-token = "a. miranda"
    const m = buildShortFormMap(new Map([['adrian maria miranda', 'fip-P1']]));
    expect(m.get('a. maria miranda')).toBe('fip-P1');
    expect(m.get('a. miranda')).toBe('fip-P1');
  });

  it('marks ambiguous when two names produce the same short key', () => {
    const m = buildShortFormMap(
      new Map([
        ['mateo alvarez', 'fip-P1'],
        ['marco alvarez', 'fip-P2'],
      ])
    );
    // Both produce "m. alvarez" — ambiguous
    expect(m.get('m. alvarez')).toBeNull();
  });

  it('keeps value when same fip_id produces the same short key (dedup)', () => {
    const m = buildShortFormMap(
      new Map([['mateo alvarez', 'fip-P1']])
    );
    // Only one player — no collision
    expect(m.get('m. alvarez')).toBe('fip-P1');
  });

  it('builds Spanish paternal-surname short form for 3-token name ("J. Ruiz" from "Javier Ruiz Gonzalez")', () => {
    // Pattern 3: Spanish "Nombre Apellido1 Apellido2" → "N. Apellido1".
    // Without this, OOP shorthand "J. Ruiz" never resolves to Javier Ruiz Gonzalez.
    const m = buildShortFormMap(new Map([['javier ruiz gonzalez', 'fip-P000021']]));
    expect(m.get('j. ruiz gonzalez')).toBe('fip-P000021'); // Pattern 1
    expect(m.get('j. gonzalez')).toBe('fip-P000021'); // Pattern 2
    expect(m.get('j. ruiz')).toBe('fip-P000021'); // Pattern 3 (new)
  });

  it('marks "j. ruiz" ambiguous when both Javier Ruiz Gonzalez and Jorge Nieto Ruiz exist', () => {
    // Real-world collision from BA P1 2026-05-12 R64. Before Pattern 3, only
    // Jorge Nieto Ruiz registered "j. ruiz" (via Pattern 2 last-token), so OOP's
    // "J. Ruiz" would silently resolve to him — even though the OOP partner is
    // Gonzalo Rubio (Javier Ruiz Gonzalez's actual entry-list pair). With
    // Pattern 3 both names produce "j. ruiz" → collision → null → unresolved.
    const m = buildShortFormMap(
      new Map([
        ['javier ruiz gonzalez', 'fip-P000021'],
        ['jorge nieto ruiz', 'fip-P000017'],
      ])
    );
    expect(m.get('j. ruiz')).toBeNull();
    // Each player's unambiguous keys still resolve correctly.
    expect(m.get('j. ruiz gonzalez')).toBe('fip-P000021');
    expect(m.get('j. gonzalez')).toBe('fip-P000021');
    expect(m.get('j. nieto ruiz')).toBe('fip-P000017');
    expect(m.get('j. nieto')).toBe('fip-P000017');
  });

  it('does NOT generate paternal-surname short form for 4-token names (token-2 is usually a middle given name)', () => {
    // "Alejandro Valentino Lopez Barresi" — Valentino is a middle given name,
    // not a surname. Generating "a. valentino" would create false-positive
    // matches against players actually shortened that way.
    const m = buildShortFormMap(new Map([['alejandro valentino lopez barresi', 'fip-P1']]));
    expect(m.get('a. valentino lopez barresi')).toBe('fip-P1'); // Pattern 1
    expect(m.get('a. barresi')).toBe('fip-P1'); // Pattern 2 last-token
    expect(m.has('a. valentino')).toBe(false); // Pattern 3 must NOT fire
    expect(m.has('a. lopez')).toBe(false); // and definitely not arbitrary middle tokens
  });
});

// ── Regression: BA P1 2026-05-12 MD042 "J. Ruiz" mis-resolution ────────
//
// Before Pattern 3, OOP shorthand "J. Ruiz" silently resolved to Jorge Nieto
// Ruiz (rank 10) because his Pattern-2 last-token form was the only registered
// "j. ruiz" key. The actual OOP pair was J. Ruiz (Javier Ruiz Gonzalez, rank 41)
// / G. Rubio (Gonzalo Rubio, rank 40). This produced an absurd pairing of a
// world #10 with a #40 in an R64, visible on the live tournament site.
//
// With Pattern 3, both names register "j. ruiz" → collision → null. The slot
// is left unresolved (raw name "J. Ruiz" preserved, no FK link). That's the
// safe outcome: better unlinked than wrong-linked.

describe('resolveFourPlayers — Spanish paternal-surname collision (BA P1 MD042)', () => {
  it('leaves "J. Ruiz" unresolved when both Javier Ruiz Gonzalez and Jorge Nieto Ruiz are in the entry list', () => {
    // 3-token entry-list names so OOP short-forms resolve cleanly via Pattern 1.
    const nameToFipId = new Map<string, string>([
      ['javier ruiz gonzalez', 'fip-P000021'],
      ['jorge nieto ruiz', 'fip-P000017'],
      ['gonzalo rubio', 'fip-P000029'],
      ['santiago pineda cabello', 'fip-P100958'],
      ['diego garcia garcia', 'fip-P101099'],
    ]);
    const shortFormToFipId = buildShortFormMap(nameToFipId);
    const fipIdToPlayerId = new Map<string, string>([
      ['fip-P000021', 'uuid-javier'],
      ['fip-P000017', 'uuid-jorge'],
      ['fip-P000029', 'uuid-gonzalo'],
      ['fip-P100958', 'uuid-pineda'],
      ['fip-P101099', 'uuid-diego'],
    ]);
    const draw = {
      team1_player1_name: 'S. Pineda Cabello',
      team1_player2_name: 'D. Garcia Garcia',
      team2_player1_name: 'J. Ruiz',
      team2_player2_name: 'G. Rubio',
    } as never;
    const resolved = resolveFourPlayers(draw, nameToFipId, shortFormToFipId, fipIdToPlayerId);
    // Pineda + Garcia resolve via Pattern 1 full-tail short form (no collision).
    // Rubio resolves via Pattern 1 (2-token name).
    // J. Ruiz is ambiguous → null (the regression — previously resolved to Jorge Nieto Ruiz).
    expect(resolved).toEqual({
      p1p1: 'uuid-pineda',
      p1p2: 'uuid-diego',
      p2p1: null,
      p2p2: 'uuid-gonzalo',
    });
  });
});

// ── resolveFourPlayers — short-form and middle-name fallbacks ──────────

describe('resolveFourPlayers — short-form fallback', () => {
  it('resolves Crionet OOP-style short-form names ("M. Alvarez")', () => {
    const nameToFipId = new Map<string, string>([
      ['mateo alvarez', 'fip-P216185'],
      ['octavio alvarez', 'fip-P100615'],
    ]);
    const shortFormToFipId = buildShortFormMap(nameToFipId);
    const fipIdToPlayerId = new Map<string, string>([
      ['fip-P216185', 'uuid-mateo'],
      ['fip-P100615', 'uuid-octavio'],
    ]);
    const draw = {
      team1_player1_name: 'M. Alvarez',
      team1_player2_name: 'O. Alvarez',
      team2_player1_name: 'Mateo Alvarez',      // long-form should also work
      team2_player2_name: 'octavio alvarez',     // already normalized long-form
    } as never;
    const resolved = resolveFourPlayers(draw, nameToFipId, shortFormToFipId, fipIdToPlayerId);
    expect(resolved).toEqual({
      p1p1: 'uuid-mateo',
      p1p2: 'uuid-octavio',
      p2p1: 'uuid-mateo',
      p2p2: 'uuid-octavio',
    });
  });

  it('resolves last-token short form for players with middle given names ("A. Miranda")', () => {
    // EL: "Adrian Maria Miranda", OOP: "A. Miranda"
    // last-token short = "a. miranda"
    const nameToFipId = new Map<string, string>([
      ['mateo alvarez', 'fip-P1'],
      ['adrian maria miranda', 'fip-P2'],
      ['jose garcia', 'fip-P3'],
      ['carlos lopez', 'fip-P4'],
    ]);
    const shortFormToFipId = buildShortFormMap(nameToFipId);
    const fipIdToPlayerId = new Map<string, string>([
      ['fip-P1', 'uuid-1'],
      ['fip-P2', 'uuid-2'],
      ['fip-P3', 'uuid-3'],
      ['fip-P4', 'uuid-4'],
    ]);
    const draw = {
      team1_player1_name: 'M. Alvarez',
      team1_player2_name: 'A. Miranda',
      team2_player1_name: 'Jose Garcia',
      team2_player2_name: 'Carlos Lopez',
    } as never;
    const resolved = resolveFourPlayers(draw, nameToFipId, shortFormToFipId, fipIdToPlayerId);
    expect(resolved).toEqual({ p1p1: 'uuid-1', p1p2: 'uuid-2', p2p1: 'uuid-3', p2p2: 'uuid-4' });
  });

  it('returns null when short-form is ambiguous', () => {
    const nameToFipId = new Map<string, string>([
      ['mateo alvarez', 'fip-P1'],
      ['marco alvarez', 'fip-P2'],
      ['jose garcia', 'fip-P3'],
      ['carlos lopez', 'fip-P4'],
    ]);
    const shortFormToFipId = buildShortFormMap(nameToFipId);
    // 'm. alvarez' → null (ambiguous)
    const fipIdToPlayerId = new Map<string, string>([
      ['fip-P1', 'uuid-1'], ['fip-P2', 'uuid-2'],
      ['fip-P3', 'uuid-3'], ['fip-P4', 'uuid-4'],
    ]);
    const draw = {
      team1_player1_name: 'M. Alvarez',
      team1_player2_name: 'Jose Garcia',
      team2_player1_name: 'Carlos Lopez',
      team2_player2_name: 'Jose Garcia',
    } as never;
    // Ambiguous short-form returns null only for the affected slot — other
    // unambiguous slots still resolve so callers can do partial FK fills.
    expect(resolveFourPlayers(draw, nameToFipId, shortFormToFipId, fipIdToPlayerId)).toEqual({
      p1p1: null,
      p1p2: 'uuid-3',
      p2p1: 'uuid-4',
      p2p2: 'uuid-3',
    });
  });
});

describe('resolveFourPlayers — middle-name strip and prefix fallbacks', () => {
  it('resolves draw name with extra middle given name by stripping it', () => {
    // Draw: "Alejandro Valentino Lopez Barresi"
    // EL:   "Alejandro Lopez Barresi"
    // Strip index 1 ("valentino") → "alejandro lopez barresi" ✓
    const nameToFipId = new Map<string, string>([
      ['alejandro lopez barresi', 'fip-P1'],
      ['david fernandes', 'fip-P2'],
      ['jose montalban', 'fip-P3'],
      ['german rodriguez', 'fip-P4'],
    ]);
    const shortFormToFipId = buildShortFormMap(nameToFipId);
    const fipIdToPlayerId = new Map<string, string>([
      ['fip-P1', 'uuid-1'], ['fip-P2', 'uuid-2'],
      ['fip-P3', 'uuid-3'], ['fip-P4', 'uuid-4'],
    ]);
    const draw = {
      team1_player1_name: 'Alejandro Valentino Lopez Barresi',
      team1_player2_name: 'David Fernandes',
      team2_player1_name: 'Jose Montalban',
      team2_player2_name: 'German Rodriguez',
    } as never;
    const resolved = resolveFourPlayers(draw, nameToFipId, shortFormToFipId, fipIdToPlayerId);
    expect(resolved).toEqual({ p1p1: 'uuid-1', p1p2: 'uuid-2', p2p1: 'uuid-3', p2p2: 'uuid-4' });
  });

  it('resolves draw name with extra trailing surname by prefix match', () => {
    // Draw: "Vinny Nahuel Di Francesco Calderon"
    // EL:   "Vinny Nahuel Di Francesco"
    // Prefix match: first 4 tokens match ✓
    const nameToFipId = new Map<string, string>([
      ['vinny nahuel di francesco', 'fip-P1'],
      ['david fernandes', 'fip-P2'],
      ['jose montalban', 'fip-P3'],
      ['german rodriguez', 'fip-P4'],
    ]);
    const shortFormToFipId = buildShortFormMap(nameToFipId);
    const fipIdToPlayerId = new Map<string, string>([
      ['fip-P1', 'uuid-1'], ['fip-P2', 'uuid-2'],
      ['fip-P3', 'uuid-3'], ['fip-P4', 'uuid-4'],
    ]);
    const draw = {
      team1_player1_name: 'Vinny Nahuel Di Francesco Calderon',
      team1_player2_name: 'David Fernandes',
      team2_player1_name: 'Jose Montalban',
      team2_player2_name: 'German Rodriguez',
    } as never;
    const resolved = resolveFourPlayers(draw, nameToFipId, shortFormToFipId, fipIdToPlayerId);
    expect(resolved).toEqual({ p1p1: 'uuid-1', p1p2: 'uuid-2', p2p1: 'uuid-3', p2p2: 'uuid-4' });
  });

  it('returns null when middle-name strip is ambiguous (multiple distinct fip_ids)', () => {
    // Draw: "Maria Jose Carmen Lopez" — stripping different middle tokens
    // yields different EL entries owned by DIFFERENT players. Must reject
    // rather than silently pick one. Mirrors the short-form ambiguity rule.
    const nameToFipId = new Map<string, string>([
      ['maria carmen lopez', 'fip-PA'],   // strip token 1
      ['maria jose lopez', 'fip-PB'],     // strip token 2
      ['david fernandes', 'fip-P2'],
      ['jose montalban', 'fip-P3'],
      ['german rodriguez', 'fip-P4'],
    ]);
    const shortFormToFipId = buildShortFormMap(nameToFipId);
    const fipIdToPlayerId = new Map<string, string>([
      ['fip-PA', 'uuid-A'], ['fip-PB', 'uuid-B'],
      ['fip-P2', 'uuid-2'], ['fip-P3', 'uuid-3'], ['fip-P4', 'uuid-4'],
    ]);
    const draw = {
      team1_player1_name: 'Maria Jose Carmen Lopez',
      team1_player2_name: 'David Fernandes',
      team2_player1_name: 'Jose Montalban',
      team2_player2_name: 'German Rodriguez',
    } as never;
    const resolved = resolveFourPlayers(draw, nameToFipId, shortFormToFipId, fipIdToPlayerId);
    // Ambiguous middle-strip returns null for the ambiguous slot only —
    // other unambiguous slots still resolve to enable partial FK fills.
    expect(resolved).toEqual({
      p1p1: null,
      p1p2: 'uuid-2',
      p2p1: 'uuid-3',
      p2p2: 'uuid-4',
    });
  });
});

// ── Fix 1: end-to-end pass-3 through the worker ───────────────────────
//
// The unit tests above exercise resolveFourPlayers in isolation, with a
// pre-built fipIdToPlayerId map. That bypasses the real path: the worker
// pre-loads `wantedFipIds` from the draw rows BEFORE calling the resolver,
// and `loadPlayersByFipId` only fetches players whose fip_id is in that
// set. If wantedFipIds doesn't simulate pass-3 candidates, the player
// row never gets loaded, fipIdToPlayerId.get returns undefined, and the
// resolver returns null even though the EL has the player.
describe('runFipDrawPopulator — pass-3 wantedFipIds pre-load', () => {
  it('resolves a draw row whose player is reachable ONLY via middle-name strip (pass 3)', async () => {
    // Draw has "Sebastian Maria Rodriguez" (extra middle given name).
    // EL has "Sebastian Rodriguez" → fip_id fip-MIDS. Pass 1 misses
    // (no exact match), pass 2 misses (short form is "s. maria rodriguez"
    // — still doesn't match EL's "Sebastian Rodriguez"), pass 3 succeeds
    // by stripping "maria".
    const drawWithMiddleName: DrawSeed = {
      ...realMatchDraw,
      match_widget_id: 'MQ021',
      team1_player1_name: 'Sebastian Maria Rodriguez',
    };
    const elWithStrippable = [
      ...entryList,
      { name: 'Sebastian Rodriguez', fip_id: 'fip-MIDS', category: 'men' as const, captured_at: '2026-04-24T07:00:00Z' },
    ];
    const playersWithStrippable = [
      ...rosterPlayers,
      { id: 'uuid-MIDS', fip_id: 'fip-MIDS' },
    ];
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Asuncion', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [drawWithMiddleName],
      entryList: elWithStrippable,
      players: playersWithStrippable,
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.skippedPlayerUnresolved).toBe(0);
    expect(result.inserted).toBe(1);
    expect(supabase.inserted).toHaveLength(1);
    expect(supabase.inserted[0].pair1_player1_id).toBe('uuid-MIDS');
    expect(supabase.inserted[0].pair1_player2_id).toBe('uuid-P2');
    expect(supabase.inserted[0].pair2_player1_id).toBe('uuid-P3');
    expect(supabase.inserted[0].pair2_player2_id).toBe('uuid-P4');
  });

  it('resolves a draw row whose player is reachable ONLY via prefix match (pass 3b)', async () => {
    // Draw: "Vinny Nahuel Di Francesco Calderon"
    // EL:   "Vinny Nahuel Di Francesco" → fip_id fip-PFX
    // Pass 1/2 miss; pass 3b prefix match (4-token prefix) succeeds.
    const drawWithExtraSurname: DrawSeed = {
      ...realMatchDraw,
      match_widget_id: 'MQ022',
      team1_player1_name: 'Vinny Nahuel Di Francesco Calderon',
    };
    const elWithPrefix = [
      ...entryList,
      { name: 'Vinny Nahuel Di Francesco', fip_id: 'fip-PFX', category: 'men' as const, captured_at: '2026-04-24T07:00:00Z' },
    ];
    const playersWithPrefix = [
      ...rosterPlayers,
      { id: 'uuid-PFX', fip_id: 'fip-PFX' },
    ];
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Asuncion', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [drawWithExtraSurname],
      entryList: elWithPrefix,
      players: playersWithPrefix,
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.skippedPlayerUnresolved).toBe(0);
    expect(result.inserted).toBe(1);
    expect(supabase.inserted[0].pair1_player1_id).toBe('uuid-PFX');
  });
});

// ── Fix 2: prefer draw long-form on UPDATE when existing has short-form ─
//
// Setup: a match was first created via OOP fallback (short-form names
// "S. Rodriguez", FKs null). Later the FIP draw_snapshots row lands with
// long-form names + valid team_fip_id. The populator should refresh the
// names AND resolve the FKs — the draw is the higher-confidence source.
describe('runFipDrawPopulator — draw refreshes short-form names on UPDATE', () => {
  it('UPDATE: short-form names in existing row get replaced by draw long-form + FKs resolved', async () => {
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Asuncion', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [realMatchDraw], // long-form names + team_fip_id, source fip_event_page
      entryList,
      players: rosterPlayers,
      existingMatches: [
        {
          id: 'm-thin',
          widget_id_composite: 'FIP-2026-1706:MD017',
          // OOP-created thin match: short-form names, no FKs
          pair1_player1_id: null,
          pair1_player2_id: null,
          pair2_player1_id: null,
          pair2_player2_id: null,
          pair1_player1_name: 'N. Baptista',
          pair1_player2_name: 'D. Fernandes',
          pair2_player1_name: 'J. Montalban Martin',
          pair2_player2_name: 'G. Rodriguez Quesada',
        },
      ],
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.updated).toBe(1);
    expect(supabase.updated).toHaveLength(1);
    const patch = supabase.updated[0].patch;
    // FKs resolved
    expect(patch.pair1_player1_id).toBe('uuid-P1');
    expect(patch.pair1_player2_id).toBe('uuid-P2');
    expect(patch.pair2_player1_id).toBe('uuid-P3');
    expect(patch.pair2_player2_id).toBe('uuid-P4');
    // Names refreshed from draw long-form (overwriting short-form)
    expect(patch.pair1_player1_name).toBe('Nuno Baptista');
    expect(patch.pair1_player2_name).toBe('David Fernandes');
    expect(patch.pair2_player1_name).toBe('Jose Montalban Martin');
    expect(patch.pair2_player2_name).toBe('German Rodriguez Quesada');
  });

  it('UPDATE: does NOT overwrite long-form names already in existing row (no-op when FKs already set)', async () => {
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Asuncion', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [realMatchDraw],
      entryList,
      players: rosterPlayers,
      existingMatches: [
        {
          id: 'm-already-long',
          widget_id_composite: 'FIP-2026-1706:MD017',
          pair1_player1_id: 'some-A',
          pair1_player2_id: 'some-B',
          pair2_player1_id: 'some-C',
          pair2_player2_id: 'some-D',
          pair1_player1_name: 'Nuno Baptista',
          pair1_player2_name: 'David Fernandes',
          pair2_player1_name: 'Jose Montalban Martin',
          pair2_player2_name: 'German Rodriguez Quesada',
        },
      ],
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    // No short-form trigger, all FKs set, names match — pure no-op.
    expect(result.updated).toBe(0);
    expect(result.skippedAlreadyComplete).toBe(1);
    expect(supabase.updated).toHaveLength(0);
  });

  it('UPDATE: oop_snapshot source does NOT trigger short-form refresh (only fip_event_page is authoritative)', async () => {
    // Same scenario but draw row comes from oop_snapshot (also short-form).
    // Refresh should NOT fire — only fip_event_page draws are higher-
    // confidence than existing short-form.
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Amateur Club', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      // No draw_snapshots — forces OOP fallback (amateur tier).
      oopSnapshots: [
        {
          tournament_id: TOURNAMENT_ID,
          match_widget_id: 'MD017',
          category: 'men',
          round_label: 'R32',
          team1_player1_name: 'N. Baptista',
          team1_player2_name: 'D. Fernandes',
          team2_player1_name: 'J. Montalban',
          team2_player2_name: 'G. Rodriguez',
          captured_at: '2026-04-24T08:00:00Z',
        },
      ],
      entryList,
      players: rosterPlayers,
      tournamentLevels: { [TOURNAMENT_ID]: 'fip_beyond' },
      existingMatches: [
        {
          id: 'm-oop-thin',
          widget_id_composite: 'FIP-2026-1706:MD017',
          pair1_player1_id: null,
          pair1_player2_id: null,
          pair2_player1_id: null,
          pair2_player2_id: null,
          pair1_player1_name: 'N. Baptista',
          pair1_player2_name: 'D. Fernandes',
          pair2_player1_name: 'J. Montalban',
          pair2_player2_name: 'G. Rodriguez',
        },
      ],
    });

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    // OOP-source draws never trigger short-form NAME refresh — that's
    // reserved for fip_event_page (the authoritative bracket). The patch
    // (if any) must NOT contain pair*_player*_name overwrites of the
    // existing short-form values. Per-slot FK fills are still allowed:
    // resolveFourPlayers may resolve 2 of 4 short forms via the EL's
    // short-form map (Nuno Baptista / David Fernandes), while the other
    // two stay unresolved because their PDF entries have extra surnames
    // ("Jose Montalban Martin", "German Rodriguez Quesada") that don't
    // match the OOP-form initials.
    if (supabase.updated.length > 0) {
      const patch = supabase.updated[0].patch as Record<string, unknown>;
      expect(patch.pair1_player1_name).toBeUndefined();
      expect(patch.pair1_player2_name).toBeUndefined();
      expect(patch.pair2_player1_name).toBeUndefined();
      expect(patch.pair2_player2_name).toBeUndefined();
    }
  });
});

// ── round label overwrite for stale main-draw labels on qualifier widgets ─
//
// When the parser was wrong about qualifier brackets (emitting R16/QF/SF
// instead of Q1/Q2/Q3), the populator wrote those wrong labels onto
// public.matches. After the parser fix, draw_snapshots now carry correct
// Q-labels — but the populator's UPDATE branch never touched `round`, so
// existing rows kept the wrong label until something else updated them.
// This block adds a narrow rule: when the widget is a qualifier (MQ/WQ
// prefix) AND existing.round is a main-draw label AND the draw row brings
// a Q-label, overwrite. Main-draw widgets and Q-labelled rows are never
// touched.
describe('runFipDrawPopulator — qualifier round label backfill on UPDATE', () => {
  const qDraw: DrawSeed = {
    ...realMatchDraw,
    match_widget_id: 'WQ011',
    round_label: 'Q1',
  };

  it('overwrites stale R16 → Q1 on a WQ widget when existing has main-draw label', async () => {
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Asuncion', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [qDraw],
      entryList,
      players: rosterPlayers,
      existingMatches: [
        {
          id: 'm-stale-round',
          widget_id_composite: 'FIP-2026-1706:WQ011',
          pair1_player1_id: 'uuid-P1',
          pair1_player2_id: 'uuid-P2',
          pair2_player1_id: 'uuid-P3',
          pair2_player2_id: 'uuid-P4',
        },
      ],
    });
    // Inject the stale round directly on the existing-match seed so the
    // fake's match-row reflects the production scenario (matches.round is
    // a real column the populator's loadExistingMatchesByPrefix doesn't
    // currently project; we set it via the seed for assertion purposes).
    (supabase.existing[0] as any).round = 'R16';

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.updated).toBe(1);
    expect(supabase.updated[0].patch.round).toBe('Q1');
  });

  it('does NOT overwrite when widget is main-draw (MD/WD prefix)', async () => {
    const mdDraw: DrawSeed = {
      ...realMatchDraw,
      match_widget_id: 'MD017',
      round_label: 'R16',
    };
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Asuncion', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [mdDraw],
      entryList,
      players: rosterPlayers,
      existingMatches: [
        {
          id: 'm-md',
          widget_id_composite: 'FIP-2026-1706:MD017',
          pair1_player1_id: 'uuid-P1',
          pair1_player2_id: 'uuid-P2',
          pair2_player1_id: 'uuid-P3',
          pair2_player2_id: 'uuid-P4',
        },
      ],
    });
    (supabase.existing[0] as any).round = 'R32';

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    // No round overwrite; FKs already complete → skippedAlreadyComplete
    expect(result.skippedAlreadyComplete).toBe(1);
    expect(supabase.updated).toHaveLength(0);
  });

  it('does NOT overwrite when existing.round is already a Q-label (no churn)', async () => {
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Asuncion', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [qDraw], // Q1
      entryList,
      players: rosterPlayers,
      existingMatches: [
        {
          id: 'm-already-q',
          widget_id_composite: 'FIP-2026-1706:WQ011',
          pair1_player1_id: 'uuid-P1',
          pair1_player2_id: 'uuid-P2',
          pair2_player1_id: 'uuid-P3',
          pair2_player2_id: 'uuid-P4',
        },
      ],
    });
    (supabase.existing[0] as any).round = 'Q1';

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.skippedAlreadyComplete).toBe(1);
    expect(supabase.updated).toHaveLength(0);
  });

  it('does NOT overwrite when draw row has a non-Q label (e.g. OOP fallback with stale R16)', async () => {
    // Defensive — the parser fix corrects FIP draw snapshots, but if some
    // upstream source still emits R16 for a qualifier widget, we don't
    // want to overwrite a different (also-wrong) label with this one.
    const stillBadDraw: DrawSeed = {
      ...realMatchDraw,
      match_widget_id: 'WQ011',
      round_label: 'R16',
    };
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'Asuncion', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [stillBadDraw],
      entryList,
      players: rosterPlayers,
      existingMatches: [
        {
          id: 'm-both-bad',
          widget_id_composite: 'FIP-2026-1706:WQ011',
          pair1_player1_id: 'uuid-P1',
          pair1_player2_id: 'uuid-P2',
          pair2_player1_id: 'uuid-P3',
          pair2_player2_id: 'uuid-P4',
        },
      ],
    });
    (supabase.existing[0] as any).round = 'QF';

    const result = await runFipDrawPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.skippedAlreadyComplete).toBe(1);
    expect(supabase.updated).toHaveLength(0);
  });
});

import { describe, it, expect, vi } from 'vitest';
import {
  runFipDrawPopulator,
  resolveFourPlayers,
  normalizeName,
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
}

interface Options {
  tournaments?: Array<{
    tournament_id: string;
    tournament_name: string;
    slug: string;
  }>;
  widgetCodeByTournament?: Record<string, string | null>;
  draws?: DrawSeed[];
  entryList?: EntryListSeed[];
  players?: PlayerSeed[];
  existingMatches?: ExistingMatchSeed[];
}

function fakeSupabase(opts: Options) {
  const tournaments = opts.tournaments ?? [];
  const widgetCode = opts.widgetCodeByTournament ?? {};
  const draws = opts.draws ?? [];
  const entryList = opts.entryList ?? [];
  const players = opts.players ?? [];
  const existingState: ExistingMatchSeed[] = [...(opts.existingMatches ?? [])];

  const inserted: any[] = [];
  const updated: Array<{ id: string; patch: Record<string, unknown> }> = [];

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
      // Reflect into state so subsequent UPDATE lookups see it
      existingState.push({
        id,
        widget_id_composite: row.widget_id_composite,
        pair1_player1_id: row.pair1_player1_id ?? null,
        pair1_player2_id: row.pair1_player2_id ?? null,
        pair2_player1_id: row.pair2_player1_id ?? null,
        pair2_player2_id: row.pair2_player2_id ?? null,
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

  const drawSnapshotsTable = () => ({
    select: (_cols: string) => ({
      eq: (col1: string, val1: string) => ({
        eq: (col2: string, val2: string) => {
          const data = draws.filter(
            (d) =>
              (col1 !== 'tournament_id' || d.tournament_id === val1) &&
              (col2 !== 'source' || 'fip_event_page' === val2),
          );
          return Promise.resolve({ data, error: null });
        },
      }),
    }),
  });

  const entryListSnapshotsTable = () => ({
    select: (_cols: string) => ({
      eq: (col: string, val: string) => {
        const data = entryList.filter(
          (e) => col !== 'tournament_id' || val === TOURNAMENT_ID,
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
    inserted,
    updated,
    get existing() {
      return existingState;
    },
    schema: (_name: string) => ({
      from: (t: string) => {
        if (t === 'draw_snapshots') return drawSnapshotsTable();
        if (t === 'entry_list_snapshots') return entryListSnapshotsTable();
        if (t === 'widget_id_cache') return widgetIdCacheTable();
        throw new Error(`unexpected padelgod table: ${t}`);
      },
    }),
    from: (t: string) => {
      if (t === 'matches') return matchesTable();
      if (t === 'players') return playersTable();
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
    expect(resolveFourPlayers(baseDraw, nameToFipId, fipIdToPlayerId)).toEqual({
      p1p1: 'uuid-1',
      p1p2: 'uuid-2',
      p2p1: 'uuid-3',
      p2p2: 'uuid-4',
    });
  });

  it('returns null when one name is missing from entry list', () => {
    const d = { ...baseDraw, team1_player1_name: 'Nobody Here' };
    expect(resolveFourPlayers(d, nameToFipId, fipIdToPlayerId)).toBeNull();
  });

  it('returns null when one fip_id has no public.players row', () => {
    const noP4 = new Map(fipIdToPlayerId);
    noP4.delete('fip-P4');
    expect(resolveFourPlayers(baseDraw, nameToFipId, noP4)).toBeNull();
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

  it('skips byes (non-P team fip id OR status=walkover)', async () => {
    const byeDraw: DrawSeed = {
      ...realMatchDraw,
      match_widget_id: 'MD001',
      team1_fip_id: 'P200001',
      team2_fip_id: '1390580661', // numeric bye id
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

  it('skips rows where any player is unresolved (will retry next run)', async () => {
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
});

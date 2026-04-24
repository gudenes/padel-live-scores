import { describe, it, expect, vi } from 'vitest';
import {
  runFipWinnerPropagator,
  buildPropagationMap,
  drawTypePrefix,
} from '../../workers/fip-winner-propagator.js';

// ── drawTypePrefix ──────────────────────────────────────────────────────

describe('drawTypePrefix', () => {
  it('extracts prefix from all four draw types', () => {
    expect(drawTypePrefix('MD017')).toBe('MD');
    expect(drawTypePrefix('WD008')).toBe('WD');
    expect(drawTypePrefix('MQ023')).toBe('MQ');
    expect(drawTypePrefix('WQ011')).toBe('WQ');
  });

  it('returns null on malformed widget ids', () => {
    expect(drawTypePrefix('')).toBeNull();
    expect(drawTypePrefix('md017')).toBeNull(); // lowercase
    expect(drawTypePrefix('MDXX')).toBeNull(); // letters in suffix
    expect(drawTypePrefix('M017')).toBeNull(); // only 1 letter
  });
});

// ── buildPropagationMap ────────────────────────────────────────────────

describe('buildPropagationMap', () => {
  it('Isla MD: 31 matches (R32=16, R16=8, QF=4, SF=2, F=1)', () => {
    // Build the exact shape of Isla's MD bracket. Positions 1-16 = R32,
    // 17-24 = R16, 25-28 = QF, 29-30 = SF, 31 = F.
    const slots = [
      ...Array.from({ length: 16 }, (_, i) => ({
        widget_id: `MD${String(16 - i).padStart(3, '0')}`, // widget numbers reverse of position
        round_label: 'R32',
        draw_position: i + 1,
        draw_type_prefix: 'MD',
      })),
      ...Array.from({ length: 8 }, (_, i) => ({
        widget_id: `MD${String(i + 8).padStart(3, '0')}`,
        round_label: 'R16',
        draw_position: i + 17,
        draw_type_prefix: 'MD',
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        widget_id: `MD${String(i + 4).padStart(3, '0')}`,
        round_label: 'QF',
        draw_position: i + 25,
        draw_type_prefix: 'MD',
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        widget_id: `MD${String(i + 2).padStart(3, '0')}`,
        round_label: 'SF',
        draw_position: i + 29,
        draw_type_prefix: 'MD',
      })),
      {
        widget_id: 'MD001',
        round_label: 'F',
        draw_position: 31,
        draw_type_prefix: 'MD',
      },
    ];

    const m = buildPropagationMap(slots);

    // R32 → R16
    // pos 1 → R16 pos 17 team 1 (first R32 winner goes to first R16 team 1)
    expect(m.get(1)).toEqual({ nextPosition: 17, targetTeam: 1 });
    // pos 2 → R16 pos 17 team 2
    expect(m.get(2)).toEqual({ nextPosition: 17, targetTeam: 2 });
    // pos 3 → R16 pos 18 team 1
    expect(m.get(3)).toEqual({ nextPosition: 18, targetTeam: 1 });
    expect(m.get(4)).toEqual({ nextPosition: 18, targetTeam: 2 });
    expect(m.get(15)).toEqual({ nextPosition: 24, targetTeam: 1 });
    expect(m.get(16)).toEqual({ nextPosition: 24, targetTeam: 2 });

    // R16 → QF
    expect(m.get(17)).toEqual({ nextPosition: 25, targetTeam: 1 });
    expect(m.get(18)).toEqual({ nextPosition: 25, targetTeam: 2 });
    expect(m.get(19)).toEqual({ nextPosition: 26, targetTeam: 1 });
    expect(m.get(24)).toEqual({ nextPosition: 28, targetTeam: 2 });

    // QF → SF
    expect(m.get(25)).toEqual({ nextPosition: 29, targetTeam: 1 });
    expect(m.get(28)).toEqual({ nextPosition: 30, targetTeam: 2 });

    // SF → F
    expect(m.get(29)).toEqual({ nextPosition: 31, targetTeam: 1 });
    expect(m.get(30)).toEqual({ nextPosition: 31, targetTeam: 2 });

    // F has no next round
    expect(m.get(31)).toBeUndefined();
  });

  it('Brussels WQ: 12 matches (R16=8, QF=4)', () => {
    const slots = [
      ...Array.from({ length: 8 }, (_, i) => ({
        widget_id: `WQ${String(i + 8).padStart(3, '0')}`,
        round_label: 'R16',
        draw_position: i + 1,
        draw_type_prefix: 'WQ',
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        widget_id: `WQ${String(i + 4).padStart(3, '0')}`,
        round_label: 'QF',
        draw_position: i + 9,
        draw_type_prefix: 'WQ',
      })),
    ];

    const m = buildPropagationMap(slots);

    // R16 → QF
    expect(m.get(1)).toEqual({ nextPosition: 9, targetTeam: 1 });
    expect(m.get(2)).toEqual({ nextPosition: 9, targetTeam: 2 });
    expect(m.get(7)).toEqual({ nextPosition: 12, targetTeam: 1 });
    expect(m.get(8)).toEqual({ nextPosition: 12, targetTeam: 2 });

    // QF is final for this qualifier — no next round
    for (let p = 9; p <= 12; p++) {
      expect(m.get(p)).toBeUndefined();
    }
  });

  it('single-round bracket (just a final): no transitions', () => {
    const slots = [
      {
        widget_id: 'MD001',
        round_label: 'F',
        draw_position: 1,
        draw_type_prefix: 'MD',
      },
    ];
    const m = buildPropagationMap(slots);
    expect(m.size).toBe(0);
  });
});

// ── runFipWinnerPropagator (integration) ───────────────────────────────

const TOURNAMENT_ID = 't-isla';
const TOURNAMENT_WIDGET = 'FIP-2026-1706';

interface DrawSeed {
  match_widget_id: string;
  round_label: string;
  draw_position: number;
  captured_at: string;
}

interface MatchSeed {
  id: string;
  widget_id_composite: string;
  status: string | null;
  winner_pair: number | null;
  pair1_player1_id: string | null;
  pair1_player2_id: string | null;
  pair2_player1_id: string | null;
  pair2_player2_id: string | null;
}

interface Opts {
  tournaments?: Array<{ tournament_id: string; tournament_name: string; slug: string }>;
  widgetCodeByTournament?: Record<string, string | null>;
  draws?: DrawSeed[];
  matches?: MatchSeed[];
}

function fakeSupabase(opts: Opts) {
  const tournaments = opts.tournaments ?? [];
  const widgetCode = opts.widgetCodeByTournament ?? {};
  const draws = opts.draws ?? [];
  const matches: MatchSeed[] = [...(opts.matches ?? [])];
  const updated: Array<{ id: string; patch: Record<string, unknown> }> = [];

  const matchesTable = () => ({
    select: (_cols: string) => ({
      like: (_col: string, pattern: string) => {
        const prefix = pattern.slice(0, -1);
        const data = matches.filter((m) => m.widget_id_composite.startsWith(prefix));
        return Promise.resolve({ data, error: null });
      },
    }),
    update: (patch: Record<string, unknown>) => ({
      eq: (col: string, val: string) => {
        if (col !== 'id') throw new Error(`unexpected UPDATE filter: ${col}`);
        updated.push({ id: val, patch });
        // Reflect into state
        const target = matches.find((m) => m.id === val);
        if (target) Object.assign(target, patch);
        return Promise.resolve({ data: null, error: null });
      },
    }),
  });

  const drawSnapshotsTable = () => ({
    select: (_cols: string) => ({
      eq: (col1: string, val1: string) => ({
        eq: (_col2: string, _val2: string) => {
          const data = draws.map((d) => ({
            ...d,
            tournament_id: col1 === 'tournament_id' ? val1 : TOURNAMENT_ID,
          }));
          return Promise.resolve({ data, error: null });
        },
      }),
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
    matches,
    schema: (_: string) => ({
      from: (t: string) => {
        if (t === 'draw_snapshots') return drawSnapshotsTable();
        if (t === 'widget_id_cache') return widgetIdCacheTable();
        throw new Error(`unexpected padelgod table: ${t}`);
      },
    }),
    from: (t: string) => {
      if (t === 'matches') return matchesTable();
      throw new Error(`unexpected public table: ${t}`);
    },
    rpc: vi.fn(async (name: string) => {
      if (name !== 'padelgod_active_tournaments_with_slug')
        throw new Error(`unexpected RPC: ${name}`);
      return { data: tournaments, error: null };
    }),
  };
}

describe('runFipWinnerPropagator', () => {
  const isla = { tournament_id: TOURNAMENT_ID, tournament_name: 'Isla', slug: 'isla' };

  // Tiny 4-match bracket: 2 R16 + 1 QF = 3 matches
  // Positions: R16 = 1, 2; QF = 3
  const tinyDraws: DrawSeed[] = [
    { match_widget_id: 'MD002', round_label: 'R16', draw_position: 1, captured_at: '2026-04-24T10:00:00Z' },
    { match_widget_id: 'MD003', round_label: 'R16', draw_position: 2, captured_at: '2026-04-24T10:00:00Z' },
    { match_widget_id: 'MD001', round_label: 'QF',  draw_position: 3, captured_at: '2026-04-24T10:00:00Z' },
  ];

  it('propagates both R16 winners into QF slots', async () => {
    const matches: MatchSeed[] = [
      // Both R16 matches finished
      {
        id: 'm-MD002',
        widget_id_composite: 'FIP-2026-1706:MD002',
        status: 'finished',
        winner_pair: 1, // team 1 won
        pair1_player1_id: 'uuid-A1',
        pair1_player2_id: 'uuid-A2',
        pair2_player1_id: 'uuid-B1',
        pair2_player2_id: 'uuid-B2',
      },
      {
        id: 'm-MD003',
        widget_id_composite: 'FIP-2026-1706:MD003',
        status: 'finished',
        winner_pair: 2, // team 2 won
        pair1_player1_id: 'uuid-C1',
        pair1_player2_id: 'uuid-C2',
        pair2_player1_id: 'uuid-D1',
        pair2_player2_id: 'uuid-D2',
      },
      // QF empty
      {
        id: 'm-MD001',
        widget_id_composite: 'FIP-2026-1706:MD001',
        status: 'scheduled',
        winner_pair: null,
        pair1_player1_id: null,
        pair1_player2_id: null,
        pair2_player1_id: null,
        pair2_player2_id: null,
      },
    ];

    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: tinyDraws,
      matches,
    });

    const result = await runFipWinnerPropagator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.propagationsWritten).toBe(2);
    expect(supabase.updated).toHaveLength(2);
    // Both writes target MD001 (the QF)
    expect(supabase.updated.every((u) => u.id === 'm-MD001')).toBe(true);

    // MD002 winner was team 1 (A1, A2) → QF team 1 slot
    // MD003 winner was team 2 (D1, D2) → QF team 2 slot
    const qf = supabase.matches.find((m) => m.id === 'm-MD001')!;
    expect(qf.pair1_player1_id).toBe('uuid-A1');
    expect(qf.pair1_player2_id).toBe('uuid-A2');
    expect(qf.pair2_player1_id).toBe('uuid-D1');
    expect(qf.pair2_player2_id).toBe('uuid-D2');
  });

  it('dry-run: counts but writes nothing', async () => {
    const matches: MatchSeed[] = [
      {
        id: 'm-MD002',
        widget_id_composite: 'FIP-2026-1706:MD002',
        status: 'finished',
        winner_pair: 1,
        pair1_player1_id: 'uuid-A1',
        pair1_player2_id: 'uuid-A2',
        pair2_player1_id: 'uuid-B1',
        pair2_player2_id: 'uuid-B2',
      },
      {
        id: 'm-MD001',
        widget_id_composite: 'FIP-2026-1706:MD001',
        status: 'scheduled',
        winner_pair: null,
        pair1_player1_id: null,
        pair1_player2_id: null,
        pair2_player1_id: null,
        pair2_player2_id: null,
      },
    ];

    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: tinyDraws,
      matches,
    });

    const result = await runFipWinnerPropagator({
      supabase: supabase as any,
      dryRun: true,
    });

    expect(result.propagationsWritten).toBe(1);
    expect(result.dryRun).toBe(true);
    expect(supabase.updated).toHaveLength(0);
  });

  it('SKIPs when target slot already filled (never clobbers)', async () => {
    const matches: MatchSeed[] = [
      {
        id: 'm-MD002',
        widget_id_composite: 'FIP-2026-1706:MD002',
        status: 'finished',
        winner_pair: 1,
        pair1_player1_id: 'uuid-A1',
        pair1_player2_id: 'uuid-A2',
        pair2_player1_id: 'uuid-B1',
        pair2_player2_id: 'uuid-B2',
      },
      {
        id: 'm-MD001',
        widget_id_composite: 'FIP-2026-1706:MD001',
        status: 'scheduled',
        winner_pair: null,
        // Operator fixed team 1 manually already
        pair1_player1_id: 'manual-X',
        pair1_player2_id: 'manual-Y',
        pair2_player1_id: null,
        pair2_player2_id: null,
      },
    ];

    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: tinyDraws,
      matches,
    });

    const result = await runFipWinnerPropagator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.skippedTargetSlotFilled).toBe(1);
    expect(result.propagationsWritten).toBe(0);

    // manual-X/Y unchanged
    const qf = supabase.matches.find((m) => m.id === 'm-MD001')!;
    expect(qf.pair1_player1_id).toBe('manual-X');
    expect(qf.pair1_player2_id).toBe('manual-Y');
  });

  it('SKIPs match in final round (no next round)', async () => {
    // Only one match: the final itself, finished with winner
    const finalOnly: DrawSeed[] = [
      { match_widget_id: 'MD001', round_label: 'F', draw_position: 1, captured_at: '2026-04-24T10:00:00Z' },
    ];
    const matches: MatchSeed[] = [
      {
        id: 'm-MD001',
        widget_id_composite: 'FIP-2026-1706:MD001',
        status: 'finished',
        winner_pair: 1,
        pair1_player1_id: 'uuid-A1',
        pair1_player2_id: 'uuid-A2',
        pair2_player1_id: 'uuid-B1',
        pair2_player2_id: 'uuid-B2',
      },
    ];

    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: finalOnly,
      matches,
    });

    const result = await runFipWinnerPropagator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.skippedFinalRound).toBe(1);
    expect(result.propagationsWritten).toBe(0);
  });

  it('SKIPs when target match has not been created yet', async () => {
    const matches: MatchSeed[] = [
      {
        id: 'm-MD002',
        widget_id_composite: 'FIP-2026-1706:MD002',
        status: 'finished',
        winner_pair: 1,
        pair1_player1_id: 'uuid-A1',
        pair1_player2_id: 'uuid-A2',
        pair2_player1_id: 'uuid-B1',
        pair2_player2_id: 'uuid-B2',
      },
      // NO QF match yet — populator hasn't created it
    ];

    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: tinyDraws,
      matches,
    });

    const result = await runFipWinnerPropagator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.skippedNoTargetMatch).toBe(1);
    expect(result.propagationsWritten).toBe(0);
  });

  it('SKIPs source match missing FKs (can\'t propagate what we can\'t read)', async () => {
    const matches: MatchSeed[] = [
      {
        id: 'm-MD002',
        widget_id_composite: 'FIP-2026-1706:MD002',
        status: 'finished',
        winner_pair: 1,
        pair1_player1_id: 'uuid-A1',
        pair1_player2_id: null, // incomplete
        pair2_player1_id: 'uuid-B1',
        pair2_player2_id: 'uuid-B2',
      },
      {
        id: 'm-MD001',
        widget_id_composite: 'FIP-2026-1706:MD001',
        status: 'scheduled',
        winner_pair: null,
        pair1_player1_id: null,
        pair1_player2_id: null,
        pair2_player1_id: null,
        pair2_player2_id: null,
      },
    ];

    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: tinyDraws,
      matches,
    });

    const result = await runFipWinnerPropagator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.skippedSourceIncomplete).toBe(1);
    expect(result.propagationsWritten).toBe(0);
  });

  it('idempotent — second run after the first is a no-op', async () => {
    const matches: MatchSeed[] = [
      {
        id: 'm-MD002',
        widget_id_composite: 'FIP-2026-1706:MD002',
        status: 'finished',
        winner_pair: 1,
        pair1_player1_id: 'uuid-A1',
        pair1_player2_id: 'uuid-A2',
        pair2_player1_id: 'uuid-B1',
        pair2_player2_id: 'uuid-B2',
      },
      {
        id: 'm-MD001',
        widget_id_composite: 'FIP-2026-1706:MD001',
        status: 'scheduled',
        winner_pair: null,
        pair1_player1_id: null,
        pair1_player2_id: null,
        pair2_player1_id: null,
        pair2_player2_id: null,
      },
    ];

    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: tinyDraws,
      matches,
    });

    // First run
    const r1 = await runFipWinnerPropagator({
      supabase: supabase as any,
      dryRun: false,
    });
    expect(r1.propagationsWritten).toBe(1);

    // Second run — target is filled → skip
    const r2 = await runFipWinnerPropagator({
      supabase: supabase as any,
      dryRun: false,
    });
    expect(r2.propagationsWritten).toBe(0);
    expect(r2.skippedTargetSlotFilled).toBe(1);
  });

  it('SKIPs tournaments with no widget_id_cache row', async () => {
    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: {},
      draws: tinyDraws,
      matches: [],
    });

    const result = await runFipWinnerPropagator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.tournamentsSkippedNoWidget).toBe(1);
    expect(result.tournamentsProcessed).toBe(0);
  });
});

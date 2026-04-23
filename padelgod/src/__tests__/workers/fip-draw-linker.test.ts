import { describe, it, expect, vi } from 'vitest';
import { runFipDrawLinker } from '../../workers/fip-draw-linker.js';

/**
 * Fake supabase that fully exercises the linker's read/write paths:
 *   - rpc('padelgod_active_tournaments_for_static_workers') → activeTournaments
 *   - .schema('padelgod').from('draw_snapshots') → drawRows
 *   - .from('matches').select(...) → publicMatches
 *   - .from('entity_external_ids').select(...) → existingLinkages
 *   - .from('entity_external_ids').upsert(...) → captured in `upserted`
 */
function fakeSupabase(opts: {
  activeTournaments: any[];
  drawRows: any[];
  publicMatches: any[];
  existingLinkages: any[];
  upsertError?: { message: string };
}) {
  const upserted: any[] = [];

  const supabase = {
    upserted,
    rpc: vi.fn(async (name: string) => {
      if (name === 'padelgod_active_tournaments_for_static_workers') {
        return { data: opts.activeTournaments, error: null };
      }
      return { data: null, error: { message: `unexpected rpc: ${name}` } };
    }),
    schema: () => ({
      from: (t: string) => {
        if (t === 'draw_snapshots') {
          // Chainable: .select().eq().eq().not().order() → await
          return chainable({ data: opts.drawRows, error: null });
        }
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => Promise.resolve({ data: null, error: { message: `unexpected padelgod.${t}` } }),
              }),
            }),
          }),
        };
      },
    }),
    from: (t: string) => {
      if (t === 'matches') {
        return chainable({ data: opts.publicMatches, error: null });
      }
      if (t === 'entity_external_ids') {
        const readChain = chainable({ data: opts.existingLinkages, error: null });
        readChain.upsert = (rows: any, _opts: any) => {
          if (opts.upsertError) {
            return Promise.resolve({ data: null, error: opts.upsertError });
          }
          const arr = Array.isArray(rows) ? rows : [rows];
          upserted.push(...arr);
          return Promise.resolve({ data: arr, error: null });
        };
        return readChain;
      }
      return chainable({ data: null, error: { message: `unexpected from ${t}` } });
    },
  };
  return supabase;
}

/**
 * Build a chainable object that ends in a Promise-like so `await` works
 * on any suffix of `.eq().eq().not().order()` etc. The fake doesn't
 * actually filter — we hand back whatever data the test set up.
 */
function chainable(result: { data: any; error: any }) {
  const chain: any = {};
  const methods = ['select', 'eq', 'neq', 'not', 'in', 'order', 'limit', 'like'];
  for (const m of methods) chain[m] = () => chain;
  // `.then` makes the chain awaitable.
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

const BRUSSELS_TOURNAMENT = {
  tournament_id: 'brussels-uuid',
  tournament_name: 'Brussels P2 2026',
  widget_id: 'FIP-2026-1701',
  starts_at: '2026-04-20T00:00:00Z',
  ends_at: '2026-04-27T00:00:00Z',
  expected_days: 8,
};

const WQ011_DRAW = {
  tournament_id: 'brussels-uuid',
  match_widget_id: 'WQ011',
  category: 'women' as const,
  round_label: 'R16',
  team1_player1_name: 'Camila Fassio Goyeneche',
  team1_player2_name: 'Aida Martinez',
  team2_player1_name: 'Nuria Rodriguez Camacho',
  team2_player2_name: 'Giulia Dal Pozzo',
  team1_fip_id: 'P201785',
  team2_fip_id: 'P000456',
  status: 'finished' as const,
  captured_at: '2026-04-23T21:16:18.000Z',
};

const WQ011_PUBLIC_MATCH = {
  id: 'public-wq011-uuid',
  round: 'R16',
  category: 'women',
  pair1_player1: { name: 'Nuria Rodriguez Camacho' },
  pair1_player2: { name: 'Giulia Dal Pozzo' },
  pair2_player1: { name: 'Camila Fassio Goyeneche' },
  pair2_player2: { name: 'Aida Martinez' },
};

describe('runFipDrawLinker', () => {
  it('returns zeros when no active tournaments', async () => {
    const supabase = fakeSupabase({
      activeTournaments: [],
      drawRows: [],
      publicMatches: [],
      existingLinkages: [],
    });
    const result = await runFipDrawLinker({ supabase: supabase as any });
    expect(result).toEqual({
      tournamentsProcessed: 0,
      drawRowsConsidered: 0,
      linkagesProposed: 0,
      linkagesWritten: 0,
      linkagesSkippedAlreadyLinked: 0,
      dryRun: true,
    });
  });

  it('dry-run mode (default): proposes the WQ011 linkage but writes nothing', async () => {
    const supabase = fakeSupabase({
      activeTournaments: [BRUSSELS_TOURNAMENT],
      drawRows: [WQ011_DRAW],
      publicMatches: [WQ011_PUBLIC_MATCH],
      existingLinkages: [],
    });
    const result = await runFipDrawLinker({ supabase: supabase as any });
    expect(result.tournamentsProcessed).toBe(1);
    expect(result.drawRowsConsidered).toBe(1);
    expect(result.linkagesProposed).toBe(1);
    expect(result.linkagesWritten).toBe(0);
    expect(result.dryRun).toBe(true);
    expect(supabase.upserted).toHaveLength(0);
  });

  it('writes the linkage when dryRun=false', async () => {
    const supabase = fakeSupabase({
      activeTournaments: [BRUSSELS_TOURNAMENT],
      drawRows: [WQ011_DRAW],
      publicMatches: [WQ011_PUBLIC_MATCH],
      existingLinkages: [],
    });
    const result = await runFipDrawLinker(
      { supabase: supabase as any },
      { dryRun: false },
    );
    expect(result.linkagesWritten).toBe(1);
    expect(supabase.upserted).toHaveLength(1);
    expect(supabase.upserted[0]).toMatchObject({
      entity_type: 'match',
      entity_id: 'public-wq011-uuid',
      source: 'crionet_widget',
      external_id: 'FIP-2026-1701:WQ011',
    });
  });

  it('skips draw rows whose composite is already linked', async () => {
    const supabase = fakeSupabase({
      activeTournaments: [BRUSSELS_TOURNAMENT],
      drawRows: [WQ011_DRAW],
      publicMatches: [WQ011_PUBLIC_MATCH],
      // Simulating: live-poller or oop-fetcher already linked WQ011.
      existingLinkages: [
        { external_id: 'FIP-2026-1701:WQ011', entity_id: 'public-wq011-uuid' },
      ],
    });
    const result = await runFipDrawLinker(
      { supabase: supabase as any },
      { dryRun: false },
    );
    expect(result.linkagesProposed).toBe(0);
    expect(result.linkagesWritten).toBe(0);
    expect(result.linkagesSkippedAlreadyLinked).toBe(1);
    expect(supabase.upserted).toHaveLength(0);
  });

  it('skips a public.matches row that is already linked to a different widget', async () => {
    // The public match has an existing link under a different widget id
    // (e.g. a live-poller link that misfired). Linker should refuse to
    // add a second composite pointing at the same match UUID.
    const supabase = fakeSupabase({
      activeTournaments: [BRUSSELS_TOURNAMENT],
      drawRows: [WQ011_DRAW],
      publicMatches: [WQ011_PUBLIC_MATCH],
      existingLinkages: [
        {
          external_id: 'FIP-2026-1701:WRONG001', // SOME other widget already claimed this match
          entity_id: 'public-wq011-uuid',
        },
      ],
    });
    const result = await runFipDrawLinker(
      { supabase: supabase as any },
      { dryRun: false },
    );
    // The draw row itself isn't "already linked" — but the candidate
    // public.matches row is excluded, so no bipartite match is found.
    expect(result.linkagesProposed).toBe(0);
    expect(supabase.upserted).toHaveLength(0);
  });

  it('dedupes multiple captures of the same widget_id, keeping the latest', async () => {
    const olderRow = {
      ...WQ011_DRAW,
      // Older capture with missing partner name — would be insufficient
      // if it were the only version, but the newer row should win.
      team2_player2_name: null,
      captured_at: '2026-04-22T00:00:00.000Z',
    };
    const supabase = fakeSupabase({
      activeTournaments: [BRUSSELS_TOURNAMENT],
      // Supabase query orders by captured_at DESC, so the newer row is first.
      drawRows: [WQ011_DRAW, olderRow],
      publicMatches: [WQ011_PUBLIC_MATCH],
      existingLinkages: [],
    });
    const result = await runFipDrawLinker(
      { supabase: supabase as any },
      { dryRun: false },
    );
    expect(result.drawRowsConsidered).toBe(1); // dedup to 1 latest per widget
    expect(result.linkagesWritten).toBe(1);
  });

  it('reports the upsert error but does not throw', async () => {
    const supabase = fakeSupabase({
      activeTournaments: [BRUSSELS_TOURNAMENT],
      drawRows: [WQ011_DRAW],
      publicMatches: [WQ011_PUBLIC_MATCH],
      existingLinkages: [],
      upsertError: { message: 'RLS denied' },
    });
    const result = await runFipDrawLinker(
      { supabase: supabase as any },
      { dryRun: false },
    );
    expect(result.linkagesProposed).toBe(1);
    expect(result.linkagesWritten).toBe(0); // write failed, counter stays 0
  });
});

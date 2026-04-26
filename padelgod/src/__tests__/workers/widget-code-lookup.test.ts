import { describe, it, expect, vi } from 'vitest';
import { runWidgetCodeLookup, chooseCandidate } from '../../workers/widget-code-lookup.js';

function fakeSupabase(needingResolution: any[]) {
  const inserted: any[] = [];
  // Records upserts to `public.entity_external_ids` via the top-level
  // `.from()` method (the widget-code-lookup worker mirrors every
  // discovered widget_id into the sidecar so ops Tournament Explorer can
  // resolve matches without reaching into the padelgod schema). Tests
  // assert on this array to pin the dual-write behaviour.
  const entityExternalIdsUpserted: any[] = [];
  return {
    inserted,
    entityExternalIdsUpserted,
    schema: (_s: string) => ({
      from: (t: string) => ({
        insert: (row: any) => {
          if (t === 'widget_id_cache') {
            inserted.push(row);
            return Promise.resolve({ data: row, error: null });
          }
          if (t === 'scrape_jobs') {
            const jobRow = { id: 'job-uuid', ...row };
            return {
              select: () => ({
                single: async () => ({ data: jobRow, error: null }),
              }),
            };
          }
          if (t === 'raw_payloads') {
            return {
              select: () => ({
                single: async () => ({ data: row, error: null }),
              }),
            };
          }
          return Promise.resolve({ data: null, error: { message: 'unexpected' } });
        },
        update: () => ({
          eq: async () => ({ data: null, error: null }),
        }),
        select: () => ({
          single: async () => ({ data: {}, error: null }),
        }),
      }),
    }),
    // Top-level `.from()` for the public schema — only exercises the path
    // used by `syncWidgetIdToEntityExternalIds`. Extend when other public-
    // schema writes are added.
    from: (t: string) => ({
      upsert: (row: any, _opts?: any) => {
        if (t === 'entity_external_ids') {
          entityExternalIdsUpserted.push(row);
          return Promise.resolve({ data: row, error: null });
        }
        return Promise.resolve({ data: null, error: { message: `unexpected table ${t}` } });
      },
    }),
    rpc: vi.fn(async (_name: string) => ({ data: needingResolution, error: null })),
  };
}

describe('runWidgetCodeLookup', () => {
  it('writes widget_id_cache row when search returns exactly one match', async () => {
    const supabase = fakeSupabase([
      { tournament_id: 'tour-uuid-1', tournament_name: 'Brussels P2', year: 2026 },
    ]);
    const httpClient = {
      post: vi.fn(async () => ({
        data: `<div class="card tournament-card">
          <div class="card-header tournament-card-header tournament-card-header-live">
            <div class="tournament-name">BRUSSELS P2</div>
            <span class="tournament-code">1701</span>
          </div>
        </div>`,
      })),
    };

    const result = await runWidgetCodeLookup({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });

    expect(result.resolved).toBe(1);
    expect(supabase.inserted[0]).toMatchObject({
      tournament_id: 'tour-uuid-1',
      widget_id: 'FIP-2026-1701',
      extraction_method: 'search',
    });
    // Dual-write check: the discovered widget_id must ALSO land in
    // public.entity_external_ids so the ops Tournament Explorer can
    // resolve widget-composite external ids → public.matches links.
    // See syncWidgetIdToEntityExternalIds in the worker for rationale.
    expect(supabase.entityExternalIdsUpserted).toHaveLength(1);
    expect(supabase.entityExternalIdsUpserted[0]).toMatchObject({
      entity_type: 'tournament',
      entity_id: 'tour-uuid-1',
      source: 'crionet_widget',
      external_id: 'FIP-2026-1701',
    });
  });

  it('skips and logs when search returns zero matches', async () => {
    const supabase = fakeSupabase([
      { tournament_id: 'tour-uuid-2', tournament_name: 'Unknown Event', year: 2026 },
    ]);
    const httpClient = {
      post: vi.fn(async () => ({
        data: '<div class="text-center text-light">No tournaments found</div>',
      })),
    };

    const result = await runWidgetCodeLookup({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });

    expect(result.resolved).toBe(0);
    expect(result.skipped).toBe(1);
    expect(supabase.inserted).toHaveLength(0);
  });

  it('resolves to exact-name match when search returns multiple candidates', async () => {
    // 2026-04-27 audit: Crionet returned 2 candidates for "ASUNCION" —
    // FIP PROMISES ASUNCION I and ASUNCION P2. The pre-fix worker bailed
    // on ambiguity; with the disambiguator it should pick the exact name
    // match (ASUNCION P2) and write its widget_id.
    const supabase = fakeSupabase([
      { tournament_id: 'tour-uuid-3', tournament_name: 'ASUNCION P2', year: 2026 },
    ]);
    const httpClient = {
      post: vi.fn(async () => ({
        data: `
          <div class="card tournament-card">
            <div class="tournament-name">FIP PROMISES ASUNCION I</div>
            <span class="tournament-code">P0209</span>
          </div>
          <div class="card tournament-card">
            <div class="tournament-name">ASUNCION P2</div>
            <span class="tournament-code">2111</span>
          </div>
        `,
      })),
    };

    const result = await runWidgetCodeLookup({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });

    expect(result.resolved).toBe(1);
    expect(supabase.inserted).toHaveLength(1);
    expect(supabase.inserted[0]).toMatchObject({
      tournament_id: 'tour-uuid-3',
      widget_id: 'FIP-2026-2111', // not P0209 — exact name match wins
    });
  });
});

describe('chooseCandidate', () => {
  const mk = (name: string, code: string) => ({ code, name, isLive: false });

  it('returns null on empty candidate list', () => {
    expect(chooseCandidate([], 'Brussels P2')).toBeNull();
  });

  it('returns the only candidate when length is 1', () => {
    const c = mk('BRUSSELS P2', 'FIP-2026-1701');
    expect(chooseCandidate([c], 'Brussels P2')).toBe(c);
  });

  it('disambiguates by exact-name match (case-insensitive)', () => {
    const promises = mk('FIP PROMISES ASUNCION I', 'FIP-2026-P0209');
    const p2 = mk('ASUNCION P2', 'FIP-2026-2111');
    expect(chooseCandidate([promises, p2], 'Asuncion P2')).toBe(p2);
  });

  it('strips accents when matching (Sao Paulo vs São Paulo)', () => {
    const accented = mk('SÃO PAULO P1', 'FIP-2026-AAAA');
    const other = mk('FIP PROMISES SAO PAULO', 'FIP-2026-BBBB');
    expect(chooseCandidate([other, accented], 'Sao Paulo P1')).toBe(accented);
  });

  it('strips HTML entities (&#8211; en-dash) when matching', () => {
    // Pre-fix audit found names with HTML entities in DB rows that
    // Crionet returns without them (or vice-versa). Normalise both
    // sides to plain ASCII before equality test.
    const withEntity = mk('FIP PROMISES PERUGIA II', 'FIP-2026-AAAA');
    expect(
      chooseCandidate(
        [withEntity, mk('OTHER', 'FIP-2026-BBBB')],
        'FIP PROMISES SANREMO PADEL EXPERIENCE &#8211; PERUGIA II',
      ),
    ).toBeNull(); // No exact match because the prefix differs — caller must skip
  });

  it('returns null when no exact match is found among many', () => {
    const a = mk('SOMETHING ELSE', 'FIP-2026-1');
    const b = mk('ANOTHER THING', 'FIP-2026-2');
    expect(chooseCandidate([a, b], 'Brussels P2')).toBeNull();
  });

  it('returns null when multiple candidates have the SAME exact name', () => {
    // Crionet duplicates do happen — observed in the 2026-04-27 audit.
    // We can't pick deterministically, so skip and let a human decide.
    const dup1 = mk('ASUNCION P2', 'FIP-2026-2111');
    const dup2 = mk('ASUNCION P2', 'FIP-2026-2111');
    expect(chooseCandidate([dup1, dup2], 'Asuncion P2')).toBeNull();
  });
});

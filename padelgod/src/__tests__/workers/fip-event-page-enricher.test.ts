import { describe, it, expect } from 'vitest';
import { needsEnrichment, type TournamentRow } from '../../workers/fip-event-page-enricher.js';
import { runFipEventPageEnricher } from '../../workers/fip-event-page-enricher.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('needsEnrichment', () => {
  const baseRow: TournamentRow = {
    id: 't1',
    slug: 'fip-bronze-test-2026',
    fip_id: 'fip-bronze-test-2026',
    matchscorer_url: null,
    starts_at: null,
    ends_at: null,
    venue: null,
    venue_address: null,
    venue_type: null,
    signup_fee_eur: null,
    schedule_notes: null,
    round_schedule: null,
    draw_size_md: null,
    draw_size_qd: null,
    registration_status: null,
    prize_money_fip: null,
    prize_breakdown: null,
    level: null,
  };

  it('returns true when matchscorer_url is missing', () => {
    expect(needsEnrichment({ ...baseRow, matchscorer_url: null })).toBe(true);
  });

  it('returns true when starts_at is missing', () => {
    expect(
      needsEnrichment({ ...baseRow, matchscorer_url: 'X', starts_at: null }),
    ).toBe(true);
  });

  it('returns true when venue is missing', () => {
    expect(
      needsEnrichment({
        ...baseRow,
        matchscorer_url: 'X',
        starts_at: '2026-04-01',
        ends_at: '2026-04-07',
        venue: null,
      }),
    ).toBe(true);
  });

  it('returns false when all enrichable fields are populated AND the tournament has ended', () => {
    // Past ends_at + everything filled in → no work needed.
    expect(
      needsEnrichment({
        ...baseRow,
        matchscorer_url: 'FIP-2026-1234',
        starts_at: '2020-04-01',
        ends_at: '2020-04-07',
        venue: 'Some Club',
        registration_status: 'closed',
        prize_money_fip: 10000,
        prize_breakdown: { tiers: [] }, // PR 3 — also needed for completeness
      }),
    ).toBe(false);
  });

  it('returns true for current/upcoming tournaments even when all fields are populated', () => {
    // Registration status flips open → closed during the event life
    // cycle; we want to keep refreshing it for active or future
    // tournaments. ends_at = null counts as "future" too.
    const futureEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(
      needsEnrichment({
        ...baseRow,
        matchscorer_url: 'FIP-2026-1234',
        starts_at: '2026-04-01',
        ends_at: futureEndsAt,
        venue: 'Some Club',
        registration_status: 'open',
        prize_money_fip: 10000,
      }),
    ).toBe(true);

    // ends_at = null also returns true (defensive).
    expect(
      needsEnrichment({
        ...baseRow,
        matchscorer_url: 'FIP-2026-1234',
        starts_at: '2026-04-01',
        ends_at: null,
        venue: 'Some Club',
        registration_status: 'open',
        prize_money_fip: 10000,
      }),
    ).toBe(true);
  });
});

const klHtml = readFileSync(
  join(__dirname, '..', 'fixtures', 'fip-event-kl.html'),
  'utf8',
);

describe('runFipEventPageEnricher — end to end', () => {
  it('fetches the FIP page, parses fields, and writes them to the row', async () => {
    const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];

    const supabase = {
      from: (table: string) => {
        if (table !== 'tournaments') {
          throw new Error(`unexpected table: ${table}`);
        }
        return {
          select: () => ({
            or: () => ({
              or: () => ({
                limit: async () => ({
                  data: [
                    {
                      id: 'kl-id',
                      slug: 'fip-bronze-kuala-lumpur-2026',
                      fip_id: 'fip-bronze-kuala-lumpur-2026',
                      matchscorer_url: null,
                      starts_at: null,
                      ends_at: null,
                      venue: null,
                      venue_address: null,
                      venue_type: null,
                      signup_fee_eur: null,
                      schedule_notes: null,
                      round_schedule: null,
                      draw_size_md: null,
                      draw_size_qd: null,
                      registration_status: null,
                      prize_money_fip: null,
                      prize_breakdown: null,
                      level: null,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              updates.push({ id, patch });
              return { error: null };
            },
          }),
        };
      },
    } as unknown as Parameters<typeof runFipEventPageEnricher>[0]['supabase'];

    const httpClient = {
      get: async () => ({ data: klHtml, headers: {} }),
    } as unknown as Parameters<typeof runFipEventPageEnricher>[0]['httpClient'];

    const result = await runFipEventPageEnricher({ supabase, httpClient });

    expect(result.enriched).toBe(1);
    expect(result.errors).toBe(0);
    expect(updates).toHaveLength(1);
    const patch = updates[0]!.patch;
    // KL fixture has venue, registration status, prize money, and dates
    // but no inline matchscorer JS block.
    expect(patch.venue).toBe('Pop Padel Kuala Lumpur');
    expect(patch.registration_status).toBe('closed');
    expect(patch.prize_money_fip).toBe(8500);
    expect(patch.starts_at).toBeTruthy();
    expect(patch.draw_size_md).toBe(32);          // KL fixture
    expect(patch.draw_size_qd).toBe(64);          // KL fixture
    expect(patch.venue_address).toContain('Kuala Lumpur');
    expect(patch.venue_type).toBe('covered');
    expect(patch.signup_fee_eur).toBe(40);
    expect(patch.schedule_notes).toBeTruthy();
    expect((patch.schedule_notes as string).split('\n').length).toBeGreaterThan(2);
    expect(patch.last_updated_by).toBe('padelgod');
  });

  it('captures and surfaces row-level fetch errors via the optional logger', async () => {
    const warnings: Array<{ msg: string; ctx: Record<string, unknown> }> = [];
    const logger = {
      warn: (ctx: Record<string, unknown>, msg: string) =>
        warnings.push({ msg, ctx }),
      // pino's Logger interface has more methods, but we only call `.warn`.
      // Cast through unknown so the test mock satisfies the interface.
    } as unknown as Parameters<typeof runFipEventPageEnricher>[0]['logger'];

    const supabase = {
      from: (table: string) => {
        if (table !== 'tournaments') throw new Error(`unexpected table: ${table}`);
        return {
          select: () => ({
            or: () => ({
              or: () => ({
                limit: async () => ({
                  data: [
                    {
                      id: 'failing-id',
                      slug: 'fip-bronze-failing-2026',
                      fip_id: 'fip-bronze-failing-2026',
                      matchscorer_url: null,
                      starts_at: null,
                      ends_at: null,
                      venue: null,
                      venue_address: null,
                      venue_type: null,
                      signup_fee_eur: null,
                      schedule_notes: null,
                      round_schedule: null,
                      draw_size_md: null,
                      draw_size_qd: null,
                      registration_status: null,
                      prize_money_fip: null,
                      prize_breakdown: null,
                      level: null,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      },
    } as unknown as Parameters<typeof runFipEventPageEnricher>[0]['supabase'];

    // Simulate an axios failure on fetch.
    const httpClient = {
      get: async () => {
        throw new Error('ECONNRESET');
      },
    } as unknown as Parameters<typeof runFipEventPageEnricher>[0]['httpClient'];

    const result = await runFipEventPageEnricher({ supabase, httpClient, logger });

    expect(result.errors).toBe(1);
    expect(result.enriched).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.msg).toContain('row failed');
    expect(warnings[0]!.ctx.slug).toBe('fip-bronze-failing-2026');
    expect(warnings[0]!.ctx.tournamentId).toBe('failing-id');
    expect(warnings[0]!.ctx.err).toContain('ECONNRESET');
  });

  it('mirrors matchscorer code into padelgod.widget_id_cache when the page parses one', async () => {
    // Regression test for the Leiria gap (2026-04-29): widget-code-
    // lookup hit its 12-attempt circuit breaker without finding the
    // Crionet code, but the FIP event page itself embedded
    // `FIP-2026-B0118` in the matchscorer JS block. Without this
    // mirror, downstream workers (oop-fetcher, fip-draw-populator)
    // saw an empty cache and skipped the tournament — leaving a
    // tournament with rich draw + entry list snapshots and zero
    // matches in public.matches.
    //
    // The Singapore B3 fixture has the alphanumeric eventID + JS
    // block that exercises this path.
    const singaporeHtml = readFileSync(
      join(__dirname, '..', 'fixtures', 'fip-event-singapore-b3.html'),
      'utf8',
    );

    const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const cacheUpserts: Array<Record<string, unknown>> = [];

    const supabase = {
      from: (table: string) => {
        if (table !== 'tournaments') {
          throw new Error(`unexpected public table: ${table}`);
        }
        return {
          select: () => ({
            or: () => ({
              or: () => ({
                limit: async () => ({
                  data: [
                    {
                      id: 'sg-id',
                      slug: 'fip-beyond-b3-singapore',
                      fip_id: 'fip-beyond-b3-singapore',
                      matchscorer_url: null,
                      starts_at: null,
                      ends_at: null,
                      venue: null,
                      venue_address: null,
                      venue_type: null,
                      signup_fee_eur: null,
                      schedule_notes: null,
                      round_schedule: null,
                      draw_size_md: null,
                      draw_size_qd: null,
                      registration_status: null,
                      prize_money_fip: null,
                      prize_breakdown: null,
                      level: null,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
            // Matchscorer-conflict probe: no other tournament owns
            // FIP-2026-B0118, so the write proceeds.
            eq: () => ({
              neq: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              updates.push({ id, patch });
              return { error: null };
            },
          }),
        };
      },
      schema: (name: string) => {
        if (name !== 'padelgod') {
          throw new Error(`unexpected schema: ${name}`);
        }
        return {
          from: (table: string) => {
            if (table !== 'widget_id_cache') {
              throw new Error(`unexpected padelgod table: ${table}`);
            }
            return {
              upsert: async (
                row: Record<string, unknown>,
                _opts: unknown,
              ) => {
                cacheUpserts.push(row);
                return { error: null };
              },
            };
          },
        };
      },
    } as unknown as Parameters<typeof runFipEventPageEnricher>[0]['supabase'];

    const httpClient = {
      get: async () => ({ data: singaporeHtml, headers: {} }),
    } as unknown as Parameters<typeof runFipEventPageEnricher>[0]['httpClient'];

    await runFipEventPageEnricher({ supabase, httpClient });

    // Tournament patch should still write matchscorer_url to public.tournaments
    expect(updates).toHaveLength(1);
    expect(updates[0]!.patch.matchscorer_url).toBe('FIP-2026-B0118');

    // AND the cache mirror should fire with the same code
    expect(cacheUpserts).toHaveLength(1);
    const cached = cacheUpserts[0]!;
    expect(cached.tournament_id).toBe('sg-id');
    expect(cached.widget_id).toBe('FIP-2026-B0118');
    expect(cached.is_active).toBe(true);
    // The CHECK constraint on widget_id_cache.extraction_method
    // limits values to ('search', 'iframe', 'page_regex', 'manual').
    // 'page_regex' is the right bucket — the code IS regex-extracted
    // from the FIP event page HTML.
    expect(cached.extraction_method).toBe('page_regex');
  });

  it('skips matchscorer_url write when another tournament already owns the code', async () => {
    // Detection layer guarding against the duplicate pattern that
    // produced FIP BRONZE ABU DHABI / FIP BRONZE DAMAC ABU DHABI both
    // carrying matchscorer_url=FIP-2026-1601: FIP's CMS publishes two
    // rows for the same physical tournament under different slugs, both
    // event pages embed the SAME matchscorer code. The discovery
    // `isPhysicalTwin` guard (PR #372) catches the sponsor-suffix
    // subset case, but not full rebrands — and any dup that predates
    // that guard sits in the DB until manually merged. Here we make
    // sure the enricher refuses to write a matchscorer code that
    // another tournament already owns, so the canonical row keeps
    // ownership and the dup stays detectable.
    //
    // Compose the fixture: KL (venue + dates + prize money + reg
    // status) + Singapore's matchscorer JS block. Lets us assert that
    // the *other* fields still land while matchscorer_url is held
    // back, instead of a no-op update.
    const singaporeHtml =
      klHtml +
      readFileSync(
        join(__dirname, '..', 'fixtures', 'fip-event-singapore-b3.html'),
        'utf8',
      );

    const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const cacheUpserts: Array<Record<string, unknown>> = [];
    const warnings: Array<{ msg: string; ctx: Record<string, unknown> }> = [];
    const logger = {
      warn: (ctx: Record<string, unknown>, msg: string) =>
        warnings.push({ msg, ctx }),
    } as unknown as Parameters<typeof runFipEventPageEnricher>[0]['logger'];

    const supabase = {
      from: (table: string) => {
        if (table !== 'tournaments') {
          throw new Error(`unexpected public table: ${table}`);
        }
        return {
          select: () => ({
            // Initial candidate fetch (existing path).
            or: () => ({
              or: () => ({
                limit: async () => ({
                  data: [
                    {
                      id: 'sg-id',
                      slug: 'fip-beyond-b3-singapore',
                      fip_id: 'fip-beyond-b3-singapore',
                      matchscorer_url: null,
                      starts_at: null,
                      ends_at: null,
                      venue: null,
                      venue_address: null,
                      venue_type: null,
                      signup_fee_eur: null,
                      schedule_notes: null,
                      round_schedule: null,
                      draw_size_md: null,
                      draw_size_qd: null,
                      registration_status: null,
                      prize_money_fip: null,
                      prize_breakdown: null,
                      level: null,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
            // Conflict-check chain (new path). Returns a canonical
            // tournament that already owns FIP-2026-B0118.
            eq: (_col: string, val: string) => ({
              neq: () => ({
                limit: () => ({
                  maybeSingle: async () => {
                    if (val === 'FIP-2026-B0118') {
                      return {
                        data: {
                          id: 'canonical-id',
                          name: 'FIP BEYOND CANONICAL',
                        },
                        error: null,
                      };
                    }
                    return { data: null, error: null };
                  },
                }),
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              updates.push({ id, patch });
              return { error: null };
            },
          }),
        };
      },
      schema: () => ({
        from: () => ({
          upsert: async (row: Record<string, unknown>) => {
            cacheUpserts.push(row);
            return { error: null };
          },
        }),
      }),
    } as unknown as Parameters<typeof runFipEventPageEnricher>[0]['supabase'];

    const httpClient = {
      get: async () => ({ data: singaporeHtml, headers: {} }),
    } as unknown as Parameters<typeof runFipEventPageEnricher>[0]['httpClient'];

    await runFipEventPageEnricher({ supabase, httpClient, logger });

    // The row still gets enriched for the OTHER fields the page
    // exposes — only matchscorer_url is held back.
    expect(updates).toHaveLength(1);
    expect(updates[0]!.patch.matchscorer_url).toBeUndefined();

    // widget_id_cache mirror is gated on the matchscorer write
    // succeeding — if we skipped the write, we must skip the mirror
    // too (otherwise we'd point a SECOND cache row at the same code,
    // and downstream workers would race over it).
    expect(cacheUpserts).toHaveLength(0);

    // The conflict must surface in logs so ops can run the merge.
    const conflictWarning = warnings.find((w) =>
      w.msg.toLowerCase().includes('matchscorer'),
    );
    expect(conflictWarning, 'expected a matchscorer-conflict warning').toBeDefined();
    expect(conflictWarning!.ctx).toMatchObject({
      matchscorerCode: 'FIP-2026-B0118',
      tournamentId: 'sg-id',
      conflictTournamentId: 'canonical-id',
    });
  });

  it('does NOT call widget_id_cache when the page has no matchscorer code', async () => {
    // KL fixture has venue + dates + prize money but no inline
    // matchscorer JS block — `parseMatchscorerIds` returns null. The
    // cache mirror should be a no-op in that case so we don't write
    // garbage rows. Verifies the `if (matchscorer?.code)` guard is
    // doing its job.
    const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const cacheUpserts: Array<Record<string, unknown>> = [];

    const supabase = {
      from: (table: string) => {
        if (table !== 'tournaments') throw new Error(`unexpected: ${table}`);
        return {
          select: () => ({
            or: () => ({
              or: () => ({
                limit: async () => ({
                  data: [
                    {
                      id: 'kl-id',
                      slug: 'fip-bronze-kuala-lumpur-2026',
                      fip_id: 'fip-bronze-kuala-lumpur-2026',
                      matchscorer_url: null,
                      starts_at: null,
                      ends_at: null,
                      venue: null,
                      venue_address: null,
                      venue_type: null,
                      signup_fee_eur: null,
                      schedule_notes: null,
                      draw_size_md: null,
                      draw_size_qd: null,
                      registration_status: null,
                      prize_money_fip: null,
                      prize_breakdown: null,
                      round_schedule: null,
                      level: null,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              updates.push({ id, patch });
              return { error: null };
            },
          }),
        };
      },
      schema: () => ({
        from: () => ({
          upsert: async (row: Record<string, unknown>) => {
            cacheUpserts.push(row);
            return { error: null };
          },
        }),
      }),
    } as unknown as Parameters<typeof runFipEventPageEnricher>[0]['supabase'];

    const httpClient = {
      get: async () => ({ data: klHtml, headers: {} }),
    } as unknown as Parameters<typeof runFipEventPageEnricher>[0]['httpClient'];

    await runFipEventPageEnricher({ supabase, httpClient });

    expect(updates).toHaveLength(1);
    // KL fixture has no matchscorer code → no cache write
    expect(updates[0]!.patch.matchscorer_url).toBeUndefined();
    expect(cacheUpserts).toHaveLength(0);
  });

  describe('round_schedule (Task 7)', () => {
    // Minimal HTML that contains a Play Order block with Premier-style
    // "MAIN DRAW : SEMI-FINALS" and "MAIN DRAW : FINALS" label lines
    // followed by date lines that parseScheduleNotes can resolve.
    // starts_at='2026-05-03', ends_at='2026-05-10' on the tournament row
    // supplies the context so the parser can anchor "9 May" → 2026-05-09.
    const scheduleHtml = `
      <html><body>
        <div class="overview__contentBlock">
          <span class="overview__title">Play Order</span>
          <div class="overview__listText">
            MAIN DRAW : SEMI-FINALS<br/>9 May<br/>
            MAIN DRAW : FINALS<br/>10 May
          </div>
        </div>
        <span class="overview__title">Venue</span>
        <p class="overview__text">Test Club</p>
      </body></html>
    `;

    it('writes round_schedule when parser finds Play Order text', async () => {
      const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];

      const supabase = {
        from: (table: string) => {
          if (table !== 'tournaments') throw new Error(`unexpected: ${table}`);
          return {
            select: () => ({
              or: () => ({
                or: () => ({
                  limit: async () => ({
                    data: [
                      {
                        id: 'sched-id',
                        slug: 'fip-gold-test-2026',
                        source: 'fip',
                        fip_id: 'fip-gold-test-2026',
                        matchscorer_url: null,
                        starts_at: '2026-05-03',
                        ends_at: '2026-05-10',
                        venue: null,
                        venue_address: null,
                        venue_type: null,
                        signup_fee_eur: null,
                        schedule_notes: null,
                        draw_size_md: null,
                        draw_size_qd: null,
                        registration_status: null,
                        prize_money_fip: null,
                        prize_breakdown: null,
                        round_schedule: null,
                        level: null,
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
            update: (patch: Record<string, unknown>) => ({
              eq: async (_col: string, id: string) => {
                updates.push({ id, patch });
                return { error: null };
              },
            }),
          };
        },
      } as unknown as Parameters<typeof runFipEventPageEnricher>[0]['supabase'];

      const httpClient = {
        get: async () => ({ data: scheduleHtml, headers: {} }),
      } as unknown as Parameters<typeof runFipEventPageEnricher>[0]['httpClient'];

      await runFipEventPageEnricher({ supabase, httpClient });

      expect(updates).toHaveLength(1);
      const patch = updates[0]!.patch;
      // Parser should produce sf → 2026-05-09 and f → 2026-05-10
      expect(patch.round_schedule).toBeDefined();
      const rs = patch.round_schedule as Record<string, string>;
      expect(rs.sf).toBe('2026-05-09');
      expect(rs.f).toBe('2026-05-10');
    });

    it('does not write round_schedule when parser returns empty object', async () => {
      // HTML with no Play Order block → parseOverviewFields returns
      // roundSchedule = {} → enricher must skip writing the column.
      const noScheduleHtml = `
        <html><body>
          <span class="overview__title">Venue</span>
          <p class="overview__text">Empty Club</p>
        </body></html>
      `;

      const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];

      const supabase = {
        from: (table: string) => {
          if (table !== 'tournaments') throw new Error(`unexpected: ${table}`);
          return {
            select: () => ({
              or: () => ({
                or: () => ({
                  limit: async () => ({
                    data: [
                      {
                        id: 'nosched-id',
                        slug: 'fip-gold-nosched-2026',
                        source: 'fip',
                        fip_id: 'fip-gold-nosched-2026',
                        matchscorer_url: null,
                        starts_at: '2026-05-03',
                        ends_at: '2026-05-10',
                        venue: null,
                        venue_address: null,
                        venue_type: null,
                        signup_fee_eur: null,
                        schedule_notes: null,
                        draw_size_md: null,
                        draw_size_qd: null,
                        registration_status: null,
                        prize_money_fip: null,
                        prize_breakdown: null,
                        round_schedule: null,
                        level: null,
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
            update: (patch: Record<string, unknown>) => ({
              eq: async (_col: string, id: string) => {
                updates.push({ id, patch });
                return { error: null };
              },
            }),
          };
        },
      } as unknown as Parameters<typeof runFipEventPageEnricher>[0]['supabase'];

      const httpClient = {
        get: async () => ({ data: noScheduleHtml, headers: {} }),
      } as unknown as Parameters<typeof runFipEventPageEnricher>[0]['httpClient'];

      await runFipEventPageEnricher({ supabase, httpClient });

      // The venue write still fires so there IS an update
      expect(updates).toHaveLength(1);
      // But round_schedule must NOT be in the patch
      expect(updates[0]!.patch.round_schedule).toBeUndefined();
    });
  });
});

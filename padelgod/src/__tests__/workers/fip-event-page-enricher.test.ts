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
});

import { describe, it, expect } from 'vitest';
import { needsEnrichment, type TournamentRow } from '../../workers/fip-event-page-enricher.js';

describe('needsEnrichment', () => {
  const baseRow: TournamentRow = {
    id: 't1',
    slug: 'fip-bronze-test-2026',
    fip_id: 'fip-bronze-test-2026',
    matchscorer_url: null,
    starts_at: null,
    ends_at: null,
    venue: null,
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

  it('returns false when all enrichable fields are populated', () => {
    expect(
      needsEnrichment({
        ...baseRow,
        matchscorer_url: 'FIP-2026-1234',
        starts_at: '2026-04-01',
        ends_at: '2026-04-07',
        venue: 'Some Club',
        registration_status: 'closed',
        prize_money_fip: 10000,
      }),
    ).toBe(false);
  });
});

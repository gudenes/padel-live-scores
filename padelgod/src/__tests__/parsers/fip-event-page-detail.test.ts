import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseEventDates,
  parseMatchscorerIds,
  parseDrawSizes,
  parseOverviewFields,
  parsePrizeBreakdown,
} from '../../parsers/fip-event-page-detail.js';

const fixtureDir = join(__dirname, '..', 'fixtures');
const klHtml = readFileSync(join(fixtureDir, 'fip-event-kl.html'), 'utf8');
const cyprusHtml = readFileSync(
  join(fixtureDir, 'fip-event-cyprus.html'),
  'utf8',
);
const singaporeHtml = readFileSync(
  join(fixtureDir, 'fip-event-singapore-b3.html'),
  'utf8',
);

describe('parseEventDates', () => {
  it('parses DD/MM/YYYY range from header', () => {
    const html = '<div>15/03/2025 - 22/03/2025</div>';
    expect(parseEventDates(html)).toEqual({
      startsAt: '2025-03-15',
      endsAt: '2025-03-22',
    });
  });

  it('prefers the labelled "Main draw" date over the header range', () => {
    const html = `
      <p>PRACTICE: Available 20/04/2026 - 22/04/2026</p>
      <span>Main draw 25/04/2026</span>
      <span>Last day 30/04/2026</span>
    `;
    const result = parseEventDates(html);
    expect(result.startsAt).toBe('2026-04-25');
  });

  it('returns nulls when no dates appear', () => {
    expect(parseEventDates('<p>nothing here</p>')).toEqual({
      startsAt: null,
      endsAt: null,
    });
  });

  it('falls back to the first single date if no range is present', () => {
    const html = '<p>Date: 05/09/2025</p>';
    expect(parseEventDates(html)).toEqual({
      startsAt: '2025-09-05',
      endsAt: null,
    });
  });
});

describe('parseMatchscorerIds', () => {
  it('parses numeric eventID + builds FIP-{year}-{id} code', () => {
    const html = `
      const eventYear = "2025";
      const eventID = "3301";
      const totalday = 5;
    `;
    const result = parseMatchscorerIds(html);
    expect(result).toEqual({
      year: '2025',
      id: '3301',
      totalDays: 5,
      code: 'FIP-2025-3301',
      widget: 'draw',
    });
  });

  it('accepts alphanumeric eventID for FIP Beyond / Promises', () => {
    const html = `
      const eventYear = "2026";
      const eventID   = "B0118";
      const totalday  = 4;
      const widget    = 'oopbyday';
    `;
    const result = parseMatchscorerIds(html);
    expect(result?.id).toBe('B0118');
    expect(result?.code).toBe('FIP-2026-B0118');
    expect(result?.widget).toBe('oopbyday');
    expect(result?.totalDays).toBe(4);
  });

  it('returns null when eventID is missing', () => {
    expect(parseMatchscorerIds('<p>no js block</p>')).toBeNull();
  });

  it('defaults widget to "draw" when not declared', () => {
    const html = 'const eventYear="2025";const eventID="42";const totalday=1;';
    expect(parseMatchscorerIds(html)?.widget).toBe('draw');
  });
});

describe('parseDrawSizes', () => {
  it('reads "Prize Money X€" suffix format (Bronze/Silver/Gold)', () => {
    const html = `
      <th>Prize Money</th><td>10,000€</td>
    `;
    expect(parseDrawSizes(html).prizeMoney).toBe(10000);
  });

  it('reads "Prize Money €X" prefix format (Premier)', () => {
    const html = `
      <span class="overview__title">Prize Money</span>
      <p>€264.534</p>
    `;
    expect(parseDrawSizes(html).prizeMoney).toBe(264534);
  });

  it('returns null when no labelled "Prize Money" appears', () => {
    // Sign-up fee should NOT leak into prize_money_fip.
    const html = `
      <span class="overview__title">Sign Up Fee</span>
      <p>60 € per player/category</p>
    `;
    expect(parseDrawSizes(html).prizeMoney).toBeNull();
  });

  it('reads main draw + qualifying draw from labelled fields', () => {
    const html = 'Main draw: 32 (26DA+4Q+2WC); Qualification draw: 16 (14DA+2WC)';
    const result = parseDrawSizes(html);
    expect(result.mainDraw).toBe(32);
    expect(result.qualifyingDraw).toBe(16);
  });
});

describe('parseOverviewFields', () => {
  it('reads venue + address + court conditions + registration status (KL fixture)', () => {
    const fields = parseOverviewFields(klHtml);
    expect(fields.venue).toBe('Pop Padel Kuala Lumpur');
    expect(fields.venueAddress).toContain('Kuala Lumpur');
    expect(fields.venueType).toBe('covered');
    expect(fields.registrationStatus).toBe('closed');
    expect(fields.signupFeeEur).toBe(40);
  });

  it('captures multiline schedule notes (Play Order block)', () => {
    const fields = parseOverviewFields(klHtml);
    expect(fields.scheduleNotes).toBeTruthy();
    expect(fields.scheduleNotes!.split('\n').length).toBeGreaterThan(3);
  });

  it('returns all-null when no overview block is present', () => {
    expect(parseOverviewFields('<html><body><p>nothing</p></body></html>')).toEqual({
      registrationStatus: null,
      signupFeeEur: null,
      venue: null,
      venueAddress: null,
      venueType: null,
      scheduleNotes: null,
    });
  });
});

describe('parsePrizeBreakdown', () => {
  it('parses all six rounds from the prize-distribution table (KL fixture)', () => {
    const breakdown = parsePrizeBreakdown(klHtml);
    expect(breakdown).not.toBeNull();
    expect(breakdown!.r32).toBe(0);
    expect(breakdown!.r16).toBe(0);
    expect(breakdown!.qf).toBe(111.56);
    expect(breakdown!.sf).toBe(212.5);
    expect(breakdown!.finalist).toBe(446.25);
    expect(breakdown!.winner).toBe(807.5);
    expect(breakdown!.currency).toBe('EUR');
    expect(breakdown!.per).toBe('player');
    expect(breakdown!.source).toBe('scraped');
  });

  it('returns null when no prize-distribution table exists', () => {
    expect(parsePrizeBreakdown('<html><body></body></html>')).toBeNull();
  });
});

// ── Real FIP page coverage — full-fixture parser smoke tests ───────────
//
// Each FIP tier publishes its event page with slightly different layouts
// + JS bundles. These tests exercise the parsers against three real
// (trimmed) fixtures captured 2026-04-28: Bronze (KL), Silver (Cyprus),
// FIP Beyond B3 (Singapore — alphanumeric eventID + oopbyday widget).
//
// The KL fixture is already covered by the parser-specific tests above;
// these add parity for Cyprus + Singapore so a future tier-rollout
// regression is caught here.

describe('parseOverviewFields — Cyprus fixture (FIP Silver)', () => {
  const fields = parseOverviewFields(cyprusHtml);

  it('captures venue + address', () => {
    expect(fields.venue).toBe('Padel Paradise Cyprus Club');
    expect(fields.venueAddress).toContain('Makronisou');
  });

  it('captures outdoor court conditions (Silver tier convention)', () => {
    expect(fields.venueType).toBe('outdoor');
  });

  it('captures registration status', () => {
    expect(fields.registrationStatus).toBe('closed');
  });
});

describe('parsePrizeBreakdown — Cyprus fixture (FIP Silver)', () => {
  const breakdown = parsePrizeBreakdown(cyprusHtml);

  it('captures the larger Silver-tier payouts', () => {
    expect(breakdown).not.toBeNull();
    expect(breakdown!.r32).toBe(0);
    expect(breakdown!.r16).toBe(102);
    expect(breakdown!.qf).toBe(190);
    expect(breakdown!.sf).toBe(382);
    expect(breakdown!.finalist).toBe(720);
    expect(breakdown!.winner).toBe(1440);
  });
});

describe('parseMatchscorerIds — Singapore fixture (FIP Beyond B3)', () => {
  // FIP Beyond pages use alphanumeric eventIDs and the 'oopbyday'
  // widget. These were the FIP Beyond B3 Singapore 2026 fix earlier
  // today — keep that bug from regressing.

  it('extracts alphanumeric eventID and oopbyday widget', () => {
    const result = parseMatchscorerIds(singaporeHtml);
    expect(result).not.toBeNull();
    expect(result!.year).toBe('2026');
    expect(result!.id).toBe('B0118');
    expect(result!.code).toBe('FIP-2026-B0118');
    expect(result!.widget).toBe('oopbyday');
    expect(result!.totalDays).toBe(4);
  });
});

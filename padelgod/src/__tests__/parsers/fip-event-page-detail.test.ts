import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseEventDates,
  parseMatchscorerIds,
  parseCanonicalEventSlug,
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
const qatarHtml = readFileSync(
  join(fixtureDir, 'fip-event-qatar-doha-bronze.html'),
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

  it('prefers the page header date range over the "Main draw" label', () => {
    // Priority flipped in commit 862e8623 — the header range matches
    // what users see on FIP (qualifying-inclusive window), while the
    // Main draw label is a sub-detail (the day MD play actually
    // starts). Listing dates need to match the FIP page header.
    const html = `
      <div class="event__date">20/04/2026 - 22/04/2026</div>
      <span>Main draw 25/04/2026</span>
      <span>Last day 30/04/2026</span>
    `;
    const result = parseEventDates(html);
    expect(result.startsAt).toBe('2026-04-20');
    expect(result.endsAt).toBe('2026-04-22');
  });

  it('falls back to the "Main draw" label when no header range is present', () => {
    // Older page formats expose only the labelled Main draw date.
    // Keep that as a fallback so we still capture a start date.
    const html = `<span>Main draw 25/04/2026</span>`;
    const result = parseEventDates(html);
    expect(result.startsAt).toBe('2026-04-25');
    expect(result.endsAt).toBeNull();
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

  it('parses substituted et-oop-data.php URL (FIP 2026 page shape)', () => {
    // FIP stopped emitting `const eventYear` / `const eventID` on live
    // event pages. The matchscorer identity now lives in the OOP iframe
    // URL: et-oop-data.php?year=2026&id=3414&day=4&totalday=5&widget=oopbyday
    const html = `
      <iframe data-src="/wp-content/themes/padelfiptheme/template-parts/event/endpoint/et-oop-data.php?year=2026&id=3414&day=4&totalday=5&widget=oopbyday"></iframe>
    `;
    const result = parseMatchscorerIds(html);
    expect(result).toEqual({
      year: '2026',
      id: '3414',
      totalDays: 5,
      code: 'FIP-2026-3414',
      widget: 'oopbyday',
    });
  });

  it('parses alphanumeric Promises id from et-oop-data.php', () => {
    const html =
      'et-oop-data.php?year=2026&id=P0534&day=3&totalday=4&widget=oopbyday';
    const result = parseMatchscorerIds(html);
    expect(result?.code).toBe('FIP-2026-P0534');
    expect(result?.widget).toBe('oopbyday');
    expect(result?.totalDays).toBe(4);
  });

  it('parses FIP-YYYY-ID from matchscorerlive widget URLs (team events)', () => {
    // World Cup qualifiers embed teamresults/groups widgets instead of
    // the eventYear JS block or et-oop-data.php.
    const html = `
      <iframe src="https://widget.matchscorerlive.com/screen/teamresults/FIP-2026-3416/1?t=tol"></iframe>
      <iframe src="https://widget.matchscorerlive.com/screen/groups/FIP-2026-3416?t=tol"></iframe>
    `;
    const result = parseMatchscorerIds(html);
    expect(result?.code).toBe('FIP-2026-3416');
    expect(result?.year).toBe('2026');
    expect(result?.id).toBe('3416');
  });

  it('prefers const eventYear/eventID when both formats are present', () => {
    const html = `
      const eventYear = "2025";
      const eventID = "3301";
      const totalday = 5;
      et-oop-data.php?year=2026&id=9999&totalday=3&widget=oopbyday
    `;
    const result = parseMatchscorerIds(html);
    expect(result?.code).toBe('FIP-2025-3301');
    expect(result?.widget).toBe('draw');
  });
});

describe('parseCanonicalEventSlug', () => {
  it('extracts slug from padelfip canonical link', () => {
    const html =
      '<link rel="canonical" href="https://www.padelfip.com/events/fip-bronze-castro-2026/" />';
    expect(parseCanonicalEventSlug(html)).toBe('fip-bronze-castro-2026');
  });

  it('accepts /es/events/ canonicals', () => {
    const html =
      '<link rel="canonical" href="https://www.padelfip.com/es/events/fip-silver-esc-padel-ii-2026/" />';
    expect(parseCanonicalEventSlug(html)).toBe('fip-silver-esc-padel-ii-2026');
  });

  it('returns null when no canonical event URL is present', () => {
    expect(parseCanonicalEventSlug('<p>no canonical</p>')).toBeNull();
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

  it('reads main + qualifying from Premier "Men\'s draw size" block layout', () => {
    // Real shape from padelfip.com Italy Major 2026 — overview block uses
    // separate "MAIN DRAW" / "QUALIFYING" sub-headings with men's first,
    // then women's. The previous regex captured "1" from a later "MAIN
    // DRAW : 1st ROUND" appearing in the Play Order block; this test
    // pins the block layout to men's main draw.
    const html = `
      <p>MAIN DRAW<br />
      Men´s draw size<br />
      48 (41DE + 4Q + 3WC)<br />
      Women´s draw size<br />
      40 (34DE + 4Q + 2WC)<br />
      QUALIFYING<br />
      Men´s draw size<br />
      24 (22DA + 2WC)<br />
      Women´s draw size<br />
      16 (15DA + 1WC)</p>
      <div class="overview__listText"><p>QUALIFYING<br />
      Men 31 May – 1 Jun<br />
      Q1 Sun 31 Start time : 10.30 am<br />
      MAIN DRAW : 1st ROUND<br />
      Tue 2 Jun<br />
      Start time : 10.30 am</p></div>
    `;
    const result = parseDrawSizes(html);
    expect(result.mainDraw).toBe(48);
    expect(result.qualifyingDraw).toBe(24);
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
      roundSchedule: {},
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

describe('parsePrizeBreakdown — FIP Platinum Albania (mixed European format)', () => {
  // Regression fixture: Albania publishes the table layout with two
  // different European number formats in the same table — "9.375"
  // (thousands separator) and "421,88" (decimal separator). The earlier
  // Layout-1 strip-comma path misread both (winner 9.375 → 9.38, r32
  // 421,88 → 42188). Captured 2026-05-24.
  it('parses European thousands ("9.375") and European decimal ("421,88") in table layout', () => {
    const html = `
      <html><body><table>
        <tbody>
          <tr><th scope="row">WINNER</th><td>9.375 €</td></tr>
          <tr><th scope="row">FINALIST</th><td>4.688 €</td></tr>
          <tr><th scope="row">SEMI FINAL</th><td>2.531 €</td></tr>
          <tr><th scope="row">QUARTER FINAL</th><td>1.406 €</td></tr>
          <tr><th scope="row">ROUND 16</th><td>750 €</td></tr>
          <tr><th scope="row">ROUND 32</th><td>421,88 €</td></tr>
        </tbody>
      </table></body></html>
    `;
    const breakdown = parsePrizeBreakdown(html);
    expect(breakdown).not.toBeNull();
    expect(breakdown!.winner).toBe(9375);
    expect(breakdown!.finalist).toBe(4688);
    expect(breakdown!.sf).toBe(2531);
    expect(breakdown!.qf).toBe(1406);
    expect(breakdown!.r16).toBe(750);
    expect(breakdown!.r32).toBe(421.88);
  });

  it('preserves single-decimal US-style values ("212.5")', () => {
    // Regression: the parsePrizeAmount fix has to keep trailing=1
    // values as decimals (KL fixture has sf=212.5, finalist=807.5),
    // not strip the period as thousands.
    const html = `
      <html><body><table>
        <tr><th scope="row">SEMI FINAL</th><td>212.5</td></tr>
        <tr><th scope="row">WINNER</th><td>807.5</td></tr>
      </table></body></html>
    `;
    const breakdown = parsePrizeBreakdown(html);
    expect(breakdown).not.toBeNull();
    expect(breakdown!.sf).toBe(212.5);
    expect(breakdown!.winner).toBe(807.5);
  });
});

describe('parsePrizeBreakdown — Qatar Doha II fixture (<p>-layout)', () => {
  it('parses the <p>+<br/>+dash layout used by some Bronze events', () => {
    const breakdown = parsePrizeBreakdown(qatarHtml);
    expect(breakdown).not.toBeNull();
    expect(breakdown!.winner).toBe(349.65);
    expect(breakdown!.finalist).toBe(262.33);
    expect(breakdown!.sf).toBe(175.09);
    expect(breakdown!.qf).toBe(87.28);
    expect(breakdown!.r16).toBe(54.82);
    expect(breakdown!.r32).toBe(0);
    expect(breakdown!.currency).toBe('EUR');
    expect(breakdown!.per).toBe('player');
    expect(breakdown!.source).toBe('scraped');
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

describe('parseOverviewFields — roundSchedule', () => {
  it('parses round_schedule from Play Order text', () => {
    // Synthetic overview HTML carrying a Premier-style Play Order block.
    const html = `
<span class="overview__title">Play Order:</span>
<div class="overview__listText">
MAIN DRAW: SEMI-FINALS<br>
9 May<br>
Start time : 2.00 pm<br>
MAIN DRAW : FINAL<br>
10 May<br>
Start time : 4.00 pm
</div>`;
    const result = parseOverviewFields(html, { startsAt: '2026-05-03', endsAt: '2026-05-10' });
    expect(result.roundSchedule).toEqual({
      sf: '2026-05-09',
      f: '2026-05-10',
    });
  });

  it('returns empty roundSchedule when no schedule notes present', () => {
    const html = '<div></div>';
    const result = parseOverviewFields(html, { startsAt: '2026-05-03', endsAt: '2026-05-10' });
    expect(result.roundSchedule).toEqual({});
  });

  it('returns empty roundSchedule when context is omitted (backwards-compat)', () => {
    // Existing callers that pass no context still work — they get an empty
    // roundSchedule and the rest of the OverviewFields shape unchanged.
    const html = `
<span class="overview__title">Play Order:</span>
<div class="overview__listText">
MAIN DRAW : FINAL<br>10 May
</div>`;
    const result = parseOverviewFields(html);
    expect(result.roundSchedule).toEqual({});
    // Other fields unaffected — schedule_notes still parsed (sanity check)
    expect(result.scheduleNotes).toMatch(/MAIN DRAW/);
  });
});

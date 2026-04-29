import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCrionetOop, parseOopDayDate } from '../../parsers/crionet-oop.js';

// Realistic HTML matching production Crionet/matchscorerlive.com structure.
// Key characteristics:
//   - Each player has TWO spans: initial (e.g. "M.") + surname (e.g. "Sintes")
//   - Name div has class "ml-2" (optionally + "line-thin")
//   - STATS/widget button has data-id attribute
//   - OOP rows are typically scheduled or live (no winner markers needed)
const SCHEDULED_MATCH_HTML = `
<table class="w-100">
  <tr class="scorebox-header-scheduled">
    <th><span class="court-name">Starting at 10:00 AM</span></th>
    <th><div class="round-name"><small><b>Men </b><div>Q2</div></small></div></th>
  </tr>
  <tr class="draw-item-container">
    <td class="team">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div>
          <div class="player-names"><div class="double">
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ESP.jpg" /></div>
              <div class="ml-2 line-thin"><span>M.</span><span>Sintes</span></div>
            </div>
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ESP.jpg" /></div>
              <div class="ml-2 line-thin"><span>D.</span><span>Santigosa</span></div>
            </div>
          </div></div>
        </div>
        <div class="mr-2"></div>
      </div>
    </td>
    <td colspan="4">
      <a class="open" data-id="MQ012" data-year="2026" data-tid="1701" data-org="FIP">STATS</a>
    </td>
  </tr>
  <tr class="draw-item-container">
    <td class="team">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div>
          <div class="player-names"><div class="double">
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/FRA.jpg" /></div>
              <div class="ml-2 line-thin"><span>B.</span><span>Tison</span></div>
            </div>
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/FRA.jpg" /></div>
              <div class="ml-2 line-thin"><span>M.</span><span>Joris</span></div>
            </div>
          </div></div>
        </div>
        <div class="mr-2"></div>
      </div>
    </td>
    <td colspan="4"></td>
  </tr>
</table>
`;

describe('parseCrionetOop', () => {
  it('parses a scheduled match row with realistic HTML — full player names extracted', () => {
    const result = parseCrionetOop(SCHEDULED_MATCH_HTML, 1);
    expect(result).toHaveLength(1);
    const match = result[0];

    expect(match.dayNumber).toBe(1);
    expect(match.category).toBe('men');
    expect(match.roundLabel).toBe('Q2');
    expect(match.court).toBe('Starting at 10:00 AM');
    expect(match.scheduledLabel).toBe('Starting at 10:00 AM');
    expect(match.status).toBe('scheduled');
    expect(match.matchWidgetId).toBe('MQ012');

    // Full names: initial + space + surname
    expect(match.team1Player1Name).toBe('M. Sintes');
    expect(match.team1Player2Name).toBe('D. Santigosa');
    expect(match.team2Player1Name).toBe('B. Tison');
    expect(match.team2Player2Name).toBe('M. Joris');
  });

  it('parses a live match with scheduledLabel=null', () => {
    const html = `
<table class="w-100">
  <tr class="scorebox-header-live">
    <th><span class="court-name">Court 3</span></th>
    <th><div class="round-name"><small><b>Women </b><div>R1</div></small></div></th>
  </tr>
  <tr class="draw-item-container">
    <td class="team">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div>
          <div class="player-names"><div class="double">
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ESP.jpg" /></div>
              <div class="ml-2 line-thin"><span>G.</span><span>Triay</span></div>
            </div>
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ESP.jpg" /></div>
              <div class="ml-2 line-thin"><span>A.</span><span>Sanchez</span></div>
            </div>
          </div></div>
        </div>
        <div class="mr-2"></div>
      </div>
    </td>
    <td colspan="4"></td>
  </tr>
  <tr class="draw-item-container">
    <td class="team">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div>
          <div class="player-names"><div class="double">
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ARG.jpg" /></div>
              <div class="ml-2 line-thin"><span>B.</span><span>Gonzalez</span></div>
            </div>
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ARG.jpg" /></div>
              <div class="ml-2 line-thin"><span>M.</span><span>Osoro</span></div>
            </div>
          </div></div>
        </div>
        <div class="mr-2"></div>
      </div>
    </td>
    <td colspan="4"></td>
  </tr>
</table>
`;
    const result = parseCrionetOop(html, 2);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('live');
    expect(result[0].scheduledLabel).toBeNull();
    expect(result[0].category).toBe('women');
    expect(result[0].team1Player1Name).toBe('G. Triay');
    expect(result[0].team2Player2Name).toBe('M. Osoro');
    // Country codes captured from the flag image src — uppercased,
    // alpha-3, verbatim from the URL filename.
    expect(result[0].team1Player1Country).toBe('ESP');
    expect(result[0].team1Player2Country).toBe('ESP');
    expect(result[0].team2Player1Country).toBe('ARG');
    expect(result[0].team2Player2Country).toBe('ARG');
  });

  it('extracts country codes from FIP Beyond live widgets (mixed nationalities)', () => {
    // Real B3 Singapore-style markup — minified single-line player
    // blocks, mixed nationalities. The widget renders flag filenames
    // verbatim, so the parser sees uppercase IOC codes for the easy
    // ones (ESP) and FIP-specific ones (INA = Indonesia, HKG = Hong
    // Kong) alike. We store as-is; render-time translation is the
    // public app's job (countryFlag handles both alpha-3 and alpha-2).
    const html = `
<table class="w-100">
  <tr class="scorebox-header-completed">
    <th><span class="court-name">Court 1</span></th>
    <th><div class="round-name"><small><b>Men </b><div>QF</div></small></div></th>
  </tr>
  <tr class="scorebox-sep-bottom">
    <td class="team">
      <div class="player-names"><div class="double">
        <div class="d-flex align-items-center">
          <div><img class="flags" src="/images/flags/INA.jpg"/></div>
          <div class="ml-2 winner line-thin"><span>A.</span><span>Hendrawan</span></div>
        </div>
        <div class="d-flex align-items-center">
          <div><img class="flags" src="/images/flags/SIN.jpg"/></div>
          <div class="ml-2 winner line-thin"><span>K.</span><span>Lim</span></div>
        </div>
      </div></div>
    </td>
  </tr>
  <tr>
    <td class="team">
      <div class="player-names"><div class="double">
        <div class="d-flex align-items-center">
          <div><img class="flags" src="/images/flags/HKG.jpg"/></div>
          <div class="ml-2 line-thin"><span>A.</span><span>Wong</span></div>
        </div>
        <div class="d-flex align-items-center">
          <div><img class="flags" src="/images/flags/HKG.jpg"/></div>
          <div class="ml-2 line-thin"><span>T.</span><span>Chan</span></div>
        </div>
      </div></div>
    </td>
  </tr>
</table>`;
    const result = parseCrionetOop(html, 1);
    expect(result).toHaveLength(1);
    expect(result[0].team1Player1Country).toBe('INA');
    expect(result[0].team1Player2Country).toBe('SIN');
    expect(result[0].team2Player1Country).toBe('HKG');
    expect(result[0].team2Player2Country).toBe('HKG');
  });

  it('keeps country=null when the flag <img> has no src (legacy/trimmed markup)', () => {
    // The original Brussels fixture lazy-loads flag images via JS, so
    // the static HTML carries `<img class="flags"/>` with no src.
    // Names should still parse; countries should stay null without
    // dropping the row or polluting other fields.
    const html = `
<table class="w-100">
  <tr class="scorebox-header-scheduled">
    <th><span class="court-name">Starting at 10:00 AM</span></th>
    <th><div class="round-name"><small><b>Men </b><div>R32</div></small></div></th>
  </tr>
  <tr class="scorebox-sep-bottom"><td class="team">
    <div class="player-names"><div class="double">
      <div class="d-flex"><img class="flags"/><div class="ml-2"><span>T.</span><span>Zapata</span></div></div>
      <div class="d-flex"><img class="flags"/><div class="ml-2"><span>R.</span><span>Coello</span></div></div>
    </div></div>
  </td></tr>
  <tr><td class="team">
    <div class="player-names"><div class="double">
      <div class="d-flex"><img class="flags"/><div class="ml-2"><span>I.</span><span>Sager</span></div></div>
      <div class="d-flex"><img class="flags"/><div class="ml-2"><span>J.</span><span>Belluati</span></div></div>
    </div></div>
  </td></tr>
</table>`;
    const result = parseCrionetOop(html, 1);
    expect(result).toHaveLength(1);
    // Names still extracted as before
    expect(result[0].team1Player1Name).toBe('T. Zapata')
    expect(result[0].team2Player2Name).toBe('J. Belluati')
    // Countries are null because the <img> had no src
    expect(result[0].team1Player1Country).toBeNull();
    expect(result[0].team1Player2Country).toBeNull();
    expect(result[0].team2Player1Country).toBeNull();
    expect(result[0].team2Player2Country).toBeNull();
  });

  it('returns empty array for "No schedule available"', () => {
    expect(parseCrionetOop('<h4 class="message">No schedule available</h4>', 1)).toEqual([]);
  });

  // Regression: production markup uses `tr.scorebox-sep-bottom` for team 1
  // and a bare `<tr>` for team 2 — NOT `tr.draw-item-container`. Parser
  // returned 0 matches until the TEAM_ROW_SELECTOR was switched to
  // `tr:has(td.team)`. See Brussels P2 2026 OOP payload (day 3).
  it('parses production markup (scorebox-sep-bottom + bare tr) from matchscorerlive.com', () => {
    const html = `
<table class="w-100">
  <tr class="scorebox-header-completed">
    <th colspan="4"><span class="court-name">Starting at 11:00 AM</span></th>
    <th colspan="4"><div class="round-name text-right"><small><b>Men </b><div>Q3</div></small></div></th>
  </tr>
  <tr class="scorebox-sep-bottom">
    <td class="team" colspan="4">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div><div class="player-names"><div class="double">
          <div class="d-flex align-items-center">
            <div><img class="flags" src="/images/flags/ESP.jpg" /></div>
            <div class="ml-2  line-thin"><span>T.</span><span class="">Zapata</span></div>
          </div>
          <div class="d-flex align-items-center">
            <div><img class="flags" src="/images/flags/ESP.jpg" /></div>
            <div class="ml-2  line-thin"><span>R.</span><span class="">Coello Manso</span><small>(5)</small></div>
          </div>
        </div></div></div>
      </div>
    </td>
    <td></td>
    <td class="set set-completed">6</td>
    <td class="set set-completed set-lost">1</td>
    <td class="set set-completed set-lost">1</td>
  </tr>
  <tr>
    <td class="team" colspan="4">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div><div class="player-names"><div class="double">
          <div class="d-flex align-items-center">
            <div><img class="flags" src="/images/flags/ESP.jpg" /></div>
            <div class="ml-2 winner line-thin"><span>I.</span><span class="">Sager</span></div>
          </div>
          <div class="d-flex align-items-center">
            <div><img class="flags" src="/images/flags/ESP.jpg" /></div>
            <div class="ml-2 winner line-thin"><span>J.</span><span class="">Lopez</span></div>
          </div>
        </div></div></div>
      </div>
    </td>
    <td></td>
    <td class="set set-completed set-lost">1</td>
    <td class="set set-completed">6</td>
    <td class="set set-completed">6</td>
  </tr>
  <tr class="summary"><td colspan="8"></td></tr>
</table>
`;
    const result = parseCrionetOop(html, 3);
    expect(result).toHaveLength(1);
    expect(result[0].team1Player1Name).toBe('T. Zapata');
    expect(result[0].team1Player2Name).toBe('R. Coello Manso');
    expect(result[0].team2Player1Name).toBe('I. Sager');
    expect(result[0].team2Player2Name).toBe('J. Lopez');
    expect(result[0].status).toBe('finished');
    expect(result[0].category).toBe('men');
    expect(result[0].roundLabel).toBe('Q3');
  });
});

describe('parseCrionetOop — Brussels fixture (real court + position)', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const fixturePath = join(__dirname, '../fixtures/crionet-oop-brussels.html');
  const html = readFileSync(fixturePath, 'utf-8');

  it('emits the real court name from .schedule-header .oop-court, not the schedule label from the table header', () => {
    const matches = parseCrionetOop(html, 4);
    const byId = Object.fromEntries(matches.map((m) => [m.matchWidgetId, m]));
    expect(byId['MQ007']!.court).toBe('COURT CBC');
    expect(byId['WD030']!.court).toBe('COURT CBC');
    expect(byId['MD019']!.court).toBe('COURT NEXTENSA');
    expect(byId['WD025']!.court).toBe('COURT LOTTO');
  });

  it('splits the schedule label out of the court field (MQ007 = "Starting at 11:00 AM", WD030 = "Followed by")', () => {
    const matches = parseCrionetOop(html, 4);
    const byId = Object.fromEntries(matches.map((m) => [m.matchWidgetId, m]));
    expect(byId['MQ007']!.scheduledLabel).toBe('Starting at 11:00 AM');
    expect(byId['WD030']!.scheduledLabel).toBe('Followed by');
    expect(byId['MD019']!.scheduledLabel).toBe('Not before 6:00 PM');
  });

  it('assigns a 0-based courtPosition reflecting the match order within each court', () => {
    const matches = parseCrionetOop(html, 4);
    const cbc = matches
      .filter((m) => m.court === 'COURT CBC')
      .map((m) => ({ id: m.matchWidgetId, pos: m.courtPosition }));
    expect(cbc).toEqual([
      { id: 'MQ007', pos: 0 },
      { id: 'WD030', pos: 1 },
    ]);
    const byId = Object.fromEntries(matches.map((m) => [m.matchWidgetId, m]));
    expect(byId['MD019']!.courtPosition).toBe(0);
    expect(byId['WD025']!.courtPosition).toBe(0);
  });

  it('assigns courtDisplayOrder matching the left-to-right column order of courts', () => {
    // All matches on the same court share the same courtDisplayOrder, and
    // courts are indexed 0, 1, 2, … in the order they appear as DOM columns
    // on the OOP page. For Brussels: CBC=0, Nextensa=1, Lotto=2.
    const matches = parseCrionetOop(html, 4);
    const byCourt = new Map<string, number>();
    for (const m of matches) {
      if (!byCourt.has(m.court)) byCourt.set(m.court, m.courtDisplayOrder);
      // Every match on the court must carry the same order as the first.
      expect(m.courtDisplayOrder).toBe(byCourt.get(m.court));
    }
    // Spot-check the actual left-to-right sequence from the Brussels fixture.
    expect(byCourt.get('COURT CBC')).toBe(0);
    expect(byCourt.get('COURT NEXTENSA')).toBe(1);
    expect(byCourt.get('COURT LOTTO')).toBe(2);
    // Indices are contiguous starting at 0 — no gaps even if a column was
    // rendered without a courtName (nextCourtDisplayOrder increments only
    // when we accept a court).
    const orders = [...byCourt.values()].sort((a, b) => a - b);
    expect(orders).toEqual([0, 1, 2]);
  });
});

describe('parseOopDayDate', () => {
  // Day-selector strip mirroring the live FIP-2026-1812 (Calzada) HTML.
  // The active class on the second pill marks "this is the day we
  // requested" — that's the one whose date we capture.
  const dayPicker = (activeIdx: number) => {
    const days = [
      { date: 'APR 29', week: 'WED' },
      { date: 'APR 30', week: 'THU' },
      { date: 'MAY 1', week: 'FRI' },
      { date: 'MAY 2', week: 'SAT' },
      { date: 'MAY 3', week: 'SUN' },
    ];
    return `<div class="day-selector"><div class="d-flex w-100">${days
      .map((d, i) => {
        const cls = i === activeIdx ? 'play-day-button active mb-3' : 'play-day-button mb-3';
        return `<a class="text-decoration-none" href="/screen/oopbyday/X/${i + 1}?t=tol"><div class="${cls}"><span class="play-day-date">${d.date}</span><div class="play-day-week">${d.week}</div></div></a>`;
      })
      .join('')}</div></div>`;
  };

  it('returns the active day-pill date with year inferred from `now`', () => {
    const html = dayPicker(0); // active = APR 29
    const now = new Date('2026-04-29T08:00:00Z');
    expect(parseOopDayDate(html, now)).toBe('2026-04-29');
  });

  it('handles a different active day in the same picker', () => {
    const html = dayPicker(1); // active = APR 30
    const now = new Date('2026-04-29T08:00:00Z');
    expect(parseOopDayDate(html, now)).toBe('2026-04-30');
  });

  it('snaps to the closest year across boundaries (December tournament fetched in early January)', () => {
    // December tournament: pill says "DEC 30", but the scrape fires on
    // Jan 2 of the next year. Year-snap picks now-1 because Dec 30 of
    // last year is closer to Jan 2 than Dec 30 of this year would be.
    const html = `<div class="play-day-button active"><span class="play-day-date">DEC 30</span></div>`;
    const now = new Date('2027-01-02T08:00:00Z');
    expect(parseOopDayDate(html, now)).toBe('2026-12-30');
  });

  it('snaps to next year when a January pill is fetched in late December', () => {
    // Inverse case: pill says JAN 3, scrape fires on Dec 28 — closest
    // year is now+1 (Jan 3 of next year is 6 days away vs Jan 3 of
    // current year being ~360 days back).
    const html = `<div class="play-day-button active"><span class="play-day-date">JAN 3</span></div>`;
    const now = new Date('2025-12-28T08:00:00Z');
    expect(parseOopDayDate(html, now)).toBe('2026-01-03');
  });

  it('returns null when no day pill carries the active class (mid-render edge case)', () => {
    const html = dayPicker(-1); // no active pill
    expect(parseOopDayDate(html, new Date('2026-04-29Z'))).toBeNull();
  });

  it('returns null when the day-selector is missing entirely (legacy / minimal fixture)', () => {
    expect(parseOopDayDate('<html><body>nothing here</body></html>', new Date('2026-04-29Z'))).toBeNull();
  });

  it('returns null when the active pill text is malformed', () => {
    const html = `<div class="play-day-button active"><span class="play-day-date">??</span></div>`;
    expect(parseOopDayDate(html, new Date('2026-04-29Z'))).toBeNull();
  });

  it('handles single-digit days ("MAY 1") as well as two-digit ("APR 29")', () => {
    const single = `<div class="play-day-button active"><span class="play-day-date">MAY 1</span></div>`;
    const double = `<div class="play-day-button active"><span class="play-day-date">APR 29</span></div>`;
    const now = new Date('2026-04-29T08:00:00Z');
    expect(parseOopDayDate(single, now)).toBe('2026-05-01');
    expect(parseOopDayDate(double, now)).toBe('2026-04-29');
  });

  it('rejects invalid day-of-month values (e.g. day 32)', () => {
    const html = `<div class="play-day-button active"><span class="play-day-date">JAN 32</span></div>`;
    expect(parseOopDayDate(html, new Date('2026-01-15Z'))).toBeNull();
  });
});

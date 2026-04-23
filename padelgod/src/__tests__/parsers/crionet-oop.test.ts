import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCrionetOop } from '../../parsers/crionet-oop.js';

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

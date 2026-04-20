import { describe, it, expect } from 'vitest';
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
});

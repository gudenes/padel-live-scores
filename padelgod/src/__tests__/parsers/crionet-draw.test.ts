import { describe, it, expect } from 'vitest';
import { parseCrionetDraw } from '../../parsers/crionet-draw.js';

// Realistic HTML matching production Crionet/matchscorerlive.com structure.
// Key characteristics:
//   - Each player has TWO spans: initial (e.g. "I.") + surname (e.g. "Sager")
//   - Winner class is on the name div (div.ml-2.winner.line-thin), not on a span
//   - fa-check icon appears in the mr-2 div of the winning team row
//   - Set scores in <td class="set ..."> cells; dash "-" for unplayed sets
const COMPLETED_MATCH_HTML = `
<table class="w-100">
  <tr class="scorebox-header-completed">
    <th colspan="1"><span class="court-name"><span>CLUB, BMW</span></span></th>
    <th colspan="4" class="round-name text-right"><small class="">Round of 32</small></th>
  </tr>
  <tr class="draw-item-container">
    <td class="team">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div>
          <div class="player-names"><div class="double">
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ESP.jpg" /></div>
              <div class="ml-2  line-thin"><span>I.</span><span class="">Sager</span></div>
            </div>
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ESP.jpg" /></div>
              <div class="ml-2  line-thin"><span>M.</span><span class="">Ortega</span><small class="separator">(1)</small></div>
            </div>
          </div></div>
        </div>
        <div class="mr-2"></div>
      </div>
    </td>
    <td></td>
    <td class="set set-completed set-lost">3</td>
    <td class="set set-completed set-lost">4</td>
    <td class="set set-lost ">-</td>
  </tr>
  <tr class="draw-item-container">
    <td class="team">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div>
          <div class="player-names"><div class="double">
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ARG.jpg" /></div>
              <div class="ml-2 winner line-thin"><span>F.</span><span class="">Gonzalez</span></div>
            </div>
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ARG.jpg" /></div>
              <div class="ml-2 winner line-thin"><span>P.</span><span class="">Martinez</span></div>
            </div>
          </div></div>
        </div>
        <div class="mr-2"><i class='fa-solid fa-check check-primary'></i></div>
      </div>
    </td>
    <td></td>
    <td class="set set-completed ">6</td>
    <td class="set set-completed ">6</td>
    <td class="set set-lost ">-</td>
  </tr>
</table>
`;

describe('parseCrionetDraw', () => {
  it('parses a completed match with realistic HTML — full player names extracted', () => {
    const result = parseCrionetDraw(COMPLETED_MATCH_HTML, 'men', 'main_draw');
    expect(result).toHaveLength(1);
    const match = result[0];

    expect(match.category).toBe('men');
    expect(match.drawType).toBe('main_draw');
    expect(match.status).toBe('finished');
    expect(match.roundLabel).toBe('Round of 32');

    // Full names: initial + space + surname (not just the initial)
    expect(match.team1Player1Name).toBe('I. Sager');
    expect(match.team1Player2Name).toBe('M. Ortega');
    expect(match.team2Player1Name).toBe('F. Gonzalez');
    expect(match.team2Player2Name).toBe('P. Martinez');
  });

  it('detects winnerTeam=2 when team2 has winner class + fa-check', () => {
    const result = parseCrionetDraw(COMPLETED_MATCH_HTML, 'men', 'main_draw');
    expect(result[0].winnerTeam).toBe(2);
  });

  it('extracts country codes from flag images', () => {
    const result = parseCrionetDraw(COMPLETED_MATCH_HTML, 'men', 'main_draw');
    expect(result[0].team1Country).toBe('ESP');
    expect(result[0].team2Country).toBe('ARG');
  });

  it('parses set scores correctly — unplayed sets (dash) are excluded', () => {
    const result = parseCrionetDraw(COMPLETED_MATCH_HTML, 'men', 'main_draw');
    // Sets: team1 scored 3,4 and team2 scored 6,6; third set is "-" so excluded
    expect(result[0].setScores).toBe('3-6 4-6');
  });

  it('parses a scheduled match — no winner, no sets', () => {
    const html = `
<table class="w-100">
  <tr class="scorebox-header-scheduled">
    <th colspan="1"><span class="court-name"><span>Court 1</span></span></th>
    <th colspan="4" class="round-name text-right"><small class="">Round of 16</small></th>
  </tr>
  <tr class="draw-item-container">
    <td class="team">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div>
          <div class="player-names"><div class="double">
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ESP.jpg" /></div>
              <div class="ml-2 line-thin"><span>J.</span><span>Lebron</span></div>
            </div>
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ESP.jpg" /></div>
              <div class="ml-2 line-thin"><span>A.</span><span>Galan</span></div>
            </div>
          </div></div>
        </div>
        <div class="mr-2"></div>
      </div>
    </td>
    <td></td>
    <td class="set set-lost ">-</td>
    <td class="set set-lost ">-</td>
    <td class="set set-lost ">-</td>
  </tr>
  <tr class="draw-item-container">
    <td class="team">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div>
          <div class="player-names"><div class="double">
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ARG.jpg" /></div>
              <div class="ml-2 line-thin"><span>F.</span><span>Chingotto</span></div>
            </div>
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ARG.jpg" /></div>
              <div class="ml-2 line-thin"><span>J.</span><span>Tello</span></div>
            </div>
          </div></div>
        </div>
        <div class="mr-2"></div>
      </div>
    </td>
    <td></td>
    <td class="set set-lost ">-</td>
    <td class="set set-lost ">-</td>
    <td class="set set-lost ">-</td>
  </tr>
</table>
`;
    const result = parseCrionetDraw(html, 'men', 'main_draw');
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('scheduled');
    expect(result[0].winnerTeam).toBeNull();
    expect(result[0].setScores).toBeNull();
    expect(result[0].team1Player1Name).toBe('J. Lebron');
    expect(result[0].team2Player2Name).toBe('J. Tello');
  });

  it('returns empty array for "Draw not available" HTML', () => {
    const html = '<div class="message">Draw not available</div>';
    expect(parseCrionetDraw(html, 'women', 'qualifying')).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { parseCrionetResults } from '../../parsers/crionet-results.js';

// Realistic HTML matching production Crionet/matchscorerlive.com structure.
// Key characteristics:
//   - Each player has TWO spans: initial (e.g. "F.") + surname (e.g. "Chingotto")
//   - Winner class is on the name div (div.ml-2.winner.line-thin), not on a span
//   - fa-check icon appears in the mr-2 div of the winning team row
//   - Set scores always present in results (match is completed)
//   - STATS button has data-id attribute for the match widget ID
const COMPLETED_MATCH_HTML = `
<table class="w-100">
  <tr class="scorebox-header-completed">
    <th><span class="court-name">Centre Court</span></th>
    <th><div class="round-name"><small><b>Men </b><div>Final</div></small></div></th>
  </tr>
  <tr class="draw-item-container">
    <td class="team">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div>
          <div class="player-names"><div class="double">
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ESP.jpg" /></div>
              <div class="ml-2  line-thin"><span>L.</span><span class="">Galan</span></div>
            </div>
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ARG.jpg" /></div>
              <div class="ml-2  line-thin"><span>F.</span><span class="">Chingotto</span></div>
            </div>
          </div></div>
        </div>
        <div class="mr-2"></div>
      </div>
    </td>
    <td class="set set-completed set-lost">7</td>
    <td class="set set-completed set-lost">3</td>
    <td class="set set-completed set-lost">7</td>
    <td colspan="1">
      <a class="open" data-id="MD001" data-year="2026" data-tid="1701" data-org="FIP">STATS</a>
    </td>
  </tr>
  <tr class="draw-item-container">
    <td class="team">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div>
          <div class="player-names"><div class="double">
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ESP.jpg" /></div>
              <div class="ml-2 winner line-thin"><span>J.</span><span class="">Lebron</span></div>
            </div>
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ARG.jpg" /></div>
              <div class="ml-2 winner line-thin"><span>A.</span><span class="">Tapia</span></div>
            </div>
          </div></div>
        </div>
        <div class="mr-2"><i class='fa-solid fa-check check-primary'></i></div>
      </div>
    </td>
    <td class="set set-completed ">5</td>
    <td class="set set-completed ">6</td>
    <td class="set set-completed ">5</td>
  </tr>
</table>
`;

describe('parseCrionetResults', () => {
  it('parses a finished match row with realistic HTML — full player names extracted', () => {
    const result = parseCrionetResults(COMPLETED_MATCH_HTML, 5);
    expect(result).toHaveLength(1);
    const match = result[0];

    expect(match.dayNumber).toBe(5);
    expect(match.category).toBe('men');
    expect(match.roundLabel).toBe('Final');
    expect(match.court).toBe('Centre Court');
    expect(match.status).toBe('finished');

    // Full names: initial + space + surname
    expect(match.team1Player1Name).toBe('L. Galan');
    expect(match.team1Player2Name).toBe('F. Chingotto');
    expect(match.team2Player1Name).toBe('J. Lebron');
    expect(match.team2Player2Name).toBe('A. Tapia');
  });

  it('detects winnerTeam=2 when team2 has winner class + fa-check', () => {
    const result = parseCrionetResults(COMPLETED_MATCH_HTML, 5);
    expect(result[0].winnerTeam).toBe(2);
  });

  it('parses set scores correctly', () => {
    const result = parseCrionetResults(COMPLETED_MATCH_HTML, 5);
    expect(result[0].setScores).toBe('7-5 3-6 7-5');
  });

  it('extracts matchWidgetId from STATS button data-id', () => {
    const result = parseCrionetResults(COMPLETED_MATCH_HTML, 5);
    expect(result[0].matchWidgetId).toBe('MD001');
  });

  it('detects winnerTeam=1 when team1 has winner class', () => {
    const html = `
<table class="w-100">
  <tr class="scorebox-header-completed">
    <th><span class="court-name">Court 2</span></th>
    <th><div class="round-name"><small><b>Women </b><div>SF</div></small></div></th>
  </tr>
  <tr class="draw-item-container">
    <td class="team">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div>
          <div class="player-names"><div class="double">
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ESP.jpg" /></div>
              <div class="ml-2 winner line-thin"><span>G.</span><span>Triay</span></div>
            </div>
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ESP.jpg" /></div>
              <div class="ml-2 winner line-thin"><span>A.</span><span>Sanchez</span></div>
            </div>
          </div></div>
        </div>
        <div class="mr-2"><i class='fa-solid fa-check check-primary'></i></div>
      </div>
    </td>
    <td class="set set-completed ">6</td>
    <td class="set set-completed ">6</td>
    <td class="set set-lost ">-</td>
  </tr>
  <tr class="draw-item-container">
    <td class="team">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div>
          <div class="player-names"><div class="double">
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ARG.jpg" /></div>
              <div class="ml-2  line-thin"><span>B.</span><span>Gonzalez</span></div>
            </div>
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ARG.jpg" /></div>
              <div class="ml-2  line-thin"><span>M.</span><span>Osoro</span></div>
            </div>
          </div></div>
        </div>
        <div class="mr-2"></div>
      </div>
    </td>
    <td class="set set-completed set-lost">3</td>
    <td class="set set-completed set-lost">4</td>
    <td class="set set-lost ">-</td>
  </tr>
</table>
`;
    const result = parseCrionetResults(html, 3);
    expect(result).toHaveLength(1);
    expect(result[0].winnerTeam).toBe(1);
    expect(result[0].category).toBe('women');
    expect(result[0].setScores).toBe('6-3 6-4');
  });

  it('returns empty array for "No results found"', () => {
    expect(parseCrionetResults('<h4 class="message">No results found</h4>', 1)).toEqual([]);
  });

  it('parses tiebreak set scores — <sup>N</sup> in loser cell appends (N) to set string', () => {
    // Real Crionet format confirmed from live HTML:
    // <td class="set set-completed set-lost">6<sup>1</sup></td>
    // The loser's cell contains game count + <sup>tb_points</sup>
    const html = `
<table class="w-100">
  <tr class="scorebox-header-completed">
    <th><span class="court-name">Court B</span></th>
    <th><div class="round-name"><small><b>Men </b><div>Semifinal</div></small></div></th>
  </tr>
  <tr class="draw-item-container">
    <td class="team">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div>
          <div class="player-names"><div class="double">
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ESP.jpg" /></div>
              <div class="ml-2 winner line-thin"><span>A.</span><span>Garcia</span></div>
            </div>
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ESP.jpg" /></div>
              <div class="ml-2 winner line-thin"><span>B.</span><span>Ruiz</span></div>
            </div>
          </div></div>
        </div>
        <div class="mr-2"><i class='fa-solid fa-check check-primary'></i></div>
      </div>
    </td>
    <td class="set set-completed ">7</td>
    <td class="set set-completed set-lost">4</td>
    <td class="set set-completed ">6</td>
  </tr>
  <tr class="draw-item-container">
    <td class="team">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div>
          <div class="player-names"><div class="double">
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/BEL.jpg" /></div>
              <div class="ml-2  line-thin"><span>C.</span><span>Dupont</span></div>
            </div>
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/BEL.jpg" /></div>
              <div class="ml-2  line-thin"><span>D.</span><span>Renard</span></div>
            </div>
          </div></div>
        </div>
        <div class="mr-2"></div>
      </div>
    </td>
    <td class="set set-completed set-lost">6<sup>3</sup></td>
    <td class="set set-completed ">6</td>
    <td class="set set-completed set-lost">7<sup>5</sup></td>
  </tr>
</table>
`;
    const result = parseCrionetResults(html, 2);
    expect(result).toHaveLength(1);
    // Set 1: team1=7, team2=6<sup>3</sup> → team1 wins TB → "7-6(3)"
    // Set 2: team1=4(lost), team2=6 → no tiebreak → "4-6"
    // Set 3: team1=6, team2=7<sup>5</sup> → team2 wins TB → "6-7(5)"
    expect(result[0].setScores).toBe('7-6(3) 4-6 6-7(5)');
    expect(result[0].winnerTeam).toBe(1);
  });

  it('does not append tiebreak suffix to regular sets (no <sup>)', () => {
    const result = parseCrionetResults(COMPLETED_MATCH_HTML, 5);
    // Original fixture: 7-5 3-6 7-5 — no tiebreaks
    expect(result[0].setScores).toBe('7-5 3-6 7-5');
    expect(result[0].setScores).not.toContain('(');
  });
});

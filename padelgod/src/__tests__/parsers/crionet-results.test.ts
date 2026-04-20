import { describe, it, expect } from 'vitest';
import { parseCrionetResults } from '../../parsers/crionet-results.js';

describe('parseCrionetResults', () => {
  it('parses a finished match row with set scores', () => {
    const html = `
      <table class="w-100">
        <tr class="scorebox-header-completed">
          <th><span class="court-name">Centre Court</span></th>
          <th><div class="round-name"><small><b>Men </b><div>Final</div></small></div></th>
        </tr>
        <tr class="draw-item-container">
          <td class="team">
            <div><img class="flags" src="/images/flags/ESP.jpg"/><span>L. Galan</span></div>
            <div><img class="flags" src="/images/flags/ARG.jpg"/><span>F. Chingotto</span></div>
          </td>
          <td class="set">7</td><td class="set">3</td><td class="set">7</td>
          <td colspan="1">
            <a class="open" data-id="MD001" data-year="2026" data-tid="1701" data-org="FIP">STATS</a>
          </td>
        </tr>
        <tr class="draw-item-container">
          <td class="team">
            <div><img class="flags" src="/images/flags/ESP.jpg"/><span class="winner">J. Lebron</span></div>
            <div><img class="flags" src="/images/flags/ARG.jpg"/><span class="winner">A. Tapia</span></div>
          </td>
          <td class="set">5</td><td class="set">6</td><td class="set">5</td>
        </tr>
      </table>
    `;
    const result = parseCrionetResults(html, 5);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      dayNumber: 5,
      category: 'men',
      roundLabel: 'Final',
      court: 'Centre Court',
      matchWidgetId: 'MD001',
      team1Player1Name: 'L. Galan',
      team2Player1Name: 'J. Lebron',
      setScores: '7-5 3-6 7-5',
      winnerTeam: 2,
      status: 'finished',
    });
  });

  it('returns empty array for "No results found"', () => {
    expect(parseCrionetResults('<h4 class="message">No results found</h4>', 1)).toEqual([]);
  });
});

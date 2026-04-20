import { describe, it, expect } from 'vitest';
import { parseCrionetDraw } from '../../parsers/crionet-draw.js';

describe('parseCrionetDraw', () => {
  it('parses a completed match from draw HTML', () => {
    const html = `
      <table class="w-100">
        <tr class="scorebox-header-completed">
          <th class="text-left"><span class="court-name">CENTRE COURT</span></th>
          <th colspan="4" class="round-name text-right"><small>Round of 16</small></th>
        </tr>
        <tr class="draw-item-container">
          <td class="team">
            <div><img class="flags" src="/images/flags/ESP.jpg"/><span>L. Galan</span></div>
            <div><img class="flags" src="/images/flags/ARG.jpg"/><span>F. Chingotto</span></div>
          </td>
          <td class="set">6</td><td class="set">3</td><td class="set">7</td>
        </tr>
        <tr class="draw-item-container">
          <td class="team">
            <div><img class="flags" src="/images/flags/ESP.jpg"/><span class="winner">J. Lebron</span></div>
            <div><img class="flags" src="/images/flags/ARG.jpg"/><span class="winner">A. Tapia</span></div>
          </td>
          <td class="set">7</td><td class="set">6</td><td class="set">6</td>
        </tr>
      </table>
    `;
    const result = parseCrionetDraw(html, 'men', 'main_draw');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      category: 'men',
      drawType: 'main_draw',
      roundLabel: 'Round of 16',
      team1Player1Name: 'L. Galan',
      team1Player2Name: 'F. Chingotto',
      team2Player1Name: 'J. Lebron',
      team2Player2Name: 'A. Tapia',
      winnerTeam: 2,
      setScores: '6-7 3-6 7-6',
      status: 'finished',
    });
  });

  it('returns empty array for "Draw not available" HTML', () => {
    const html = '<div class="message">Draw not available</div>';
    expect(parseCrionetDraw(html, 'women', 'qualifying')).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { parseFipRankings } from '../../parsers/fip-rankings.js';

describe('parseFipRankings', () => {
  it('extracts rows from a rankings table', () => {
    const html = `
      <table class="ranking-table">
        <tbody>
          <tr>
            <td class="rank">1</td>
            <td class="player-country"><img src="/flags/ESP.jpg" alt="ESP" /></td>
            <td class="player-name">Arturo Coello</td>
            <td class="points">14820</td>
          </tr>
          <tr>
            <td class="rank">2</td>
            <td class="player-country"><img src="/flags/ARG.jpg" alt="ARG" /></td>
            <td class="player-name">Agustín Tapia</td>
            <td class="points">14750</td>
          </tr>
        </tbody>
      </table>
    `;
    const result = parseFipRankings(html, 'men');
    expect(result).toEqual([
      { rank: 1, name: 'Arturo Coello', country: 'ESP', points: 14820, gender: 'men' },
      { rank: 2, name: 'Agustín Tapia', country: 'ARG', points: 14750, gender: 'men' },
    ]);
  });

  it('returns empty array on empty/malformed input', () => {
    expect(parseFipRankings('', 'men')).toEqual([]);
    expect(parseFipRankings('<html></html>', 'women')).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { parseCrionetOop } from '../../parsers/crionet-oop.js';

describe('parseCrionetOop', () => {
  it('parses a scheduled match row', () => {
    const html = `
      <table class="w-100">
        <tr class="scorebox-header-scheduled">
          <th><span class="court-name">Starting at 10:00 AM</span></th>
          <th><div class="round-name"><small><b>Men </b><div>Q2</div></small></div></th>
        </tr>
        <tr class="draw-item-container">
          <td class="team">
            <div><img class="flags" src="/images/flags/ESP.jpg"/><span>M. Sintes</span></div>
            <div><img class="flags" src="/images/flags/ESP.jpg"/><span>D. Santigosa</span></div>
          </td>
          <td colspan="4">
            <a class="open" data-id="MQ012" data-year="2026" data-tid="1701" data-org="FIP">STATS</a>
          </td>
        </tr>
        <tr class="draw-item-container">
          <td class="team">
            <div><img class="flags" src="/images/flags/FRA.jpg"/><span>B. Tison</span></div>
            <div><img class="flags" src="/images/flags/FRA.jpg"/><span>M. Joris</span></div>
          </td>
          <td colspan="4"></td>
        </tr>
      </table>
    `;
    const result = parseCrionetOop(html, 1);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      dayNumber: 1,
      category: 'men',
      roundLabel: 'Q2',
      court: 'Starting at 10:00 AM',
      scheduledLabel: 'Starting at 10:00 AM',
      team1Player1Name: 'M. Sintes',
      team1Player2Name: 'D. Santigosa',
      team2Player1Name: 'B. Tison',
      team2Player2Name: 'M. Joris',
      matchWidgetId: 'MQ012',
      status: 'scheduled',
    });
  });

  it('returns empty array for "No schedule available"', () => {
    expect(parseCrionetOop('<h4 class="message">No schedule available</h4>', 1)).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { parseCrionetEntryList } from '../../parsers/crionet-entry-list.js';

describe('parseCrionetEntryList', () => {
  it('extracts pair entries with seed + country', () => {
    const html = `
      <div class="entry-list">
        <div class="entry-list-row" data-fip-id="P200038" data-partner-fip-id="P200042">
          <div class="player-name">LEBRON, Juan</div>
          <div class="player-country"><img src="/flags/ESP.jpg" alt="ESP"/></div>
          <div class="seed">(1)</div>
          <div class="partner-name">CHINGOTTO, Federico</div>
        </div>
        <div class="entry-list-row" data-fip-id="P200052">
          <div class="player-name">COELLO, Arturo</div>
          <div class="player-country"><img src="/flags/ESP.jpg" alt="ESP"/></div>
          <div class="seed">(2)</div>
          <div class="partner-name">TAPIA, Agustin</div>
        </div>
      </div>
    `;
    const result = parseCrionetEntryList(html, 'men');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      fipId: 'P200038',
      name: 'Juan Lebron',
      country: 'ESP',
      seed: 1,
      partnerFipId: 'P200042',
      partnerName: 'Federico Chingotto',
      category: 'men',
    });
    expect(result[1]?.partnerFipId).toBeNull();  // not provided in second row
  });

  it('returns empty array when no rows', () => {
    expect(parseCrionetEntryList('<div></div>', 'women')).toEqual([]);
  });

  it('strips noise tokens from "LASTNAME, Firstname" format', () => {
    const html = `
      <div class="entry-list-row" data-fip-id="P1">
        <div class="player-name">DI NENNO, Martin</div>
        <div class="player-country"><img src="/flags/ARG.jpg" alt="ARG"/></div>
      </div>`;
    const result = parseCrionetEntryList(html, 'men');
    expect(result[0]?.name).toBe('Martin Di Nenno');
  });
});

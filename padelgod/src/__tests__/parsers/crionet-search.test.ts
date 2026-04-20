import { describe, it, expect } from 'vitest';
import { parseCrionetSearchResults } from '../../parsers/crionet-search.js';

describe('parseCrionetSearchResults', () => {
  it('extracts a single live tournament card', () => {
    const html = `
      <div class="d-flex flex-wrap">
        <div class="m-1">
          <div class="card tournament-card">
            <div class="card-header tournament-card-header tournament-card-header-live">
              <div>
                <div class="tournament-name">BRUSSELS P2</div>
                <div class="tournament-title">BRUSSELS P2</div>
              </div>
              <div><span class="tournament-code">1701</span></div>
            </div>
          </div>
        </div>
      </div>
    `;
    const result = parseCrionetSearchResults(html, 2026);
    expect(result).toEqual([
      { code: 'FIP-2026-1701', name: 'BRUSSELS P2', isLive: true },
    ]);
  });

  it('marks non-live tournaments correctly', () => {
    const html = `
      <div class="card tournament-card">
        <div class="card-header tournament-card-header">
          <div class="tournament-name">FIP GOLD X</div>
          <span class="tournament-code">1234</span>
        </div>
      </div>
    `;
    const result = parseCrionetSearchResults(html, 2025);
    expect(result[0]).toEqual({ code: 'FIP-2025-1234', name: 'FIP GOLD X', isLive: false });
  });

  it('returns empty array for "No tournaments found" HTML', () => {
    const html = '<div class="text-center text-light">No tournaments found</div>';
    expect(parseCrionetSearchResults(html, 2026)).toEqual([]);
  });
});

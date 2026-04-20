import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseCrionetMatchStats } from '../../parsers/crionet-match-stats.js';

const FIXTURE_PATH = join(
  __dirname,
  '../fixtures/crionet-match-stats-brussels.html',
);

// Small inline HTML for unit-level cases. Matches Crionet's 3-column flex row shape.
function row(left: string, label: string, right: string): string {
  return `
    <div class="d-flex w-100 justify-content-between">
      <div class="stats-l1-values"><span class="bold">${left}</span></div>
      <div class="stats-data-points">${label}</div>
      <div class="stats-l1-values text-right"><span class="bold">${right}</span></div>
    </div>
  `;
}

describe('parseCrionetMatchStats', () => {
  it('parses the match aggregate tab (period-0) against the real Brussels P2 fixture', () => {
    const html = readFileSync(FIXTURE_PATH, 'utf-8');
    const parsed = parseCrionetMatchStats(html);

    // Fixture has period-0, period-1, period-2 tabs
    expect(parsed.perSet).toHaveLength(3);
    const agg = parsed.perSet.find((p) => p.setNumber === 0);
    expect(agg).toBeDefined();

    // Spot-check values against the raw HTML (pair lost 1-6 0-6):
    // Total points won 29% / 71%
    expect(agg!.team1.totalPointsWonPct).toBe(29);
    expect(agg!.team2.totalPointsWonPct).toBe(71);
    // Break points converted 50% / 64%
    expect(agg!.team1.breakPointsConvertedPct).toBe(50);
    expect(agg!.team2.breakPointsConvertedPct).toBe(64);
    // Longest streak 3 / 13
    expect(agg!.team1.longestStreak).toBe(3);
    expect(agg!.team2.longestStreak).toBe(13);
    // Aces 0 / 0, Double faults 0 / 0
    expect(agg!.team1.aces).toBe(0);
    expect(agg!.team2.aces).toBe(0);
    expect(agg!.team1.doubleFaults).toBe(0);
    expect(agg!.team2.doubleFaults).toBe(0);
    // Won on 1st serve 23% / 72%
    expect(agg!.team1.wonOn1stServePct).toBe(23);
    expect(agg!.team2.wonOn1stServePct).toBe(72);
    // Service games 7 / 6
    expect(agg!.team1.serviceGames).toBe(7);
    expect(agg!.team2.serviceGames).toBe(6);
  });

  it('parses per-set tabs with their own numbered setNumber', () => {
    const html = readFileSync(FIXTURE_PATH, 'utf-8');
    const parsed = parseCrionetMatchStats(html);
    const set1 = parsed.perSet.find((p) => p.setNumber === 1);
    const set2 = parsed.perSet.find((p) => p.setNumber === 2);
    expect(set1).toBeDefined();
    expect(set2).toBeDefined();
    // Set-level totals should not equal the aggregate (sanity check we're not reading the wrong tab)
    const agg = parsed.perSet.find((p) => p.setNumber === 0);
    expect(set1!.team1.serviceGames).not.toBe(agg!.team1.serviceGames);
  });

  it('returns null for missing / non-numeric fields', () => {
    const html = `
      <div class="tab-pane active" id="period-0">
        ${row('29%', 'Total points won', '71%')}
        ${row('', 'Aces', '')}
        ${row('-', 'Double faults', '-')}
      </div>
    `;
    const parsed = parseCrionetMatchStats(html);
    expect(parsed.perSet).toHaveLength(1);
    const r = parsed.perSet[0];
    expect(r.team1.totalPointsWonPct).toBe(29);
    expect(r.team1.aces).toBeNull();
    expect(r.team1.doubleFaults).toBeNull();
    // Fields never mentioned in this fragment stay null (sparse fixture, default shape)
    expect(r.team1.serviceGames).toBeNull();
    expect(r.team2.longestStreak).toBeNull();
  });
});

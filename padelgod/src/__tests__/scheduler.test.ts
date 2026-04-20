import { describe, it, expect } from 'vitest';
import { buildSchedule } from '../scheduler.js';

const ALL_ENABLED = {
  enableTournamentDiscovery: true,
  enableWidgetCodeLookup: true,
  enablePlayerRankings: true,
  enablePlayerProfile: true,
  enableEntryListFetcher: true,
  enableDrawFetcher: true,
  enableOopFetcher: true,
  enableResultsFetcher: true,
};

describe('buildSchedule', () => {
  it('includes all 8 V1 workers when fully enabled', () => {
    const sched = buildSchedule(ALL_ENABLED);
    const names = sched.map((s) => s.name);
    expect(names).toContain('tournament-discovery');
    expect(names).toContain('widget-code-lookup');
    expect(names).toContain('player-rankings');
    expect(names).toContain('player-profile');
    expect(names).toContain('entry-list-fetcher');
    expect(names).toContain('draw-fetcher');
    expect(names).toContain('oop-fetcher');
    expect(names).toContain('results-fetcher');
  });

  it('respects enable flags for static workers', () => {
    const sched = buildSchedule({
      ...ALL_ENABLED,
      enableEntryListFetcher: false,
      enableDrawFetcher: false,
      enableOopFetcher: false,
      enableResultsFetcher: false,
    });
    const names = sched.map((s) => s.name);
    expect(names).not.toContain('entry-list-fetcher');
    expect(names).not.toContain('draw-fetcher');
    expect(names).not.toContain('oop-fetcher');
    expect(names).not.toContain('results-fetcher');
  });
});

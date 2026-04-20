import { describe, it, expect } from 'vitest';
import { buildSchedule } from '../scheduler.js';

describe('buildSchedule', () => {
  it('includes all 4 V1 workers with sensible cron expressions', () => {
    const sched = buildSchedule({
      enableTournamentDiscovery: true,
      enableWidgetCodeLookup: true,
      enablePlayerRankings: true,
      enablePlayerProfile: true,
    });
    const names = sched.map((s) => s.name);
    expect(names).toContain('tournament-discovery');
    expect(names).toContain('widget-code-lookup');
    expect(names).toContain('player-rankings');
    expect(names).toContain('player-profile');
  });

  it('respects enable flags', () => {
    const sched = buildSchedule({
      enableTournamentDiscovery: false,
      enableWidgetCodeLookup: true,
      enablePlayerRankings: false,
      enablePlayerProfile: true,
    });
    const names = sched.map((s) => s.name);
    expect(names).not.toContain('tournament-discovery');
    expect(names).toContain('widget-code-lookup');
    expect(names).not.toContain('player-rankings');
    expect(names).toContain('player-profile');
  });
});

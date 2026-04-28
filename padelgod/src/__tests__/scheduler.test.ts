import { describe, it, expect } from 'vitest';
import { buildSchedule } from '../scheduler.js';

const ALL_ENABLED = {
  enableTournamentDiscovery: true,
  enableWidgetCodeLookup: true,
  enablePlayerRankings: true,
  enablePlayerProfile: true,
  enableEntryListFetcher: true,
  enableDrawFetcher: true,
  enableFipEventPageEnricher: true,
  enableOopFetcher: true,
  enableResultsFetcher: true,
  enableStaticReconciler: true,
  enableMatchStatsFetcher: true,
  enableLivePollerManager: true,
  enableShadowDiffFinalizer: true,
  enableShadowDiffLive: true,
  enableCloseStaleLiveSweeper: true,
};

describe('buildSchedule', () => {
  it('includes all 15 workers when fully enabled', () => {
    const sched = buildSchedule(ALL_ENABLED);
    const names = sched.map((s) => s.name);
    expect(names).toContain('tournament-discovery');
    expect(names).toContain('widget-code-lookup');
    expect(names).toContain('player-rankings');
    expect(names).toContain('player-profile');
    expect(names).toContain('entry-list-fetcher');
    expect(names).toContain('draw-fetcher');
    expect(names).toContain('fip-event-page-enricher');
    expect(names).toContain('oop-fetcher');
    expect(names).toContain('results-fetcher');
    expect(names).toContain('static-reconciler');
    expect(names).toContain('match-stats-fetcher');
    expect(names).toContain('live-poller-manager');
    expect(names).toContain('shadow-diff-finalizer');
    expect(names).toContain('shadow-diff-live');
    expect(names).toContain('close-stale-live-sweeper');
  });

  it('schedules close-stale-live-sweeper every 5 minutes', () => {
    const sched = buildSchedule(ALL_ENABLED);
    const entry = sched.find((s) => s.name === 'close-stale-live-sweeper');
    expect(entry).toBeDefined();
    expect(entry!.cron).toBe('*/5 * * * *');
  });

  it('respects enableCloseStaleLiveSweeper=false', () => {
    const sched = buildSchedule({
      ...ALL_ENABLED,
      enableCloseStaleLiveSweeper: false,
    });
    expect(sched.map((s) => s.name)).not.toContain('close-stale-live-sweeper');
  });

  it('schedules shadow-diff-finalizer twice hourly at :10 and :40', () => {
    const sched = buildSchedule(ALL_ENABLED);
    const entry = sched.find((s) => s.name === 'shadow-diff-finalizer');
    expect(entry).toBeDefined();
    expect(entry!.cron).toBe('10,40 * * * *');
  });

  it('schedules shadow-diff-live every minute', () => {
    const sched = buildSchedule(ALL_ENABLED);
    const entry = sched.find((s) => s.name === 'shadow-diff-live');
    expect(entry).toBeDefined();
    expect(entry!.cron).toBe('*/1 * * * *');
  });

  it('respects enableShadowDiff flags false', () => {
    const sched = buildSchedule({
      ...ALL_ENABLED,
      enableShadowDiffFinalizer: false,
      enableShadowDiffLive: false,
    });
    const names = sched.map((s) => s.name);
    expect(names).not.toContain('shadow-diff-finalizer');
    expect(names).not.toContain('shadow-diff-live');
  });

  it('schedules match-stats-fetcher at :25', () => {
    const sched = buildSchedule(ALL_ENABLED);
    const entry = sched.find((s) => s.name === 'match-stats-fetcher');
    expect(entry).toBeDefined();
    expect(entry!.cron).toBe('25 * * * *');
  });

  it('schedules live-poller-manager every minute', () => {
    const sched = buildSchedule(ALL_ENABLED);
    const entry = sched.find((s) => s.name === 'live-poller-manager');
    expect(entry).toBeDefined();
    expect(entry!.cron).toBe('*/1 * * * *');
  });

  it('respects enableLivePollerManager=false', () => {
    const sched = buildSchedule({ ...ALL_ENABLED, enableLivePollerManager: false });
    expect(sched.map((s) => s.name)).not.toContain('live-poller-manager');
  });

  it('respects enable flags for static workers', () => {
    const sched = buildSchedule({
      ...ALL_ENABLED,
      enableEntryListFetcher: false,
      enableDrawFetcher: false,
      enableOopFetcher: false,
      enableResultsFetcher: false,
      enableStaticReconciler: false,
    });
    const names = sched.map((s) => s.name);
    expect(names).not.toContain('entry-list-fetcher');
    expect(names).not.toContain('draw-fetcher');
    expect(names).not.toContain('oop-fetcher');
    expect(names).not.toContain('results-fetcher');
    expect(names).not.toContain('static-reconciler');
  });

  it('schedules static-reconciler twice an hour at :05 and :35', () => {
    const sched = buildSchedule(ALL_ENABLED);
    const entry = sched.find((s) => s.name === 'static-reconciler');
    expect(entry).toBeDefined();
    expect(entry!.cron).toBe('5,35 * * * *');
  });

  it('schedules fip-event-page-enricher hourly at :12', () => {
    const sched = buildSchedule(ALL_ENABLED);
    const entry = sched.find((s) => s.name === 'fip-event-page-enricher');
    expect(entry).toBeDefined();
    expect(entry!.cron).toBe('12 * * * *');
  });

  it('respects enableFipEventPageEnricher=false', () => {
    const sched = buildSchedule({
      ...ALL_ENABLED,
      enableFipEventPageEnricher: false,
    });
    expect(sched.map((s) => s.name)).not.toContain('fip-event-page-enricher');
  });
});

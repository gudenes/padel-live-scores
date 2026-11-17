import { it, expect, vi } from 'vitest';
const run = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('../workers/courtbit-live-fetcher.js', () => ({ runCourtbitLiveFetcher: run }));
import { ALL_WORKERS, buildSchedule, getWorkerRunner } from '../scheduler.js';
it('CourtBit is opt-in, every five seconds, with dry-run default', async () => {
  expect(buildSchedule({} as any).some(s => s.name === 'courtbit-live-fetcher')).toBe(false);
  const schedule = buildSchedule({ enableCourtbitLive: true } as any).find(s => s.name === 'courtbit-live-fetcher')!;
  expect(schedule.cron).toBe('*/5 * * * * *');
  await schedule.run({} as any); expect(run).toHaveBeenLastCalledWith({}, { dryRun: true });
  await buildSchedule({ enableCourtbitLive: true, courtbitLiveDryRun: false } as any).find(s => s.name === 'courtbit-live-fetcher')!.run({} as any);
  expect(run).toHaveBeenLastCalledWith({}, { dryRun: false });
  expect(ALL_WORKERS).toContain('courtbit-live-fetcher');
  await getWorkerRunner('courtbit-live-fetcher')!({} as any); expect(run).toHaveBeenLastCalledWith({}, { dryRun: true });
});

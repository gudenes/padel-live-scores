import { it, expect, vi } from 'vitest';
const run = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('../workers/puntuate-live-fetcher.js', () => ({ runPuntuateLiveFetcher: run }));
import { ALL_WORKERS, buildSchedule, getWorkerRunner } from '../scheduler.js';
it('is opt-in and polls every 30 seconds; dry-run defaults to true', async () => {
  expect(buildSchedule({} as any).some(s => s.name === 'puntuate-live-fetcher')).toBe(false);
  const entry = buildSchedule({ enablePuntuateLive: true } as any).find(s => s.name === 'puntuate-live-fetcher')!;
  expect(entry.cron).toBe('*/30 * * * * *');
  await entry.run({} as any);
  expect(run).toHaveBeenLastCalledWith({}, { dryRun: true });
  const write = buildSchedule({ enablePuntuateLive: true, puntuateLiveDryRun: false } as any).find(s => s.name === 'puntuate-live-fetcher')!;
  await write.run({} as any);
  expect(run).toHaveBeenLastCalledWith({}, { dryRun: false });
});
it('registers the manual worker as read-only', async () => {
  expect(ALL_WORKERS).toContain('puntuate-live-fetcher');
  await getWorkerRunner('puntuate-live-fetcher')!({} as any);
  expect(run).toHaveBeenLastCalledWith({}, { dryRun: true });
});

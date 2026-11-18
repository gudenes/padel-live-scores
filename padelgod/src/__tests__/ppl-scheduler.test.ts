import { it, expect, vi } from 'vitest';
const run = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('../workers/ppl-live-fetcher.js', () => ({ runPplLiveFetcher: run }));
import { buildSchedule, getWorkerRunner } from '../scheduler.js';
it('PPL is disabled by default, three-second ticks opt in to dry run', async () => {
  expect(buildSchedule({} as any).find(x => x.name === 'ppl-live-fetcher')).toBeUndefined();
  const entry = buildSchedule({ enablePplLive: true } as any).find(x => x.name === 'ppl-live-fetcher')!;
  expect(entry.cron).toBe('*/3 * * * * *');
  await entry.run({} as any); expect(run).toHaveBeenLastCalledWith({}, { dryRun: true });
  await getWorkerRunner('ppl-live-fetcher')!({} as any); expect(run).toHaveBeenLastCalledWith({}, { dryRun: true });
});

import { expect, it, vi } from 'vitest';
import { buildSchedule } from '../scheduler.js';
import { runFipDrawResultsWriter } from '../workers/fip-draw-results-writer.js';
vi.mock('../workers/fip-draw-results-writer.js', () => ({ runFipDrawResultsWriter: vi.fn(async () => ({})) }));
it('restricts scheduled reconciliation to the configured tournament allowlist', async () => {
  const onlyTournamentIds = new Set(['milano']);
  const entries = buildSchedule({ enableFipDrawResultsWriter: true, fipDrawResultsWriterDryRun: false, fipDrawResultsWriterTournamentIds: onlyTournamentIds } as never);
  const entry = entries.find(e => e.name === 'fip-draw-results-writer');
  expect(entry).toBeDefined();
  await entry!.run({ supabase: 'client' } as never);
  expect(runFipDrawResultsWriter).toHaveBeenCalledWith(expect.objectContaining({ dryRun: false, onlyTournamentIds }));
});

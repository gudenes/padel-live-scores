import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadCupTies } from '../world-cup-tie-source';
import { parseCupStreams } from '../world-cup-parser';
const fixture = readFileSync('src/lib/__tests__/fixtures/world-cup/streams.html', 'utf8');
const now = new Date('2026-11-03T10:00:00Z');
const ties = parseCupStreams(fixture, now);
describe('scheduled World Cup tie source', () => {
  it('uses a fresh snapshot without requesting FIP', async () => {
    const fetchPage = vi.fn();
    const result = await loadCupTies({ now, fetchPage, loadSnapshot: async () => ({ ties, fetched_at: now.toISOString() }) });
    expect(result.ties).toEqual(ties); expect(result.partial).toBe(false);
    expect(fetchPage).not.toHaveBeenCalled();
  });
  it('uses FIP if the table is absent or the snapshot is stale', async () => {
    const result = await loadCupTies({ now, fetchPage: async () => fixture, loadSnapshot: async () => { throw new Error('missing table'); } });
    expect(result.ties).toEqual(ties); expect(result.partial).toBe(false);
  });
  it('retains recent saved ties without refreshing timestamps on failure', async () => {
    const fetched_at = '2026-11-03T09:00:00Z';
    const result = await loadCupTies({ now, fetchPage: async () => '<html>error</html>', loadSnapshot: async () => ({ ties, fetched_at }) });
    expect(result).toEqual({ ties, fetchedAt: fetched_at, partial: true });
  });
  it('does not serve day-old or invalid-date announcements after failures', async () => {
    for (const fetched_at of ['2026-11-01T09:00:00Z', 'invalid']) {
      const result = await loadCupTies({ now, fetchPage: async () => { throw new Error('offline'); }, loadSnapshot: async () => ({ ties, fetched_at }) });
      expect(result.ties).toEqual([]); expect(result.partial).toBe(true);
    }
  });
});

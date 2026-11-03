import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runWorldCupTieFetcher } from '../../workers/world-cup-tie-fetcher.js';
import { parseCupStreams } from '../../parsers/world-cup-ties.js';
const fixture = readFileSync('../src/lib/__tests__/fixtures/world-cup/streams.html', 'utf8');
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-03T10:00:00Z')); });
afterEach(() => vi.useRealTimers());
function deps(html = fixture) {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  return { supabase: { from: vi.fn().mockReturnValue({ upsert }) }, httpClient: { get: vi.fn().mockResolvedValue({ data: html }) }, upsert };
}
describe('World Cup scheduled announcements', () => {
  it('captures valid ties, timestamps, gender and broadcast identity', () => {
    const ties = parseCupStreams(fixture);
    expect(ties.length).toBeGreaterThan(0);
    expect(ties.every(t => t.home && t.away && t.videoId.length === 11 && (t.scheduledAt || t.liveObservedAt))).toBe(true);
  });
  it('updates one event snapshot and defaults to read only', async () => {
    const d = deps();
    await runWorldCupTieFetcher(d as never);
    expect(d.upsert).not.toHaveBeenCalled();
    await runWorldCupTieFetcher({ ...d, dryRun: false } as never);
    expect(d.upsert).toHaveBeenCalledWith(expect.objectContaining({ fetched_at: '2026-11-03T10:00:00.000Z' }), { onConflict: 'tournament_id' });
  });
  it('retains data on empty pages or network failures and releases the overlap guard', async () => {
    const d = deps('<html>Unavailable</html>');
    await expect(runWorldCupTieFetcher({ ...d, dryRun: false } as never)).rejects.toThrow('no scheduled or live ties');
    expect(d.upsert).not.toHaveBeenCalled();
    d.httpClient.get.mockRejectedValueOnce(new Error('timeout'));
    await expect(runWorldCupTieFetcher(d as never)).rejects.toThrow('timeout');
    d.httpClient.get.mockResolvedValue({ data: fixture });
    expect(await runWorldCupTieFetcher(d as never)).toMatchObject({ updated: false });
  });
  it('skips outside the event and overlapping calls', async () => {
    const d = deps();
    vi.setSystemTime(new Date('2026-11-09T00:00:00Z'));
    expect(await runWorldCupTieFetcher(d as never)).toEqual({ skipped: 'outside-event' });
    expect(d.httpClient.get).not.toHaveBeenCalled();
    vi.setSystemTime(new Date('2026-11-03T10:00:00Z'));
    let done!: (value: { data: string }) => void;
    d.httpClient.get.mockReturnValue(new Promise(resolve => { done = resolve; }));
    const first = runWorldCupTieFetcher(d as never);
    expect(await runWorldCupTieFetcher(d as never)).toEqual({ skipped: 'already-running' });
    done({ data: fixture }); await first;
  });
});
it('stores broadcast languages under one country tie',()=>{
 const card=(language:string,id:string)=>`<li class="bw-yt-item"><a data-yt="${id}" data-title="[${language}] Italy vs Mexico"><span class="bw-yt-badge--live">Live</span><span class="bw-yt-tags">MEN GROUP D</span></a></li>`;
 const ties=parseCupStreams(card('ENG','g0M7qNVQ6kw')+card('ESP','XmHXJj55beE'));
 expect(ties).toHaveLength(1);expect(ties[0]).toMatchObject({home:'Italy',away:'Mexico',streams:[{videoId:'g0M7qNVQ6kw',language:'ENG'},{videoId:'XmHXJj55beE',language:'ESP'}]});
});

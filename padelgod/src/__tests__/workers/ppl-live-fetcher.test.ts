import { it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ load: vi.fn(), adapt: vi.fn(), resolve: vi.fn() }));
vi.mock('../../lib/ppl-resolve.js', () => ({ loadPplContext: mocks.load, resolvePplSnapshot: mocks.resolve }));
vi.mock('../../lib/ppl-adapter.js', () => ({ pplToSnapshot: mocks.adapt }));
import { createPplRunner, activePplEvents } from '../../workers/ppl-live-fetcher.js';

const event = { slug: 'playa-del-carmen', startsAt: '2026-09-24', endsAt: '2026-09-27', name: 'Playa', league: 'ppl' as const };
function setup() {
  const client = { index: vi.fn().mockResolvedValue([event]), event: vi.fn().mockResolvedValue({ matchIds: ['one'], fixtures: [{ id: 'one' }] }),
    match: vi.fn().mockResolvedValue({ data: {}, revision: '2026-09-26T15:00:00Z' }) };
  const maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'tour', level: 'ppl' } });
  const query = { select: () => query, eq: () => query, maybeSingle };
  const deps = { supabase: { from: vi.fn(() => query), rpc: vi.fn().mockResolvedValue({ data: { applied: true } }) },
    httpClient: {}, logger: { info: vi.fn(), warn: vi.fn() } };
  return { client, deps, run: createPplRunner(client as any), opts: { dryRun: true, eventSlugs: [event.slug] } };
}
beforeEach(() => {
  vi.useRealTimers(); vi.clearAllMocks(); mocks.load.mockImplementation(async () => ({ matches: [], matchMappings: new Map() }));
  mocks.adapt.mockReturnValue({ status: 'live', players: [] });
  mocks.resolve.mockReturnValue({ ok: true, matchId: 'match', oldPlayers: [], playerIds: [], tieKey: 'tie' });
});
it('dry-run never invokes RPC and caches resolver reads between live ticks', async () => {
  const { run, deps, opts } = setup();
  expect(await run(deps as any, opts)).toMatchObject({ live: 1, resolved: 1, applied: 0 });
  await run(deps as any, opts);
  expect(deps.supabase.rpc).not.toHaveBeenCalled(); expect(mocks.load).toHaveBeenCalledTimes(1);
});
it('keeps a failed commit eligible for retry after backoff', async () => {
  vi.useFakeTimers(); const { run, deps, opts } = setup();
  deps.supabase.rpc.mockResolvedValueOnce({ error: { message: 'failed' } } as any);
  expect((await run(deps as any, { ...opts, dryRun: false })).errors).toBe(1);
  await vi.advanceTimersByTimeAsync(30_001);
  expect((await run(deps as any, { ...opts, dryRun: false })).applied).toBe(1);
});
it('does not let a read-only final check suppress a later write', async () => {
  const s = setup(); mocks.adapt.mockReturnValue({ status: 'finished', players: [] });
  expect((await s.run(s.deps as any, s.opts)).resolved).toBe(1);
  expect((await s.run(s.deps as any, { ...s.opts, dryRun: false })).applied).toBe(1);
});
it('blocks overlapping runs, unknown identities and prefilled scheduled cards', async () => {
  const { run, deps, client, opts } = setup();
  let release!: (x: unknown) => void;
  client.index.mockImplementationOnce(() => new Promise(r => { release = r; }));
  const pending = run(deps as any, opts);
  expect((await run(deps as any, opts)).skipped).toBe(1); release([event]); await pending;
  mocks.resolve.mockReturnValue({ ok: false, reason: 'player_ambiguous', candidates: ['a', 'b'] });
  expect((await run(deps as any, { ...opts, dryRun: false })).issues).toContainEqual({ id: 'one', ok: false, reason: 'player_ambiguous', candidates: ['a', 'b'] });
  expect(deps.supabase.rpc).not.toHaveBeenCalledWith('apply_ppl_snapshot', expect.anything());
  const other = setup(); mocks.adapt.mockReturnValue({ status: 'scheduled' });
  expect((await other.run(other.deps as any, other.opts)).live).toBe(0);
});
it('reports missing event registration rather than inserting duplicates', async () => {
  const s = setup(); s.deps.supabase.from().maybeSingle.mockResolvedValue({ data: null } as any);
  expect((await s.run(s.deps as any, s.opts)).issues).toContainEqual({ id: event.slug, reason: 'event_requires_onboarding' });
  expect(s.deps.supabase.rpc).not.toHaveBeenCalled();
});
it('selects active events with a local-date buffer, never old September fixtures', () => {
  const vegas = { ...event, slug: 'vegas', startsAt: '2026-11-18', endsAt: '2026-11-21' };
  expect(activePplEvents([event, vegas], Date.parse('2026-11-18T14:00:00Z'))).toEqual([vegas]);
});

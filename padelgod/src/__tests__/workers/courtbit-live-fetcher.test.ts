import { it, expect, vi, beforeEach } from 'vitest';
import { row, context } from '../helpers/courtbit.js';
const mocks = vi.hoisted(() => ({ load: vi.fn(), notify: vi.fn() }));
vi.mock('../../lib/courtbit-resolve.js', async original => ({ ...(await original<object>()), loadCourtbitContext: mocks.load }));
vi.mock('../../lib/notify.js', () => ({ notifyLiveTransition: mocks.notify }));
import { createCourtbitRunner } from '../../workers/courtbit-live-fetcher.js';
const opts = { dryRun: false, targets: [{ tournamentId: 'tournament', url: 'https://fip.courtbit.com.mx', expectedName: 'Event' }] };
function deps() {
  return { supabase: { rpc: vi.fn().mockResolvedValue({ data: { applied: true, notify: true }, error: null }) },
    httpClient: { get: vi.fn().mockResolvedValue({ status: 200, data: { ok: true, name: 'Event', matches: [row] }, headers: { etag: 'etag' } }) },
    logger: { warn: vi.fn(), info: vi.fn() }, notify: {}, eventsEnabled: true } as any;
}
beforeEach(() => { vi.clearAllMocks(); mocks.load.mockImplementation(async () => context()); });
it('dry run validates identities and scores without writes or notifications', async () => {
  const d = deps(); const result = await createCourtbitRunner()(d, { ...opts, dryRun: true });
  expect(result).toMatchObject({ players: 4, resolved: 1, applied: 0, errors: 0 });
  expect(d.supabase.rpc).not.toHaveBeenCalled(); expect(mocks.notify).not.toHaveBeenCalled();
});
it('only notifies when the atomic writer claims the start transition', async () => {
  const d = deps(); const run = createCourtbitRunner();
  await run(d, opts);
  expect(mocks.notify).toHaveBeenCalledTimes(1);
  d.supabase.rpc.mockResolvedValue({ data: { applied: false, reason: 'unchanged' } });
  d.httpClient.get.mockResolvedValue({ status: 304 });
  await run(d, opts);
  expect(mocks.notify).toHaveBeenCalledTimes(1);
});
it('retries uncommitted snapshots on 304 after a database failure', async () => {
  const d = deps(); const run = createCourtbitRunner();
  d.supabase.rpc.mockResolvedValueOnce({ error: { message: 'write failed' } });
  expect((await run(d, opts)).errors).toBe(1);
  expect(mocks.notify).not.toHaveBeenCalled();
  d.httpClient.get.mockResolvedValue({ status: 304 });
  expect((await run(d, opts)).applied).toBe(1);
  expect(d.supabase.rpc.mock.calls[0][1].p_snapshot).toEqual(d.supabase.rpc.mock.calls[1][1].p_snapshot);
});
it('skips unresolved and terminal matches without side effects', async () => {
  const d = deps(); const ctx = context(); ctx.matches[0]!.pair1_player1_id = null;
  mocks.load.mockResolvedValue(ctx);
  expect((await createCourtbitRunner()(d, opts)).issues[0]?.reason).toBe('match_requires_reconciliation');
  ctx.matches[0]!.pair1_player1_id = '2'; ctx.matches[0]!.status = 'finished';
  expect((await createCourtbitRunner()(d, opts)).skipped).toBe(1);
  expect(d.supabase.rpc).not.toHaveBeenCalled();
});
it('isolates malformed rows and blocks overlapping invocations', async () => {
  const d = deps(); const run = createCourtbitRunner();
  let release!: (value: unknown) => void;
  d.httpClient.get.mockImplementationOnce(() => new Promise(r => { release = r; }));
  const first = run(d, opts);
  expect((await run(d, opts)).skipped).toBe(1);
  release({ status: 200, headers: {}, data: { ok: true, name: 'Event', matches: [{ ...row, id: 'bad', status: 'invalid' }, row] } });
  expect(await first).toMatchObject({ applied: 1, errors: 1 });
});
it('fetch errors back off and never write', async () => {
  const d = deps(); const run = createCourtbitRunner(); d.httpClient.get.mockRejectedValue(new Error('unavailable'));
  expect((await run(d, opts)).errors).toBe(1);
  expect((await run(d, opts)).skipped).toBe(1);
  expect(d.httpClient.get).toHaveBeenCalledTimes(1); expect(d.supabase.rpc).not.toHaveBeenCalled();
});

it('writes thin participants but never maps an ambiguous profile', async () => {
  const d=deps(),ctx=context();ctx.players.push({...ctx.players[0]!,id:'duplicate'});
  mocks.load.mockResolvedValue(ctx);
  expect(await createCourtbitRunner()(d,opts)).toMatchObject({applied:1,unresolvedPlayers:1});
  const args=d.supabase.rpc.mock.calls[0][1];
  expect(args.p_snapshot.participants[1]).toMatchObject({name:'Ana One',playerId:null});
  expect(args.p_links).toHaveLength(3);
  expect(args.p_names).toEqual([null,null,null,null]);
});

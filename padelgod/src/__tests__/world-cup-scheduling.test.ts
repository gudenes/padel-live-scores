import {beforeEach,describe,expect,it,vi} from 'vitest';
import {buildSchedule,getWorkerRunner,type SchedulerFlags,type SchedulerDeps} from '../scheduler.js';
const mocks=vi.hoisted(()=>({populate:vi.fn(),schedule:vi.fn(),players:vi.fn(),fetchOop:vi.fn(),ties:vi.fn()}));
vi.mock('../workers/oop-fetcher.js',()=>({runOopFetcher:mocks.fetchOop}));
vi.mock('../workers/world-cup-tie-fetcher.js',()=>({runWorldCupTieFetcher:mocks.ties}));
vi.mock('../workers/fip-draw-populator.js',()=>({runFipDrawPopulator:mocks.populate}));
vi.mock('../workers/fip-oop-writer.js',()=>({runFipOopWriter:mocks.schedule}));
vi.mock('../workers/world-cup-reconciler.js',()=>({runScheduledWorldCupReconciler:mocks.players}));
const flags={fipDrawPopulatorOnlyTournaments:"",fipDrawPopulatorExcludeLevels:"",enableFipDrawPopulator:true,enableFipOopWriter:true,fipDrawPopulatorDryRun:false,fipOopWriterDryRun:false,enableStaticReconciler:true} as SchedulerFlags;
const deps={supabase:{},logger:{}} as SchedulerDeps;
beforeEach(()=>vi.resetAllMocks());
describe('import completion',()=>{
 it('waits for match creation before schedules and preserves the result',async()=>{
  let finish!:(value:unknown)=>void;
  mocks.populate.mockReturnValue(new Promise(resolve=>{finish=resolve}));
  const running=buildSchedule(flags).find(e=>e.name==='fip-draw-populator')!.run(deps);
  expect(mocks.schedule).not.toHaveBeenCalled();finish({created:24});
  expect(await running).toEqual({created:24});
  expect(mocks.schedule).toHaveBeenCalledWith(expect.objectContaining({dryRun:false,supabase:deps.supabase}));
 });
 it.each([{fipDrawPopulatorDryRun:true},{enableFipOopWriter:false}])('avoids unexpected writes with %o',async override=>{
  await buildSchedule({...flags,...override}).find(e=>e.name==='fip-draw-populator')!.run(deps);
  expect(mocks.schedule).not.toHaveBeenCalled();
 });
 it('preserves schedule dry-run',async()=>{
  await buildSchedule({...flags,fipOopWriterDryRun:true}).find(e=>e.name==='fip-draw-populator')!.run(deps);
  expect(mocks.schedule).toHaveBeenCalledWith(expect.objectContaining({dryRun:true}));
 });
 it('does not follow failed imports',async()=>{
  mocks.populate.mockRejectedValue(new Error('import failed'));
  await expect(buildSchedule(flags).find(e=>e.name==='fip-draw-populator')!.run(deps)).rejects.toThrow('import failed');
  expect(mocks.schedule).not.toHaveBeenCalled();
 });
});
it('independently schedules World Cup linking every five minutes',async()=>{
 const entry=buildSchedule(flags).find(e=>e.name==='world-cup-reconciler')!;
 expect(entry.cron).toBe('*/5 * * * *');await entry.run(deps);
 expect(mocks.players).toHaveBeenCalledWith({supabase:deps.supabase,dryRun:false});
});
it('honours disablement and read-only manual triggers',async()=>{
 expect(buildSchedule({...flags,enableStaticReconciler:false}).some(e=>e.name==='world-cup-reconciler')).toBe(false);
 await getWorkerRunner('world-cup-reconciler')!(deps);
 expect(mocks.players).toHaveBeenCalledWith({supabase:deps.supabase,dryRun:true});
});
describe('World Cup import after OOP fetch', () => {
 const cupFlags={...flags,enableOopFetcher:true};
 it('waits for OOP capture, imports only World Cup, then fills schedules',async()=>{
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
  try {
   let finish!:(value:unknown)=>void;
   mocks.fetchOop.mockReturnValue(new Promise(resolve=>{finish=resolve}));
   mocks.populate.mockResolvedValue({tournamentsFailed:0});
   const running=buildSchedule(cupFlags).find(e=>e.name==='oop-fetcher')!.run(deps);
   expect(mocks.populate).not.toHaveBeenCalled(); finish({totalMatchesInserted:12});
   expect(await running).toEqual({totalMatchesInserted:12});
   const expected=new Set(['2c1a0800-3bd6-424c-92f1-5417fea2cba1']);
   expect(mocks.populate).toHaveBeenCalledWith(expect.objectContaining({onlyTournamentIds:expected,dryRun:false}));
   expect(mocks.schedule).toHaveBeenCalledWith(expect.objectContaining({onlyTournamentIds:expected,dryRun:false}));
   expect(mocks.populate.mock.invocationCallOrder[0]).toBeLessThan(mocks.schedule.mock.invocationCallOrder[0]!);
  } finally { vi.useRealTimers(); }
 });
 it.each([{enableFipDrawPopulator:false},{fipDrawPopulatorDryRun:true},{fipDrawPopulatorOnlyTournaments:'11111111-1111-4111-8111-111111111111'}])('respects import gates %o',async override=>{
  await buildSchedule({...cupFlags,...override}).find(e=>e.name==='oop-fetcher')!.run(deps);
  expect(mocks.populate).not.toHaveBeenCalled();expect(mocks.schedule).not.toHaveBeenCalled();
 });
 it('does not import after a failed OOP fetch',async()=>{
  mocks.fetchOop.mockRejectedValue(new Error('fetch failed'));
  await expect(buildSchedule(cupFlags).find(e=>e.name==='oop-fetcher')!.run(deps)).rejects.toThrow('fetch failed');
  expect(mocks.populate).not.toHaveBeenCalled();
 });
 it('does not fill schedules after a partial import failure',async()=>{
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
  try {
   mocks.populate.mockResolvedValue({tournamentsFailed:1});
   await expect(buildSchedule(cupFlags).find(e=>e.name==='oop-fetcher')!.run(deps)).rejects.toThrow('World Cup OOP import failed');
   expect(mocks.schedule).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
 });
 it('stops event imports after November 8',async()=>{
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-09T00:00:00Z'));
  try { await buildSchedule(cupFlags).find(e=>e.name==='oop-fetcher')!.run(deps);expect(mocks.populate).not.toHaveBeenCalled(); }
  finally { vi.useRealTimers(); }
 });
 it('registers five-minute tie polling and keeps manual execution read only',async()=>{
  const entry=buildSchedule(cupFlags).find(e=>e.name==='world-cup-tie-fetcher')!;
  expect(entry.cron).toBe('*/5 * * * *');await entry.run(deps);
  expect(mocks.ties).toHaveBeenLastCalledWith({...deps,dryRun:false});
  await getWorkerRunner('world-cup-tie-fetcher')!(deps);
  expect(mocks.ties).toHaveBeenLastCalledWith({...deps,dryRun:true});
 });
});

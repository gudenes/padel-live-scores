import {beforeEach,describe,expect,it,vi} from 'vitest';
import {buildSchedule,getWorkerRunner,type SchedulerFlags,type SchedulerDeps} from '../scheduler.js';
const mocks=vi.hoisted(()=>({populate:vi.fn(),schedule:vi.fn(),players:vi.fn()}));
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

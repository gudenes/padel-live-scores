import {afterEach,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {runScheduledWorldCupReconciler} from '../../workers/world-cup-reconciler.js';
afterEach(()=>vi.useRealTimers());
it('skips outside the event window',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-09T00:00:00Z'));
 const from=vi.fn();
 expect(await runScheduledWorldCupReconciler({supabase:{from} as unknown as SupabaseClient})).toEqual({skipped:'outside-event'});
 expect(from).not.toHaveBeenCalled();
});
it('prevents overlap and releases its guard after errors',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
 let fail!:(reason:Error)=>void;
 const eq=vi.fn().mockReturnValueOnce(new Promise((_,reject)=>{fail=reject})).mockResolvedValue({data:[],error:null});
 const supabase={from:()=>({select:()=>({eq})})} as unknown as SupabaseClient;
 const first=runScheduledWorldCupReconciler({supabase});
 expect(await runScheduledWorldCupReconciler({supabase})).toEqual({skipped:'already-running'});
 const rejected=expect(first).rejects.toThrow('database unavailable');fail(new Error('database unavailable'));await rejected;
 expect(await runScheduledWorldCupReconciler({supabase})).toEqual({proposed:0,updated:0,unresolved:0});
});

import {describe,it,expect,vi} from 'vitest';
import {puntuateWinner,writePuntuateProgress} from '../../lib/puntuate-progress.js';
import {parsePuntuateDuration,type PuntuateRow} from '../../lib/puntuate-client.js';
const row={status:'Live',setsA:[6,6],setsB:[2,4],durationMinutes:65} as PuntuateRow;
describe('Puntuate progress',()=>{
 it('uses orientation and completed sets',()=>{
 expect(puntuateWinner(row,'AB')).toBe(1);expect(puntuateWinner(row,'BA')).toBe(2);
 for(const [a,b] of [[[6,5],[2,4]],[[6,7],[2,7]],[[6,6,1],[2,4,0]],[[6,3,5],[2,6,3]]])expect(puntuateWinner({...row,setsA:a!,setsB:b!},'AB')).toBeNull();
 });
 it('parses elapsed duration without accepting clock times or impossible values',()=>{
 expect(parsePuntuateDuration('1h 05min')).toBe(65);expect(parsePuntuateDuration('0h 00min')).toBe(0);
 for(const value of ['', '14:30','1h 99min','8h 00min'])expect(parsePuntuateDuration(value)).toBeNull();
 });
 it('persists complete score before guarded final transition and stamps clock-derived start',async()=>{
 const updates:any[]=[];const sets:any[]=[];
 const chain:any={eq:()=>chain,in:vi.fn(()=>chain),is:()=>chain,then:(r:any)=>r({error:null})};
 const db:any={from:(table:string)=>({upsert:async(s:any)=>{sets.push(s);return {error:null}},update:(p:any)=>{updates.push(p);return chain}})};
 await writePuntuateProgress(db,'id',row,'BA',new Date('2026-10-23T12:00:00Z'));
 expect(sets.map(s=>s.set_score)).toEqual(['2-6','4-6']);expect(sets.every(s=>!s.is_current)).toBe(true);
 expect(updates[0].started_at).toBe('2026-10-23T10:55:00.000Z');expect(updates[1]).toMatchObject({status:'finished',winner_pair:2,duration:'01:05'});
 expect(chain.in).toHaveBeenCalledWith('status',['scheduled','live','on_court']);
 });
 it('does not backdate an old finished card start from the current time',async()=>{
 const patches:any[]=[];const chain:any={eq:()=>chain,in:()=>chain,then:(r:any)=>r({error:null})};
 const db:any={from:()=>({upsert:async()=>({error:null}),update:(p:any)=>{patches.push(p);return chain}})};
 await writePuntuateProgress(db,'id',{...row,status:'Finished'},'AB');expect(patches).toHaveLength(1);expect(patches[0].started_at).toBeUndefined();
 });
});

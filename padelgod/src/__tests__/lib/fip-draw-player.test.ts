import { describe, it, expect } from 'vitest';
import { createFipDrawPlayerResolver, fipDrawProfileId, isFullFipPlayerName, preserveDrawPlayerLinks } from '../../lib/fip-draw-player.js';
function db(seed: any[] = []) {
 const rows=[...seed], writes:any[]=[];
 return {rows,writes,client:{from:()=>({select:()=>({ilike:async(_:string,name:string)=>({data:rows.filter(p=>p.name.toLowerCase()===name.toLowerCase()),error:null})}),upsert:async(row:any)=>{writes.push(row);if(!rows.some(p=>p.id===row.id))rows.push(row);return {error:null};}})} as any};
}
describe('FIP full-name resolution',()=>{
 it('reuses all eight corrected profiles with no FIP ID',async()=>{
 const names=['Berke Sen','Fin Robertson','Luca Cheshire','Will Edlin','Ben David George Burgess','Kieran Thomas Muir','Chuan Yu Chiu','Artemii Kislov'];
 const d=db(names.map((name,i)=>({id:`p${i}`,name,category:'men',fip_id:null})));const r=createFipDrawPlayerResolver(d.client,false);
 for(let i=0;i<names.length;i++)expect(await r(names[i],'men')).toBe(`p${i}`);expect(d.writes).toHaveLength(0);
 });
 it('is idempotent across concurrent workers and never fabricates FIP IDs',async()=>{
 const d=db();const ids=await Promise.all([createFipDrawPlayerResolver(d.client,false)('Fin Robertson','men'),createFipDrawPlayerResolver(d.client,false)('Fin Robertson','men')]);
 expect(ids[0]).toBe(ids[1]);expect(d.rows).toHaveLength(1);expect(d.rows[0]).not.toHaveProperty('fip_id');expect(d.rows[0]).not.toHaveProperty('external_id');expect(fipDrawProfileId('Fin Robertson','women')).not.toBe(ids[0]);
 });
 it('rejects ambiguous names and distinguishes categories',async()=>{
 const d=db([{id:'a',name:'Fin Robertson',category:'men'},{id:'b',name:'Fin Robertson',category:'men'},{id:'c',name:'Fin Robertson',category:'women'}]);const r=createFipDrawPlayerResolver(d.client,false);
 expect(await r('Fin Robertson','men')).toBeNull();expect(await r('Fin Robertson','women')).toBe('c');expect(d.writes).toHaveLength(0);
 });
 it('refuses shorthand/placeholders and writes nothing in dry runs',async()=>{
 const d=db();const r=createFipDrawPlayerResolver(d.client,false);for(const name of ['F. Robertson','F Robertson','Bye','Winner MQ012','Lucky Loser','Qualifier 1','TBD TBD']){expect(isFullFipPlayerName(name)).toBe(false);expect(await r(name,'men')).toBeNull();}
 expect(await createFipDrawPlayerResolver(d.client,true)('Fin Robertson','men')).toBeNull();expect(d.writes).toHaveLength(0);
 });
});
describe('draw correction retention',()=>{
 const old={player1_name:'Alex Romero',player1_id:'alex',player2_name:'Chuan Yu Chiu',player2_id:'chiu'};
 it('preserves corrected IDs when later resolution is null or different',()=>{expect(preserveDrawPlayerLinks({...old,player1_id:'wrong',player2_id:null},old)).toEqual(old);});
 it('tracks identity across reversed partner order',()=>{expect(preserveDrawPlayerLinks({player1_name:'Chuan Yu Chiu',player1_id:null,player2_name:'Alex Romero',player2_id:null},old)).toMatchObject({player1_id:'chiu',player2_id:'alex'});});
 it('does not carry an old ID into a replacement player',()=>{expect(preserveDrawPlayerLinks({...old,player2_name:'Fin Robertson',player2_id:null},old).player2_id).toBeNull();});
});

describe('individual FIP ID enrichment',()=>{
 it('keeps the canonical UUID when a verified individual ID becomes available',async()=>{
   const {attachFipIdToDrawProfile}=await import('../../lib/fip-draw-player.js');
   const before={id:'corrected',category:'men',country:'GB',fip_id:null};let patch:any;
   const client={from:()=>({select:()=>({ilike:async()=>({data:[before],error:null})}),update:(p:any)=>{patch=p;return {eq:()=>({is:()=>({select:async()=>({data:[{id:'corrected'}],error:null})})})};}})} as any;
   expect(await attachFipIdToDrawProfile(client,{name:'Fin Robertson',category:'men',country:'GB',fipId:'P123456'},false)).toBe('corrected');
   expect(patch.fip_id).toBe('P123456');expect(patch).not.toHaveProperty('id');
 });
 it('refuses conflicting country or ambiguous identities',async()=>{
   const {attachFipIdToDrawProfile}=await import('../../lib/fip-draw-player.js');
   const d=db([{id:'a',name:'Fin Robertson',category:'men',country:'US',fip_id:null}]);
   expect(await attachFipIdToDrawProfile(d.client,{name:'Fin Robertson',category:'men',country:'GB',fipId:'P123456'},true)).toBeNull();
   d.rows.push({id:'b',name:'Fin Robertson',category:'men',country:'GB',fip_id:null});
   expect(await attachFipIdToDrawProfile(d.client,{name:'Fin Robertson',category:'men',country:'GB',fipId:'P123456'},true)).toBeNull();
 });
});

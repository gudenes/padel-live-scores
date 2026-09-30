import { describe,it,expect } from 'vitest'
import { validateEditorialConfig,editorialBindingErrors,editorialParams,editorialCopy,type EditorialConfig } from '../../../../../shared/play-editorial'
import { previewEditorial } from '../play-editorial-service'
const ids=['11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222']
const event='33333333-3333-3333-3333-333333333333'
const config:EditorialConfig={family:'round',category:'men',playerIds:ids,tournamentIds:[event],round:'SF',target:1,minimumStarts:1,startsAt:'',endsAt:'2026-10-04T23:59:59Z',locksAt:'',voidAfter:'2026-10-12T00:00:00Z',probability:null,probabilitySource:'',maxLoss:5000}
const now=new Date('2026-09-29T10:00:00Z')
function database(over:Record<string,unknown>={}) {
 const data:Record<string,unknown>={players:ids.map((id,i)=>({id,name:`Player ${i}`,category:'men'})),tournaments:[{id:event,name:'Rotterdam',level:'p2',starts_at:'2026-09-28',ends_at:'2026-10-04'}],market_seasons:{id:event,starts_at:'2026-09-01',ends_at:'2026-12-23'},market_templates:{enabled:true},matches:[{id:'44444444-4444-4444-4444-444444444444',tournament_id:event,status:'scheduled',scheduled_at:'2026-09-29T15:00:00Z',round_canonical:'R16',pair1_player1_id:ids[0],pair1_player2_id:ids[1],pair2_player1_id:'x',pair2_player2_id:'y'}],tournament_projections:[{pair_player_ids:ids,champion_prob:.5,semifinal_prob:.6,finalist_prob:.4,computed_at:'2026-09-29T09:00:00Z',model_version:'v1'}],...over}
 return {from:(table:string)=>{const chain:Record<string,unknown>={};for(const method of ['select','in','eq','contains','limit','maybeSingle','gte','lte'])chain[method]=()=>chain;chain.then=(resolve:(v:unknown)=>unknown)=>resolve({data:data[table]??[],error:null});return chain}} as never
}
describe('editorial authoring contract',()=>{
 it('rejects raw resolver injection and duplicate subjects',()=>{
  expect(()=>validateEditorialConfig({...config,resolverKey:'evil'})).toThrow('Unknown')
  expect(()=>validateEditorialConfig({...config,playerIds:[ids[0],ids[0]]})).toThrow('distinct')
 })
 it('normalises IDs and times before fingerprinting',()=>{
  const c=validateEditorialConfig({...config,playerIds:[...ids].reverse()});expect(c.playerIds).toEqual(ids);expect(c.voidAfter).toBe('2026-10-12T00:00:00.000Z')
 })
 it('requires priced sources and a future window for long-term publication',()=>{
  const c={...config,family:'ranking' as const,playerIds:[ids[0]],tournamentIds:[],startsAt:'2026-10-01T00:00:00Z',endsAt:'2026-11-30T23:59:59Z',locksAt:'2026-10-01T00:00:00Z',voidAfter:'2026-12-08T00:00:00Z'}
  expect(editorialBindingErrors(c,now)).toContain('Add a priced estimate and explain its source. No automatic long-term model is available.')
  expect(editorialBindingErrors({...c,probability:.3,probabilitySource:'Explicit editorial estimate: historical ranking trend.'},now)).toEqual([])
 })
 it('uses clear bilingual rules and derived resolver parameters',()=>{
  expect(editorialParams(config)).toMatchObject({player1Id:ids[0],round:'SF'})
  expect(editorialCopy(config,['A','B'],['Rotterdam']).rules.en).toContain('walkover')
  expect(editorialCopy(config,['A','B'],['Rotterdam']).question.es).toContain('semifinales')
 })
})
describe('publication preview',()=>{
 it('binds the next match and current model instead of client supplied prices',async()=>{
  const p=await previewEditorial(database(),{...config,probability:.2},now)
  expect(p.errors).toEqual([]);expect(p.probability).toBe(.6);expect(p.locksAt).toBe('2026-09-29T15:00:00Z');expect(p.boundMatchId).toBeTruthy()
 })
 it('rejects stale projections and started matches',async()=>{
  const p=await previewEditorial(database({tournament_projections:[]}),config,now)
  expect(p.errors.join(' ')).toContain('projection')
  const r=await previewEditorial(database({matches:[]}),config,now)
  expect(r.errors.join(' ')).toContain('future confirmed')
 })
 it('changes the fingerprint when the market price changes',async()=>{
  const a=await previewEditorial(database(),config,now)
  const b=await previewEditorial(database({tournament_projections:[{semifinal_prob:.7,computed_at:'2026-09-29T09:00:00Z',model_version:'v1'}]}),config,now)
  expect(a.fingerprint).not.toBe(b.fingerprint)
 })
 it('does not reopen an eliminated pair or permit the wrong draw',async()=>{
  const p=await previewEditorial(database({players:ids.map(id=>({id,name:'Player',category:'women'}))}),config,now)
  expect(p.errors.join(' ')).toContain('selected draw')
 })
})

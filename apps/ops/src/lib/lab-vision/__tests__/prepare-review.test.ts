import {describe,it,expect,vi} from 'vitest'
vi.mock('@/lib/db',()=>({pgPool:()=>({})}))
import {anchorAlignment,movementReview,prepareReview} from '../prepare-review'
const rallyId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',matchId='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const source={matchId,players:[{id:'one',name:'Player'}],originalDocument:{setup:{firstServer:0},rallies:[{id:rallyId,start:{time:11813},touches:[{player:0,snapshot:{time:11815}}]}]}}
const setup:any={duration:3500,calibrationTime:60,offset:11762,scoutingAnchor:{rallyId,sourceTime:11813,videoTime:51}}
describe('review preparation',()=>{
 it('uses the point anchor independently of calibration time',()=>{expect(anchorAlignment(setup,source)?.offsetSeconds).toBe(11762);expect(anchorAlignment({...setup,calibrationTime:120},source)).toEqual(anchorAlignment(setup,source))})
 it('does not invent alignment for legacy setups',()=>expect(anchorAlignment({} as any,source)).toBeNull())
 it('rejects stale scouting and mismatched offsets',()=>{expect(()=>anchorAlignment({...setup,offset:0},source)).toThrow();expect(()=>anchorAlignment(setup,{originalDocument:{rallies:[]}})).toThrow()})
 it('supports negative offsets for pre-roll',()=>expect(anchorAlignment({...setup,offset:-51,scoutingAnchor:{rallyId,sourceTime:0,videoTime:51}},{originalDocument:{rallies:[{id:rallyId,start:{time:0}}]}})?.offsetSeconds).toBe(-51))
 it('retains gaps and inference as review information',()=>{const r=movementReview({start:10,end:110,players:[{key:'p0'}],performance:{p0:{observed_s:60,inferred_s:4,distance_m:80}}});expect(r.players[0].observedShare).toBe(.6);expect(r.players[0].inferredSeconds).toBe(4);expect(r.identity).toBe('requires_human_review')})
 it('prepares scout proposals without changing human annotations',async()=>{
  const query=vi.fn(async(sql:string)=>({rows:sql.includes('select match_id')?[{match_id:matchId,match_kind:'canonical'}]:sql.includes('select document')?[{document:source.originalDocument,players:source.players}]:[]}));
  const r=await prepareReview({id:'job',video_id:'video',owner_user_id:'owner',setup},null,{query});expect(r.status).toBe('ready');expect(r.proposalCount).toBe(2);
  const writes=query.mock.calls.map(c=>c[0]).filter(s=>s.startsWith('insert'));expect(writes).toHaveLength(2);expect(writes.every(s=>s.includes('do nothing'))).toBe(true);expect(writes.some(s=>s.includes('into lab_vision_annotations('))).toBe(false)
 })
})

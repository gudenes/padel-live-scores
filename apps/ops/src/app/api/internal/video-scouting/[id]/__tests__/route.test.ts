import {beforeEach,it,expect,vi} from 'vitest'
const mock=vi.hoisted(()=>({auth:vi.fn(),from:vi.fn(),writes:vi.fn(),eq:vi.fn(),queue:[] as unknown[]}))
vi.mock('@/lib/auth',()=>({auth:mock.auth}))
vi.mock('@/lib/supabase',()=>({serviceClient:()=>({from:mock.from})}))
import {GET,POST} from '../route'
const id='11111111-1111-4111-8111-111111111111',writeId='22222222-2222-4222-8222-222222222222',ctx={params:Promise.resolve({id})}
const document={version:1,label:'Test',setup:{names:['A1','A2','B1','B2'],firstServer:0,otherServer:2,rule:'star-point'},rallies:[],cancelled:[],pending:null}
const players=['A1','A2','B1','B2'].map((name,id)=>({name,id:String(id)}))
const request=(doc:unknown=document,revision=0,origin='https://admin.test')=>new Request('https://admin.test/api/internal/video-scouting/'+id,{method:'POST',headers:{origin,host:'admin.test','content-type':'application/json'},body:JSON.stringify({document:doc,revision,writeId,score:{currentGame:{a:40,b:0}}})})
beforeEach(()=>{vi.clearAllMocks();mock.queue=[];mock.auth.mockResolvedValue({user:{isOperator:true,email:'operator@test'}});mock.from.mockImplementation(()=>{const result=mock.queue.shift();const q:any={};for(const key of ['select','in'])q[key]=()=>q;q.eq=(...a:unknown[])=>{mock.eq(...a);return q};q.update=q.insert=(row:unknown)=>{mock.writes(row);return q};q.maybeSingle=q.single=async()=>result;q.then=(resolve:(x:unknown)=>void)=>Promise.resolve(result).then(resolve);return q})})
it('requires an operator and same-origin writes',async()=>{mock.auth.mockResolvedValue(null);expect((await GET(request(),ctx)).status).toBe(401);expect((await POST(request(),ctx)).status).toBe(401);mock.auth.mockResolvedValue({user:{isOperator:true}});expect((await POST(request(document,0,'https://other.test'),ctx)).status).toBe(403);expect(mock.from).not.toHaveBeenCalled()})
it('validates sessions before storage',async()=>{expect((await POST(request({...document,setup:{...document.setup,firstServer:99}}),ctx)).status).toBe(400);expect(mock.from).not.toHaveBeenCalled()})
it('creates a scouting record with a server-calculated score and confirmed roster',async()=>{mock.queue.push({data:null},{data:{id,pair1_player1_id:'0',pair1_player2_id:'1',pair2_player1_id:'2',pair2_player2_id:'3'}},{data:players},{data:{revision:1}});const result=await POST(request(),ctx);expect(result.status).toBe(200);expect(mock.writes).toHaveBeenCalledWith(expect.objectContaining({match_id:id,players,revision:1,write_id:writeId,score:expect.objectContaining({currentGame:{a:0,b:0}})}));expect(mock.from.mock.calls.map(([table])=>table)).not.toContain('sets')})
it('retries an acknowledged write without incrementing revision or duplicating points',async()=>{mock.queue.push({data:{document,revision:1,write_id:writeId,score:{currentGame:{a:0,b:0}},updated_at:'now'}});const result=await POST(request(),ctx);expect(result.status).toBe(200);expect((await result.json()).revision).toBe(1);expect(mock.writes).not.toHaveBeenCalled()})
it('rejects a reused write identifier with different data',async()=>{mock.queue.push({data:{document,revision:1,write_id:writeId}});expect((await POST(request({...document,label:'Changed'}),ctx)).status).toBe(409);expect(mock.writes).not.toHaveBeenCalled()})
it('rejects a stale revision without writing',async()=>{mock.queue.push({data:{document,revision:2,write_id:'other'}});expect((await POST(request(),ctx)).status).toBe(409);expect(mock.writes).not.toHaveBeenCalled()})
it('uses atomic revision checks and reports concurrent writes',async()=>{mock.queue.push({data:{document,players,revision:1,write_id:'other'}},{data:null,error:null});expect((await POST(request(document,1),ctx)).status).toBe(409);expect(mock.eq).toHaveBeenCalledWith('revision',1)})
it('loads the durable score, stats and video document',async()=>{const session={document,revision:2,score:{currentGame:{a:15,b:0}},stats:[],players};mock.queue.push({data:session});const result=await GET(request(),ctx);expect(result.status).toBe(200);expect((await result.json()).session).toEqual(session)})
it('returns unavailable for storage errors',async()=>{mock.queue.push({error:{message:'relation missing'}});expect((await POST(request(),ctx)).status).toBe(503)})

it('stores the calculated game score and updated player stats after scoring and undo',async()=>{
 const snap=(time:number)=>({tabId:7,documentId:'d',videoId:'v',mediaId:'m',time,at:'2026-10-06T12:00:00Z',readyState:4,seekEpoch:0,paused:false})
 const rallies=Array.from({length:4},(_,i)=>({id:'r'+i,label:'Test',start:snap(i*10),end:snap(i*10+5),point:{player:0,outcome:'winner',shot:'smash'}}))
 for(const undone of [false,true]){
  const log=rallies.map((r,i)=>({...r,...(undone&&i===3?{undone:true,undoneAt:'2026-10-06T12:01:00Z'}:{})}))
  mock.queue.push({data:{document,players,revision:1,write_id:'other'}},{data:{revision:2}})
  const result=await POST(request({...document,rallies:log},1),ctx);expect(result.status).toBe(200)
  const row=mock.writes.mock.calls.at(-1)![0]
  expect(row.score.sets[0].a).toBe(undone?0:1)
  expect(row.score.currentGame.a).toBe(undone?40:0)
  expect(row.stats[0].winners).toBe(undone?3:4)
 }
})

it('advertises typed smash support and saves subtype and X4 stats without double counting',async()=>{
 mock.queue.push({data:null});expect((await (await GET(request(),ctx)).json()).features).toEqual(['smash-types-v1','var-review-v1','rally-touches-v1','point-tags-v2','soft-smash-v1'])
 const snap=(time:number)=>({tabId:7,documentId:'d',videoId:'v',mediaId:'m',time,at:'2026-10-06T12:00:00Z',readyState:4,seekEpoch:0,paused:false})
 const log={...document,rallies:[{id:'r',varReviewed:true,start:snap(10),end:snap(20),attempts:[{player:0,smashType:'power',snapshot:snap(15)}],point:{player:0,outcome:'winner',shot:'smash',smashType:'power',x4:true,smashAlreadyCounted:true,smashAttemptIndex:0}}]}
 mock.queue.push({data:{document,players,revision:1,write_id:'other'}},{data:{revision:2}})
 expect((await POST(request(log,1),ctx)).status).toBe(200)
 const row=mock.writes.mock.calls.at(-1)![0];expect(row.document.rallies[0].varReviewed).toBe(true);expect(row.document.rallies[0].point.x4).toBe(true);expect(row.stats[0]).toMatchObject({smashes:1,powerSmashes:1,x3Smashes:0,x4Winners:1})
})

it('preserves rally shot sequences on save and rejects invalid court orders',async()=>{
 const snap=(time:number)=>({tabId:7,documentId:'d',videoId:'v',mediaId:'m',time,at:'2026-10-06T12:00:00Z',readyState:4,seekEpoch:0,paused:false});
 const touches=[{player:0,order:[2,3,0,1],snapshot:snap(11)},{player:2,order:[2,3,0,1],snapshot:snap(12)}];
 const log={...document,rallies:[{id:'r',start:snap(10),end:snap(20),touches,point:{player:0,outcome:'winner',shot:'volley'}}]};
 mock.queue.push({data:{document,players,revision:1,write_id:'other'}},{data:{revision:2}});
 expect((await POST(request(log,1),ctx)).status).toBe(200);expect(mock.writes.mock.calls.at(-1)![0].document.rallies[0].touches).toMatchObject(touches);
 const invalid={...log,rallies:[{...log.rallies[0],touches:[{...touches[0],order:[0,0,1,2]}]}]};
 expect((await POST(request(invalid,2),ctx)).status).toBe(400);
});
it('stores soft smash shot links and computes one attempt and one soft winner',async()=>{
 const snap=(time:number)=>({tabId:7,documentId:'d',videoId:'v',mediaId:'m',time,at:'2026-10-07T12:00:00Z',readyState:4,seekEpoch:0,paused:false});
 const log={...document,rallies:[{id:'r',start:snap(10),end:snap(20),touches:[{player:0,order:[2,3,0,1],snapshot:snap(15)}],attempts:[{player:0,smashType:'soft',touchIndex:0,snapshot:snap(15)}],point:{player:0,outcome:'winner',shot:'smash',smashType:'soft',smashAlreadyCounted:true,smashAttemptIndex:0}}]};
 mock.queue.push({data:{document,players,revision:1,write_id:'other'}},{data:{revision:2}});
 expect((await POST(request(log,1),ctx)).status).toBe(200);
 const row=mock.writes.mock.calls.at(-1)![0];expect(row.stats[0]).toMatchObject({smashes:1,softSmashes:1,softSmashWinners:1,powerSmashes:0});expect(row.document.rallies[0].attempts[0].touchIndex).toBe(0);
});

it('accepts extension writes only with a matching operator session and signed origin proof',async()=>{
 vi.stubEnv('AUTH_SECRET','extension-test-secret')
 try{
  const {issueScoutingProof}=await import('@/lib/scouting-extension-auth')
  const origin='chrome-extension://'+'a'.repeat(32)
  mock.auth.mockResolvedValue({user:{id:'operator',isOperator:true,email:'operator@test'}})
  const {token}=issueScoutingProof('operator',origin)
  const req=request(document,0,origin);req.headers.set('x-scouting-authorization',token)
  mock.queue.push({data:null},{data:{id,pair1_player1_id:'0',pair1_player2_id:'1',pair2_player1_id:'2',pair2_player2_id:'3'}},{data:players},{data:{revision:1}})
  expect((await POST(req,ctx)).status).toBe(200)
  expect((await POST(request(document,0,origin),ctx)).status).toBe(403)
  const wrong=request(document,0,origin);wrong.headers.set('x-scouting-authorization',issueScoutingProof('other-operator',origin).token)
  expect((await POST(wrong,ctx)).status).toBe(403)
  mock.auth.mockResolvedValue(null)
  expect((await POST(req,ctx)).status).toBe(401)
 }finally{vi.unstubAllEnvs()}
})

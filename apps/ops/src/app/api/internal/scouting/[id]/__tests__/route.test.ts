import {beforeEach,it,expect,vi} from 'vitest'
const mock=vi.hoisted(()=>({auth:vi.fn(),from:vi.fn(),writes:vi.fn(),eq:vi.fn(),queue:[] as unknown[]}))
vi.mock('@/lib/auth',()=>({auth:mock.auth}))
vi.mock('@/lib/supabase',()=>({serviceClient:()=>({from:mock.from})}))
import {GET,POST} from '../route'
import {freshDoc} from '@/lib/scouting/model'
const id='11111111-1111-4111-8111-111111111111',ctx={params:Promise.resolve({id})}
const players=[0,1,2,3].map(i=>({id:String(i),name:`Player ${i}`})),doc=freshDoc()
const request=(document:unknown=doc,revision=1,origin='https://admin.test')=>new Request('https://admin.test/api/internal/scouting/'+id,{method:'POST',headers:{origin,host:'admin.test','content-type':'application/json'},body:JSON.stringify({document,revision})})
const start={kind:'rally_start' as const,id:'event1',at:'2026-10-04T12:00:00Z'}
beforeEach(()=>{vi.clearAllMocks();mock.queue=[];mock.auth.mockResolvedValue({user:{isOperator:true,email:'operator@test'}});mock.from.mockImplementation(()=>{const result=mock.queue.shift();const q:any={};for(const key of ['select','in'])q[key]=()=>q;q.eq=(...a:unknown[])=>{mock.eq(...a);return q};q.update=q.insert=(row:unknown)=>{mock.writes(row);return q};q.maybeSingle=q.single=async()=>result;q.then=(resolve:(x:unknown)=>void)=>Promise.resolve(result).then(resolve);return q})})
it('requires an operator for reads and writes',async()=>{mock.auth.mockResolvedValue({user:{isOperator:false}});expect((await GET(request(),ctx)).status).toBe(401);expect((await POST(request(),ctx)).status).toBe(401);expect(mock.from).not.toHaveBeenCalled()})
it('rejects cross-origin requests and invalid documents before reading storage',async()=>{expect((await POST(request(doc,1,'https://evil.test'),ctx)).status).toBe(403);expect((await POST(request({...doc,events:[{...start,kind:'double_fault'}]}),ctx)).status).toBe(400);expect(mock.from).not.toHaveBeenCalled()})
it('loads a saved session with its captured roster',async()=>{mock.queue.push({data:{revision:2,document:doc,players}});const r=await GET(request(),ctx);expect(r.status).toBe(200);expect((await r.json()).players).toEqual(players)})
it('appends events and uses the expected revision for atomic updates',async()=>{mock.queue.push({data:{revision:1,document:doc,players}},{data:{revision:2}});const r=await POST(request({...doc,events:[start]}),ctx);expect(r.status).toBe(200);expect(mock.eq).toHaveBeenCalledWith('revision',1);expect(mock.writes).toHaveBeenCalledWith(expect.objectContaining({revision:2,players,document:{...doc,events:[start]}}))})
it('rejects stale revisions without writing',async()=>{mock.queue.push({data:{revision:2,document:doc,players}});expect((await POST(request(),ctx)).status).toBe(409);expect(mock.writes).not.toHaveBeenCalled()})
it('rejects history replacement; correction must append an undo',async()=>{mock.queue.push({data:{revision:1,document:{...doc,events:[start]},players}});expect((await POST(request(),ctx)).status).toBe(400);expect(mock.writes).not.toHaveBeenCalled()})
it('returns conflict if another operator wins the atomic update',async()=>{mock.queue.push({data:{revision:1,document:doc,players}},{data:null,error:null});expect((await POST(request({...doc,events:[start]}),ctx)).status).toBe(409)})
it('creates an isolated session with four confirmed players',async()=>{mock.queue.push({data:null},{data:{id,pair1_player1_id:'0',pair1_player2_id:'1',pair2_player1_id:'2',pair2_player2_id:'3'}},{data:players},{data:{revision:1}});const r=await POST(request(doc,0),ctx);expect(r.status).toBe(200);expect(mock.writes).toHaveBeenCalledWith(expect.objectContaining({match_id:id,revision:1,players}));expect(mock.from.mock.calls.filter(([t])=>t==='matches')).toHaveLength(1)})
it('persists arrival preparation then appends server confirmation without replacing history',async()=>{
 const arrivals=[{kind:'pair_arrived',team:'a',id:'a',at:start.at},{kind:'pair_arrived',team:'b',id:'b',at:start.at}]
 const prior={...doc,preparation:true,events:arrivals}
 const next={...prior,events:[...arrivals,{kind:'court_setup',id:'setup',at:start.at,settings:{rule:'advantage',firstServer:3,otherServer:1,near:'b'}}]}
 mock.queue.push({data:{revision:2,document:prior,players}},{data:{revision:3}})
 expect((await POST(request(next,2),ctx)).status).toBe(200)
 expect(mock.writes).toHaveBeenCalledWith(expect.objectContaining({document:next,revision:3}))
})
// Match PostgreSQL JSONB's reordered keys, including nested score fields.
const reorder=(value:unknown):any=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>b.localeCompare(a)).map(([k,v])=>[k,reorder(v)])):value
it('accepts successive appends against JSONB-reordered session records',async()=>{
 const first={...doc,events:[start]}
 mock.queue.push({data:{revision:1,document:reorder(doc),players}},{data:{revision:2}})
 expect((await POST(request(first,1),ctx)).status).toBe(200)
 const second={...first,events:[...first.events,{kind:'first_fault',id:'fault',at:'2026-10-04T12:00:02Z'}]}
 mock.queue.push({data:{revision:2,document:reorder(first),players}},{data:{revision:3}})
 expect((await POST(request(second,2),ctx)).status).toBe(200)
 expect(mock.writes).toHaveBeenLastCalledWith(expect.objectContaining({document:second,revision:3}))
})
it('still rejects edits to existing events or settings when keys are reordered',async()=>{
 for(const changed of [{...doc,rule:'advantage',events:[start]},{...doc,events:[{...start,at:'2026-10-04T12:00:03Z'}]}]){
  mock.queue.push({data:{revision:1,document:reorder({...doc,events:[start]}),players}})
  expect((await POST(request(changed,1),ctx)).status).toBe(400)
 }
 expect(mock.writes).not.toHaveBeenCalled()
})

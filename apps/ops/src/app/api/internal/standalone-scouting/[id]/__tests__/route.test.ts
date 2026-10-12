import {beforeEach,expect,it,vi} from 'vitest'
const mock=vi.hoisted(()=>({auth:vi.fn(),from:vi.fn(),queue:[] as unknown[]}))
vi.mock('@/lib/auth',()=>({auth:mock.auth}))
vi.mock('@/lib/supabase',()=>({serviceClient:()=>({from:mock.from})}))
import {GET} from '../route'
const id='11111111-1111-4111-8111-111111111111'
const ctx={params:Promise.resolve({id})},req=new Request('https://admin.test/api/internal/standalone-scouting/'+id)
const match={id,tournament_id:'t',pair1_player1_id:'a',pair1_player2_id:'b',pair2_player1_id:'c',pair2_player2_id:'d'}
const players=['d','b','c','a'].map(id=>({id,name:id.toUpperCase(),side:'left'}))
function data(session:unknown=null){mock.queue.push({data:match},{data:players},{data:{name:'Tournament'}},{data:session})}
beforeEach(()=>{
 vi.clearAllMocks();mock.queue=[];mock.auth.mockResolvedValue({user:{id:'scouter',isScouter:true}})
 mock.from.mockImplementation(()=>{const result=mock.queue.shift();const q:any={};for(const key of ['select','eq','in'])q[key]=()=>q;q.maybeSingle=async()=>result;q.then=(resolve:(x:unknown)=>void)=>Promise.resolve(result).then(resolve);return q})
})
it('requires scouting permissions before querying data',async()=>{
 for(const user of [null,{id:'viewer',isViewer:true},{id:'revoked'}]){mock.auth.mockResolvedValue({user});expect((await GET(req,ctx)).status).toBe(401)}
 expect(mock.from).not.toHaveBeenCalled()
})
it('loads the canonical four-player order, not database return order',async()=>{
 data();const response=await GET(req,ctx);expect(response.status).toBe(200)
 expect((await response.json()).match).toMatchObject({names:['A','B','C','D'],playerIds:['a','b','c','d'],tournamentName:'Tournament'})
})
it('resumes assigned standalone sessions and denies another scouter',async()=>{
 data({revision:3,document:{captureMode:'standalone'},assigned_scouter_user_id:'scouter'})
 expect((await (await GET(req,ctx)).json()).session.revision).toBe(3)
 data({document:{captureMode:'standalone'},assigned_scouter_user_id:'other'})
 expect((await GET(req,ctx)).status).toBe(403)
})
it('protects existing extension sessions, including when opened by an operator',async()=>{
 mock.auth.mockResolvedValue({user:{id:'operator',isOperator:true}});data({document:{version:1}})
 expect((await GET(req,ctx)).status).toBe(409)
})
it('requires a valid match and four confirmed players',async()=>{
 expect((await GET(req,{params:Promise.resolve({id:'bad'})})).status).toBe(400)
 mock.queue.push({data:null});expect((await GET(req,ctx)).status).toBe(404)
 mock.queue.push({data:{...match,pair2_player2_id:null}});expect((await GET(req,ctx)).status).toBe(422)
})

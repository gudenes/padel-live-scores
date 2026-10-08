import {beforeEach,expect,it,vi} from 'vitest'
const mock=vi.hoisted(()=>({auth:vi.fn(),from:vi.fn(),writes:vi.fn(),queue:[] as any[]}))
vi.mock('@/lib/auth',()=>({auth:mock.auth}))
vi.mock('@/lib/supabase',()=>({serviceClient:()=>({from:mock.from})}))
import {GET,POST} from '../route'
const id='00000000-0000-0000-0000-000000000010',ctx={params:Promise.resolve({id})},players=['A1','A2','B1','B2'].map((name,i)=>({id:'private-'+i,name}))
const document={version:1,label:'Private',setup:{names:players.map(p=>p.name),firstServer:0,otherServer:2,rule:'star-point'},rallies:[],cancelled:[],pending:null}
const req=(revision=0)=>new Request('https://admin.test/api/internal/manual-video-scouting/'+id,{method:'POST',headers:{origin:'https://admin.test',host:'admin.test'},body:JSON.stringify({document,revision,writeId:'00000000-0000-0000-0000-000000000001'})})
beforeEach(()=>{vi.clearAllMocks();mock.queue=[];mock.auth.mockResolvedValue({user:{isOperator:true,email:'operator@test'}});mock.from.mockImplementation((table:string)=>{const result=mock.queue.shift(),q:any={};for(const name of ['select','eq'])q[name]=()=>q;q.insert=q.update=(row:any)=>{mock.writes(table,row);return q};q.maybeSingle=q.single=async()=>result;return q})})
it('saves scores and private roster to private session storage only',async()=>{
 mock.queue.push({data:null},{data:{id,players}},{data:{revision:1}});expect((await POST(req(),ctx)).status).toBe(200);expect(mock.writes).toHaveBeenCalledWith('operator_manual_video_scouting_sessions',expect.objectContaining({match_id:id,players,revision:1,score:expect.any(Object),stats:expect.any(Array)}));expect(mock.from.mock.calls.map(([t])=>t)).not.toContain('matches');expect(mock.from.mock.calls.map(([t])=>t)).not.toContain('players')
})
it('loads the full report data with private match metadata',async()=>{
 mock.queue.push({data:{document,players,revision:2}},{data:{id,players,match_date:'2018-10-08'}});const data=await (await GET(req(),ctx)).json();expect(data.session.document).toEqual(document);expect(data.match.match_date).toBe('2018-10-08');expect(data.features).toContain('soft-smash-v1')
})
it('preserves concurrent work and requires operator access',async()=>{
 mock.queue.push({data:{revision:3}});expect((await POST(req(2),ctx)).status).toBe(409);expect(mock.writes).not.toHaveBeenCalled();mock.auth.mockResolvedValue(null);expect((await GET(req(),ctx)).status).toBe(401);expect((await POST(req(),ctx)).status).toBe(401)
})

import {beforeEach,expect,it,vi} from 'vitest'
const mock=vi.hoisted(()=>({auth:vi.fn(),from:vi.fn(),writes:vi.fn(),queue:[] as any[]}))
vi.mock('@/lib/auth',()=>({auth:mock.auth}))
vi.mock('@/lib/supabase',()=>({serviceClient:()=>({from:mock.from})}))
import {GET,POST} from '../route'
const id='00000000-0000-0000-0000-000000000010',input={id,players:['A1','A2','B1','B2'].map(name=>({name})),matchDate:'2018-10-08'}
const req=(body:unknown=input,origin='https://admin.test')=>new Request('https://admin.test/api/internal/manual-scouting-matches',{method:'POST',headers:{origin,host:'admin.test'},body:JSON.stringify(body)})
beforeEach(()=>{vi.clearAllMocks();mock.queue=[];mock.auth.mockResolvedValue({user:{id:'operator',email:'operator@test',isOperator:true}});mock.from.mockImplementation((table:string)=>{const result=mock.queue.shift(),q:any={};for(const name of ['select','eq','in','ilike','order','limit'])q[name]=()=>q;q.insert=(row:any)=>{mock.writes(table,row);return q};q.maybeSingle=q.single=async()=>result;q.then=(resolve:any)=>Promise.resolve(result).then(resolve);return q})})
it('operator and origin gates protect creation and read access',async()=>{
 mock.auth.mockResolvedValue(null);expect((await GET(req())).status).toBe(401);expect((await POST(req())).status).toBe(401);mock.auth.mockResolvedValue({user:{isOperator:true}});expect((await POST(req(input,'https://evil.test'))).status).toBe(403);expect(mock.from).not.toHaveBeenCalled()
})
it('rejects invalid names, dates, links and repeated players before touching storage',async()=>{
 for(const body of [{...input,players:[]},{...input,players:['A','A','B','C'].map(name=>({name}))},{...input,matchDate:'2018-02-30'},{...input,videoUrl:'javascript:alert(1)'}])expect((await POST(req(body))).status).toBe(400)
 expect(mock.from).not.toHaveBeenCalled()
})
it('creates new names only inside private scouting and safely acknowledges a creation retry',async()=>{
 mock.queue.push({data:null},{data:{id,players:input.players.map((p,i)=>({...p,id:'private-'+i})),created_at:'now'}})
 const created=await POST(req());expect(created.status).toBe(201);expect((await created.json()).match.kind).toBe('manual')
 const [table,row]=mock.writes.mock.calls[0];expect(table).toBe('operator_manual_scouting_matches');expect(row.players).toHaveLength(4);expect(row.players.every((p:any)=>p.existingPlayerId===null)).toBe(true);expect(mock.from.mock.calls.every(([t])=>t===table)).toBe(true)
 mock.queue.push({data:{...row,created_at:'now'}});expect((await POST(req())).status).toBe(200);expect(mock.writes).toHaveBeenCalledTimes(1)
 mock.queue.push({data:{...row,created_at:'now'}});expect((await POST(req({...input,players:['Other','A2','B1','B2'].map(name=>({name}))}))).status).toBe(409)
})
it('resolves an explicitly selected existing player without creating any public record',async()=>{
 const playerId='00000000-0000-0000-0000-000000000001';mock.queue.push({data:null},{data:[{id:playerId,name:'Actual name',country:'ES',ranking:12}]},{data:{id,players:input.players}})
 expect((await POST(req({...input,players:[{name:'Typed name',id:playerId},...input.players.slice(1)]}))).status).toBe(201)
 const row=mock.writes.mock.calls[0][1];expect(row.players[0]).toMatchObject({id:playerId,name:'Actual name',existingPlayerId:playerId});expect(mock.writes.mock.calls.every(([table])=>table==='operator_manual_scouting_matches')).toBe(true)
})
it('lists private matches and returns player suggestions through authenticated reads',async()=>{
 mock.queue.push({data:[{id,players:input.players.map((p,i)=>({...p,id:'p'+i})),tournament_label:'Historical',match_date:'2018-10-08'}]});expect((await (await GET(new Request('https://admin.test/api/internal/manual-scouting-matches'))).json()).matches[0].kind).toBe('manual')
 mock.queue.push({data:[{id:'known',name:'Known player'}]});expect((await (await GET(new Request('https://admin.test/api/internal/manual-scouting-matches?players=Known'))).json()).players).toHaveLength(1)
})
it('allows the authenticated extension proof but rejects a proof bound to another operator',async()=>{
 vi.stubEnv('AUTH_SECRET','private-scouting-test-secret')
 try{
  const {issueScoutingProof}=await import('@/lib/scouting-extension-auth'),origin='chrome-extension://'+'a'.repeat(32)
  const request=req(input,origin);request.headers.set('x-scouting-authorization',issueScoutingProof('other',origin).token)
  expect((await POST(request)).status).toBe(403);expect(mock.from).not.toHaveBeenCalled()
  request.headers.set('x-scouting-authorization',issueScoutingProof('operator',origin).token)
  mock.queue.push({data:null},{data:{id,players:input.players.map((p,i)=>({...p,id:'private-'+i}))}})
  expect((await POST(request)).status).toBe(201)
 }finally{vi.unstubAllEnvs()}
})

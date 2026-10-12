import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const mock=vi.hoisted(()=>({auth:vi.fn(),query:vi.fn(),release:vi.fn(),welcome:vi.fn()}))
vi.mock('@/lib/auth',()=>({auth:mock.auth}))
vi.mock('@/lib/email/team-welcome',()=>({sendTeamWelcomeEmail:mock.welcome}))
vi.mock('@/lib/db',()=>({pgPool:()=>({query:mock.query,connect:async()=>({query:mock.query,release:mock.release})})}))
import {GET,POST} from '@/app/api/internal/team-access/route'
import {POST as assign} from '@/app/api/internal/scouting-assignment/route'
const request=(body:unknown,origin='https://admin.test')=>new Request('https://admin.test/api/internal/team-access',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)})
beforeEach(()=>{vi.clearAllMocks();mock.welcome.mockResolvedValue(undefined);mock.auth.mockResolvedValue({user:{id:'admin',isOperator:true}});mock.query.mockImplementation(async(sql:string)=>({rowCount:sql.includes('where user_id=$1 union')?1:0,rows:[]}))})
it('refuses access management and reassignment from scoped and unauthenticated users',async()=>{
 for(const user of [null,{id:'scout',isScouter:true}]){
  mock.auth.mockResolvedValue(user?{user}:null)
  expect((await GET()).status).toBe(user?403:401)
  expect((await POST(request({email:'a@test.com',status:'active'}))).status).toBe(user?403:401)
  expect((await assign(request({}))).status).toBe(user?403:401)
 }
 expect(mock.query).not.toHaveBeenCalled()
})
it('rejects forged origins and invalid roles',async()=>{
 expect((await POST(request({email:'a@test.com',status:'active'},'https://evil.test'))).status).toBe(403)
 expect((await POST(request({email:'a@test.com',status:'active',role:'owner'}))).status).toBe(400)
 expect(mock.query).not.toHaveBeenCalled()
})
it('preserves existing administrators and never edits their allow-list',async()=>{
 mock.query.mockImplementation(async(sql:string)=>({rowCount:sql.includes('where user_id=$1 union')||sql.includes('join public.users')?1:0,rows:[]}))
 expect((await POST(request({email:'owner@test.com',status:'suspended'}))).status).toBe(409)
 expect(mock.query.mock.calls.some(([sql])=>/delete|update public.operators/i.test(sql))).toBe(false)
})
it('normalizes a pending grant and audits it in the same transaction',async()=>{
 expect((await POST(request({email:' New@Example.com ',status:'active'}))).status).toBe(200)
 expect(mock.query).toHaveBeenCalledWith(expect.stringContaining('insert into public.scouting_staff_grants'),['new@example.com','active','admin','scouter'])
 expect(mock.query).toHaveBeenCalledWith(expect.stringContaining('insert into public.scouting_access_audit'),expect.any(Array))
 expect(mock.query).toHaveBeenLastCalledWith('commit')
 expect(mock.release).toHaveBeenCalledOnce()
})
it('rolls back a failed grant without sending an invitation',async()=>{
 mock.query.mockResolvedValueOnce({}).mockResolvedValueOnce({rowCount:0}).mockRejectedValueOnce(Error('storage'))
 expect((await POST(request({email:'a@test.com',status:'active'}))).status).toBe(503)
 expect(mock.query).toHaveBeenLastCalledWith('rollback')
 expect(mock.release).toHaveBeenCalledOnce()
})

it.each(['viewer','scouter','admin'])('accepts the selected %s access level',async role=>{
 expect((await POST(request({email:'a@test.com',status:'active',role}))).status).toBe(200)
 expect(mock.query).toHaveBeenCalledWith(expect.stringContaining('insert into public.scouting_staff_grants'),['a@test.com','active','admin',role])
})
it('rejects an administrator revoked while waiting for the access lock',async()=>{
 mock.query.mockResolvedValue({rowCount:0,rows:[]})
 expect((await POST(request({email:'a@test.com',status:'active'}))).status).toBe(403)
 expect(mock.query).toHaveBeenCalledWith('select pg_advisory_xact_lock(728491031)')
 expect(mock.query).toHaveBeenLastCalledWith('rollback')
})
it.each([{role:'viewer',status:'active'},{role:'admin',status:'suspended'}])('protects the last active administrator: %o',async change=>{
 mock.query.mockImplementation(async(sql:string)=>{
  if(sql.includes('where user_id=$1 union'))return {rowCount:1,rows:[{}]}
  if(sql.includes('for update'))return {rowCount:1,rows:[{role:'admin',status:'active',user_id:'last'}]}
  return {rowCount:0,rows:[]}
 })
 expect((await POST(request({email:'a@test.com',...change}))).status).toBe(409)
 expect(mock.query).toHaveBeenLastCalledWith('rollback')
})

afterEach(()=>vi.unstubAllEnvs())
it('accepts the public admin origin behind the production proxy without changing access',async()=>{
 vi.stubEnv('NODE_ENV','production')
 for(const endpoint of [POST,assign]){
  const req=new Request('http://localhost:8080/api/internal/action',{method:'POST',headers:{origin:'https://admin.padelnachos.com','Content-Type':'application/json'},body:'{}'})
  expect((await endpoint(req)).status).toBe(400)
 }
 expect(mock.query).not.toHaveBeenCalled()
})
it.each([undefined,'null','https://evil.test','http://admin.padelnachos.com','https://admin.padelnachos.com.evil.test'])('blocks untrusted production origin %s even with spoofed forwarding headers',async origin=>{
 vi.stubEnv('NODE_ENV','production')
 for(const endpoint of [POST,assign]){
  const headers:Record<string,string>={'Content-Type':'application/json','x-forwarded-host':'admin.padelnachos.com','x-forwarded-proto':'https'}
  if(origin)headers.origin=origin
  const req=new Request('http://localhost:8080/api/internal/action',{method:'POST',headers,body:'{}'})
  expect((await endpoint(req)).status).toBe(403)
 }
 expect(mock.query).not.toHaveBeenCalled()
})

it('sends a role-specific welcome only after committing a new active grant',async()=>{
 mock.welcome.mockImplementation(async()=>{expect(mock.query).toHaveBeenLastCalledWith('commit')})
 const response=await POST(request({email:' New@Example.com ',status:'active',role:'viewer'}))
 expect(await response.json()).toMatchObject({ok:true,welcomeEmail:'sent'})
 expect(mock.welcome).toHaveBeenCalledExactlyOnceWith({to:'new@example.com',role:'viewer'})
})
it('does not send welcomes on active role changes or suspension',async()=>{
 mock.query.mockImplementation(async(sql:string)=>({rowCount:sql.includes('where user_id=$1 union')?1:0,rows:sql.includes('for update')?[{role:'scouter',status:'active',user_id:'person'}]:[]}))
 for(const change of [{role:'viewer',status:'active'},{role:'scouter',status:'suspended'}]){
  expect((await POST(request({email:'person@example.com',...change}))).status).toBe(200)
 }
 expect(mock.welcome).not.toHaveBeenCalled()
})
it('reports email failure without rolling back a committed grant',async()=>{
 mock.welcome.mockRejectedValue(Error('provider'))
 const response=await POST(request({email:'person@example.com',status:'active',role:'scouter'}))
 expect(response.status).toBe(200)
 expect(await response.json()).toMatchObject({ok:true,welcomeEmail:'failed'})
 expect(mock.query).toHaveBeenLastCalledWith('commit')
})
it('never sends a welcome for rejected access requests',async()=>{
 expect((await POST(request({email:'a@test.com',status:'active'},'https://evil.test'))).status).toBe(403)
 expect(mock.welcome).not.toHaveBeenCalled()
})

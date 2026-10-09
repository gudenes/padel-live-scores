import {beforeEach,expect,it,vi} from 'vitest'
const mock=vi.hoisted(()=>({auth:vi.fn(),query:vi.fn(),release:vi.fn()}))
vi.mock('@/lib/auth',()=>({auth:mock.auth}))
vi.mock('@/lib/db',()=>({pgPool:()=>({query:mock.query,connect:async()=>({query:mock.query,release:mock.release})})}))
import {GET,POST} from '@/app/api/internal/team-access/route'
import {POST as assign} from '@/app/api/internal/scouting-assignment/route'
const request=(body:unknown,origin='https://admin.test')=>new Request('https://admin.test/api/internal/team-access',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)})
beforeEach(()=>{vi.clearAllMocks();mock.auth.mockResolvedValue({user:{id:'admin',isOperator:true}});mock.query.mockImplementation(async(sql:string)=>({rowCount:sql.includes('where user_id=$1 union')?1:0,rows:[]}))})
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

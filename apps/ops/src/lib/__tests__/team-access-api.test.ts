import {beforeEach,expect,it,vi} from 'vitest'
const mock=vi.hoisted(()=>({auth:vi.fn(),query:vi.fn(),release:vi.fn()}))
vi.mock('@/lib/auth',()=>({auth:mock.auth}))
vi.mock('@/lib/db',()=>({pgPool:()=>({query:mock.query,connect:async()=>({query:mock.query,release:mock.release})})}))
import {GET,POST} from '@/app/api/internal/team-access/route'
import {POST as assign} from '@/app/api/internal/scouting-assignment/route'
const request=(body:unknown,origin='https://admin.test')=>new Request('https://admin.test/api/internal/team-access',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)})
beforeEach(()=>{vi.clearAllMocks();mock.auth.mockResolvedValue({user:{id:'admin',isOperator:true}});mock.query.mockResolvedValue({rowCount:0,rows:[]})})
it('refuses access management and reassignment from scoped and unauthenticated users',async()=>{
 for(const user of [null,{id:'scout',isScouter:true}]){
  mock.auth.mockResolvedValue(user?{user}:null)
  expect((await GET()).status).toBe(user?403:401)
  expect((await POST(request({email:'a@test.com',status:'active'}))).status).toBe(user?403:401)
  expect((await assign(request({}))).status).toBe(user?403:401)
 }
 expect(mock.query).not.toHaveBeenCalled()
})
it('rejects forged origins and attempts to grant administrator privileges',async()=>{
 expect((await POST(request({email:'a@test.com',status:'active'},'https://evil.test'))).status).toBe(403)
 expect((await POST(request({email:'a@test.com',status:'active',role:'admin'}))).status).toBe(400)
 expect(mock.query).not.toHaveBeenCalled()
})
it('preserves existing administrators and never edits their allow-list',async()=>{
 mock.query.mockResolvedValueOnce({}).mockResolvedValueOnce({rowCount:1,rows:[{}]})
 expect((await POST(request({email:'owner@test.com',status:'suspended'}))).status).toBe(409)
 expect(mock.query.mock.calls.some(([sql])=>/delete|update public.operators/i.test(sql))).toBe(false)
})
it('normalizes a pending grant and audits it in the same transaction',async()=>{
 expect((await POST(request({email:' New@Example.com ',status:'active'}))).status).toBe(200)
 expect(mock.query).toHaveBeenCalledWith(expect.stringContaining('insert into public.scouting_staff_grants'),['new@example.com','active','admin'])
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

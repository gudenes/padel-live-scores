import {beforeEach,describe,it,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),from:vi.fn()}))
vi.mock('@/lib/auth',()=>({auth:mocks.auth}))
vi.mock('@/lib/supabase',()=>({serviceClient:()=>({rpc:mocks.rpc,from:mocks.from})}))
import {POST,sameOrigin} from '../route'
const request=(body:unknown,origin='https://ops.example.test')=>new Request('https://ops.example.test/api/internal/play-editorial',{method:'POST',headers:{origin,host:'ops.example.test','content-type':'application/json'},body:JSON.stringify(body)})
beforeEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();mocks.auth.mockResolvedValue({user:{isOperator:true,email:'operator@example.test'}})})
describe('editorial operator boundary',()=>{
 it('denies unauthenticated users before accessing data',async()=>{mocks.auth.mockResolvedValue(null);expect((await POST(request({action:'save'}))).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('rejects cross-origin and cross-scheme requests',async()=>{expect((await POST(request({},'https://evil.example'))).status).toBe(403);expect(sameOrigin(request({},'http://ops.example.test'))).toBe(false)})
 it('rejects unknown authoring fields before writing',async()=>{expect((await POST(request({action:'save',config:{resolver_key:'arbitrary'}}))).status).toBe(409);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('rejects stale revision shapes and unknown actions',async()=>{expect((await POST(request({id:'11111111-1111-1111-1111-111111111111',action:'publish'}))).status).toBe(400);expect((await POST(request({action:'rawSql'}))).status).toBe(400)})
 it('blocks publication before the settlement worker rollout',async()=>{
   vi.stubEnv('PLAY_EDITORIAL_PUBLISH_ENABLED','false')
   const query={select:vi.fn(),eq:vi.fn(),single:vi.fn().mockResolvedValue({data:{status:'draft',revision:1}})}
   query.select.mockReturnValue(query);query.eq.mockReturnValue(query);mocks.from.mockReturnValue(query)
   const response=await POST(request({id:'11111111-1111-1111-1111-111111111111',revision:1,action:'publish'}))
   expect(response.status).toBe(503);expect(mocks.rpc).not.toHaveBeenCalled()
 })

})

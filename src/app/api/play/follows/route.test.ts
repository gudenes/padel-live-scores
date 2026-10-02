import {beforeEach,expect,it,vi} from 'vitest'
const {access,table,query}=vi.hoisted(()=>{
 const query:any={select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn(),upsert:vi.fn(),delete:vi.fn()}
 return {access:vi.fn(),table:vi.fn(),query}
})
vi.mock('@/lib/play-access',()=>({requirePlayAccess:access}))
import {POST} from './route'
const me='11111111-1111-1111-1111-111111111111',target='22222222-2222-2222-2222-222222222222'
beforeEach(()=>{
 vi.clearAllMocks();table.mockReturnValue(query)
 query.select.mockReturnValue(query);query.eq.mockReturnValue(query);query.delete.mockReturnValue(query)
 query.maybeSingle.mockResolvedValue({data:{user_id:target},error:null});query.upsert.mockResolvedValue({error:null})
 access.mockResolvedValue({userId:me,supabase:{from:table}})
})
const request=(userId=target,origin='http://localhost:3012')=>new Request('http://localhost:3012/api/play/follows',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({userId,follow:true})})
it('requires play access and rejects self follows and cross-origin writes',async()=>{
 access.mockResolvedValueOnce(null);expect((await POST(request())).status).toBe(404)
 expect((await POST(request(me))).status).toBe(400)
 expect((await POST(request(target,'https://other.example'))).status).toBe(403)
 expect(query.upsert).not.toHaveBeenCalled()
})
it('saves idempotently under the authenticated follower, only for a play member',async()=>{
 expect((await POST(request())).status).toBe(200)
 expect(query.upsert).toHaveBeenCalledWith({follower_id:me,following_id:target},{onConflict:'follower_id,following_id',ignoreDuplicates:true})
 query.maybeSingle.mockResolvedValueOnce({data:null,error:null})
 expect((await POST(request())).status).toBe(404)
 expect(query.upsert).toHaveBeenCalledTimes(1)
})
it('unfollows only the caller’s relationship',async()=>{
 const req=new Request('http://localhost:3012/api/play/follows',{method:'POST',headers:{origin:'http://localhost:3012','Content-Type':'application/json'},body:JSON.stringify({userId:target,follow:false})})
 expect((await POST(req)).status).toBe(200)
 expect(query.delete).toHaveBeenCalledOnce()
 expect(query.eq).toHaveBeenCalledWith('follower_id',me)
 expect(query.eq).toHaveBeenCalledWith('following_id',target)
})
it('accepts the browser origin when Next rewrites the local hostname',async()=>{
 vi.stubEnv('NODE_ENV','development')
 const req=new Request('http://127.0.0.1:3012/api/play/follows',{method:'POST',headers:{origin:'http://localhost:3012',host:'localhost:3012','Content-Type':'application/json'},body:JSON.stringify({userId:target,follow:true})})
 expect((await POST(req)).status).toBe(200)
 vi.unstubAllEnvs()
})

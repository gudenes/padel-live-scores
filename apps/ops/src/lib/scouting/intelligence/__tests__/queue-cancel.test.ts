import {beforeEach,describe,it,expect,vi} from 'vitest'
const {query,auth,origin}=vi.hoisted(()=>({query:vi.fn(),auth:vi.fn(),origin:vi.fn()}))
vi.mock('@/lib/auth',()=>({auth}))
vi.mock('@/lib/db',()=>({pgPool:()=>({query})}))
vi.mock('@/lib/admin-request-origin',()=>({hasAdminRequestOrigin:origin}))
vi.mock('@/lib/rate-limit',()=>({check:()=>({allowed:true})}))
vi.mock('@/lib/lab-vision/prepare-review',()=>({savedScout:vi.fn(),anchorAlignment:vi.fn()}))
vi.mock('@/lib/match-video-storage',()=>({videoStorage:vi.fn()}))
import {POST} from '@/app/api/internal/lab-vision/jobs/route'
const id='386b5bd2-9dca-4bae-ba32-5482ba0dbdbd'
const request=()=>new Request('http://localhost/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'cancelQueued',id})})
beforeEach(()=>{vi.clearAllMocks();auth.mockResolvedValue({user:{id:'owner',isOperator:true}});origin.mockReturnValue(true)})
describe('queued cancellation',()=>{
 it('limits cancellation to the owner and jobs still queued',async()=>{query.mockResolvedValue({rowCount:1});expect((await POST(request())).status).toBe(200);expect(query.mock.calls[0][1]).toEqual([id,'owner']);expect(query.mock.calls[0][0]).toContain("status='queued'")})
 it('refuses a job that has already started or is not owned',async()=>{query.mockResolvedValue({rowCount:0});expect((await POST(request())).status).toBe(409)})
 it('rejects non-operators and cross-site requests before any write',async()=>{auth.mockResolvedValue({user:{id:'owner',isOperator:false}});expect((await POST(request())).status).toBe(403);auth.mockResolvedValue({user:{id:'owner',isOperator:true}});origin.mockReturnValue(false);expect((await POST(request())).status).toBe(403);expect(query).not.toHaveBeenCalled()})
})

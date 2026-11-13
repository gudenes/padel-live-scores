import {beforeEach,describe,it,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({auth:vi.fn(),query:vi.fn(),origin:vi.fn(),body:vi.fn()}))
vi.mock('@/lib/auth',()=>({auth:mocks.auth}))
vi.mock('@/lib/db',()=>({pgPool:()=>({query:mocks.query})}))
vi.mock('@/lib/admin-request-origin',()=>({hasAdminRequestOrigin:mocks.origin}))
vi.mock('@/lib/lab-vision-jobs',()=>({jobBody:mocks.body}))
import {GET,POST} from '../../../app/api/internal/lab-vision/training/route'
const sample={id:'a',kind:'Shot contact',shot:'Smash',status:'verified',confirmed:true,timingVerified:true,player:'Player',time:10,start:9,end:11,box:{x:.1,y:.1,width:.2,height:.4}}
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('NODE_ENV','production');mocks.auth.mockResolvedValue({user:{id:'admin',isOperator:true}});mocks.origin.mockReturnValue(true);mocks.query.mockResolvedValue({rows:[]})})
describe('Production training access and persistence',()=>{
 it('denies non-admin reads and writes without database access',async()=>{mocks.auth.mockResolvedValue({user:{id:'viewer',isOperator:false}});expect((await GET()).status).toBe(403);expect((await POST(new Request('https://admin.padelnachos.com'))).status).toBe(403);expect(mocks.query).not.toHaveBeenCalled()})
 it('rejects cross-origin writes',async()=>{mocks.origin.mockReturnValue(false);expect((await POST(new Request('https://other.example'))).status).toBe(403);expect(mocks.query).not.toHaveBeenCalled()})
 it('reads current annotations and durable artifacts in production',async()=>{mocks.query.mockResolvedValueOnce({rows:[{payload:sample,match_id:'m',duration_seconds:60}]}).mockResolvedValueOnce({rows:[{payload:{id:'snapshot',createdAt:'2026-11-13'}}]});const r=await GET();expect(r.status).toBe(200);const d=await r.json();expect(d.annotations[0].id).toBe('a');expect(d.artifacts[0].id).toBe('snapshot');expect(d.runnerConnected).toBe(false)})
 it('writes only a new artifact and preserves source annotations',async()=>{mocks.body.mockResolvedValue({action:'snapshot',name:'Dataset',split:{m:'train'}});mocks.query.mockResolvedValueOnce({rows:[{payload:sample,match_id:'m',duration_seconds:60}]}).mockResolvedValueOnce({rows:[]});const r=await POST(new Request('https://admin.padelnachos.com'));expect(r.status).toBe(200);const d=await r.json();expect(d.samples[0].time).toBe(10);expect(d.samples[0].box).toEqual(sample.box);expect(d.canTrain).toBe(false);expect(mocks.query.mock.calls[1][0]).toContain('insert into lab_vision_training_artifacts');expect(mocks.query.mock.calls.some(([q])=>/update |delete /i.test(q))).toBe(false)})
})

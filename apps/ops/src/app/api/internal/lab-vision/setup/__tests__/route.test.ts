import {describe,it,expect,vi,beforeEach} from 'vitest';
vi.mock('@/lib/auth',()=>({auth:vi.fn()}));
vi.mock('@/lib/scouting-permissions',()=>({canViewReports:()=>true}));
vi.mock('@/lib/rate-limit',()=>({check:()=>({allowed:true})}));
import {auth} from '@/lib/auth';
import {POST} from '../route';
import {validCourt,validPoints} from '@/lib/scouting/video-setup';
const req=()=>new Request('http://localhost:3006/api/internal/lab-vision/setup',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:3006'},body:JSON.stringify({image:'invalid'})});
beforeEach(()=>{vi.mocked(auth).mockResolvedValue({user:{id:'test'}} as never);vi.stubEnv('OPENAI_API_KEY','')});
describe('setup safeguards',()=>{
 it('requires login',async()=>{vi.mocked(auth).mockResolvedValue(null as never);expect((await POST(req())).status).toBe(401)});
 it('reports missing configuration without pretending to estimate',async()=>{const r=await POST(req());expect(r.status).toBe(503);expect((await r.json()).error).toContain('not connected')});
 it('rejects non-image inputs before a provider call',async()=>{vi.stubEnv('OPENAI_API_KEY','test');expect((await POST(req())).status).toBe(400)});
 it('rejects cross-site requests',async()=>{const r=req();r.headers.set('origin','https://other.example');expect((await POST(r)).status).toBe(403)});
 it('rejects out-of-frame or missing coordinates',()=>{expect(validPoints(Array(10).fill({x:2,y:0}))).toBe(false);expect(validCourt(Array(10).fill(null))).toBe(false)});
 it('rejects crossed corners but accepts a convex court',()=>{const p=[{x:.2,y:.1},{x:.8,y:.1},{x:.9,y:.9},{x:.1,y:.9},...Array(6).fill({x:.5,y:.5})];expect(validCourt(p)).toBe(true);[p[1],p[2]]=[p[2],p[1]];expect(validCourt(p)).toBe(false)});
});

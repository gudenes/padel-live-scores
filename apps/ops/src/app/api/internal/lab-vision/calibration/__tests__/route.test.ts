import {beforeEach,describe,it,expect,vi} from 'vitest';
vi.mock('@/lib/auth',()=>({auth:vi.fn()}));
const {query}=vi.hoisted(()=>({query:vi.fn()}));vi.mock('@/lib/db',()=>({pgPool:()=>({query})}));
import {auth} from '@/lib/auth';import {GET,POST} from '../route';
const id='53969a2c-431f-4ccc-a0e0-fc4cc84bcdfa';
const setup={version:1,confirmed:true,file:{name:'match.mp4',size:100},points:[{x:.2,y:.1},{x:.8,y:.1},{x:.9,y:.9},{x:.1,y:.9},...Array(6).fill({x:.5,y:.5})],playerNames:['A','B','C','D'],identities:['0','1','2','3'],recording:'broadcast',duration:100,matchStart:0,calibrationTime:10,offset:0,landmarks:{version:1,points:{},coordinateSpace:'normalized-image',method:'manual',reviews:{}}};
const req=(body:unknown)=>new Request('http://localhost:3016/api/internal/lab-vision/calibration',{method:'POST',headers:{Origin:'http://localhost:3016','Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.mocked(auth).mockResolvedValue({user:{id:'owner',isOperator:true}} as never);query.mockReset()});
describe('saved video calibration',()=>{
 it('requires admin access',async()=>{vi.mocked(auth).mockResolvedValue(null as never);expect((await GET(new Request(`http://localhost:3016/?video=${id}`))).status).toBe(403);expect(query).not.toHaveBeenCalled()});
 it('blocks cross-origin writes',async()=>{const r=req({});r.headers.set('origin','https://evil.example');expect((await POST(r)).status).toBe(403)});
 it('persists setup separately without updating jobs',async()=>{query.mockResolvedValueOnce({rows:[{file_name:'match.mp4',byte_size:100,duration_seconds:100}]}).mockResolvedValueOnce({rows:[]});expect((await POST(req({videoId:id,setup}))).status).toBe(200);expect(query.mock.calls[1][0]).toContain('set calibration_setup');expect(JSON.parse(query.mock.calls[1][1][0]).landmarks.reviews).toEqual({});expect(query.mock.calls[1][1].slice(1)).toEqual([id,'owner'])});
 it('returns stored confirmations and scopes reads to owner',async()=>{query.mockResolvedValueOnce({rows:[{setup}]});const r=await GET(new Request(`http://localhost:3016/?video=${id}`));expect((await r.json()).setup).toEqual(setup);expect(query.mock.calls[0][1]).toEqual([id,'owner'])});
 it('rejects a setup for a different video',async()=>{query.mockResolvedValueOnce({rows:[{file_name:'different.mp4',byte_size:100,duration_seconds:100}]});expect((await POST(req({videoId:id,setup}))).status).toBe(400);expect(query).toHaveBeenCalledTimes(1)});
});

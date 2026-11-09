import {beforeEach,describe,it,expect,vi} from 'vitest'
const m=vi.hoisted(()=>({auth:vi.fn(),query:vi.fn(),send:vi.fn(),ready:vi.fn()}))
vi.mock('@/lib/auth',()=>({auth:m.auth}))
vi.mock('@/lib/db',()=>({pgPool:()=>({query:m.query})}))
vi.mock('@/lib/match-video-storage',()=>({videoStorageReady:m.ready,videoStorage:()=>({Bucket:'private',client:{send:m.send}}),playbackVideo:async(r:any)=>({id:r.id,url:'signed'})}))
vi.mock('@/lib/rate-limit',()=>({check:()=>({allowed:true})}))
import {GET,POST} from '../route'
const id='53969a2c-431f-4ccc-a0e0-fc4cc84bcdfa',ctx={params:Promise.resolve({id})}
const request=(body:any,origin='http://localhost')=>new Request(`http://localhost/api/internal/match-video/${id}`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)})
beforeEach(()=>{vi.clearAllMocks();m.auth.mockResolvedValue({user:{id:'admin',isOperator:true}});m.ready.mockReturnValue(true)})
describe('match video access',()=>{
 it('requires authentication before reading media',async()=>{m.auth.mockResolvedValue(null);expect((await GET(new Request('http://localhost'),ctx)).status).toBe(401);expect(m.query).not.toHaveBeenCalled()})
 it('rejects viewer uploads',async()=>{m.auth.mockResolvedValue({user:{id:'viewer',isViewer:true}});expect((await POST(request({id,action:'start'}),ctx)).status).toBe(403);expect(m.send).not.toHaveBeenCalled()})
 it('rejects cross origin writes',async()=>{expect((await POST(request({id,action:'start'},'https://other.example'),ctx)).status).toBe(403)})
 it('never accepts another owner upload',async()=>{m.query.mockResolvedValue({rows:[]});expect((await POST(request({id,action:'part',part:1}),ctx)).status).toBe(404);expect(m.query.mock.calls[0][1]).toEqual([id,id,'canonical','admin']);expect(m.send).not.toHaveBeenCalled()})
 it('fails explicitly when storage is unconfigured',async()=>{m.ready.mockReturnValue(false);expect((await POST(request({id,action:'start'}),ctx)).status).toBe(503)})
 it('returns the existing ready video for a retried completion',async()=>{m.query.mockResolvedValue({rows:[{id,status:'ready'}]});const r=await POST(request({id,action:'complete'}),ctx);expect(await r.json()).toEqual({video:{id,url:'signed'},ready:true});expect(m.send).not.toHaveBeenCalled()})
})

import {beforeEach,it,expect,vi} from 'vitest'
const m=vi.hoisted(()=>({auth:vi.fn(),query:vi.fn()}))
vi.mock('@/lib/auth',()=>({auth:m.auth}))
vi.mock('@/lib/db',()=>({pgPool:()=>({query:m.query})}))
import {GET,POST} from '../route'
import {scouterRouteAllowed} from '@/lib/scouting-permissions'
const id='f3495fee-f1af-4a75-a658-92065d4316b6',path=`/api/internal/match-replay-alignment/${id}`,ctx={params:Promise.resolve({id})},videoUrl='https://www.youtube.com/watch?v=abcdefghijk'
const request=(body:any,origin='http://localhost')=>new Request(`http://localhost${path}`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)})
const anchor={videoUrl,recordedSeconds:1793300016.367559,replaySeconds:28411}
beforeEach(()=>{vi.clearAllMocks();m.auth.mockResolvedValue({user:{id:'admin',isOperator:true}});m.query.mockResolvedValue({rowCount:1,rows:[{recorded_seconds:anchor.recordedSeconds,replay_seconds:anchor.replaySeconds}]})})
it('blocks anonymous reads',async()=>{m.auth.mockResolvedValue(null);expect((await GET(new Request('http://localhost'),ctx)).status).toBe(401);expect(m.query).not.toHaveBeenCalled()})
it('allows report viewers to read shared alignment but not modify it',async()=>{m.auth.mockResolvedValue({user:{id:'viewer',isViewer:true}});expect(scouterRouteAllowed(path,'GET',true)).toBe(true);expect(scouterRouteAllowed(path,'POST',true)).toBe(false);const r=await GET(new Request(`http://localhost${path}?url=${encodeURIComponent(videoUrl)}`),ctx);expect((await r.json()).alignment.replay_seconds).toBe(28411);expect((await POST(request(anchor),ctx)).status).toBe(403)})
it('rejects cross-origin writes',async()=>{expect((await POST(request(anchor,'https://evil.example'),ctx)).status).toBe(403);expect(m.query).not.toHaveBeenCalled()})
it('rejects invalid timestamps',async()=>{expect((await POST(request({...anchor,replaySeconds:-1}),ctx)).status).toBe(400);expect(m.query).not.toHaveBeenCalled()})
it('stores a source-specific match anchor without modifying scouting',async()=>{expect((await POST(request(anchor),ctx)).status).toBe(200);expect(m.query.mock.calls[0][0]).toContain('on conflict(match_id,match_kind,video_url)');expect(m.query.mock.calls[0][1]).toEqual([id,'canonical',videoUrl,anchor.recordedSeconds,28411,'admin'])})
it('rejects nonexistent matches',async()=>{m.query.mockResolvedValue({rows:[],rowCount:0});expect((await POST(request(anchor),ctx)).status).toBe(404)})

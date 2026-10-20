import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({auth:vi.fn(),query:vi.fn(),view:vi.fn()}))
vi.mock('@/lib/auth',()=>({auth:mocks.auth}))
vi.mock('@/lib/db',()=>({pgPool:()=>({query:mocks.query})}))
vi.mock('@/lib/scouting/report-context',()=>({reportContext:vi.fn()}))
vi.mock('@/lib/scouting/saved-report',()=>({savedReport:vi.fn()}))
vi.mock('@/lib/scouting/report-view',()=>({reportView:mocks.view}))
import {POST,DELETE} from '../route'
import {reportContext} from '@/lib/scouting/report-context'
const id='311fc424-99af-49f9-9dad-37780b7f01b6',ctx={params:Promise.resolve({id})}
beforeEach(()=>{vi.clearAllMocks()})
it('denies anonymous, viewer and scouter creation without querying data',async()=>{
 for(const user of [null,{isViewer:true},{isScouter:true}]){mocks.auth.mockResolvedValue({user});expect((await POST(new Request('https://admin.test/api/internal/report-share/'+id,{method:'POST',headers:{origin:'https://admin.test'}}),ctx)).status).toBe(403)}expect(mocks.query).not.toHaveBeenCalled()
})
it('rejects cross-origin operator mutation',async()=>{
 mocks.auth.mockResolvedValue({user:{id:'operator',isOperator:true}});expect((await POST(new Request('https://admin.test/api/internal/report-share/'+id,{method:'POST',headers:{origin:'https://evil.test'}}),ctx)).status).toBe(403);expect(mocks.query).not.toHaveBeenCalled()
})
it('revokes only the hashed token for this match',async()=>{
 mocks.auth.mockResolvedValue({user:{id:'operator',isOperator:true}});mocks.query.mockResolvedValue({rows:[]});const token='a'.repeat(43)
 expect((await DELETE(new Request('https://admin.test/api/internal/report-share/'+id,{method:'DELETE',headers:{origin:'https://admin.test','content-type':'application/json'},body:JSON.stringify({token})}),ctx)).status).toBe(200)
 const [sql,args]=mocks.query.mock.calls[0];expect(sql).toContain('token_hash=$1 and match_id=$2');expect(args[0]).not.toBe(token);expect(args[1]).toBe(id)
})

it.each([undefined,'https://youtu.be/abcdefghijk'])('shares the saved or browser-connected video: %s',async(videoUrl)=>{
 mocks.auth.mockResolvedValue({user:{id:'operator',isOperator:true}})
 mocks.view.mockReturnValue({videoUrl:'https://example.org/match.mp4',players:[{id:'p',name:'Player',shortName:'P',avatar:'/avatar.png',privateField:'hidden'}]})
 mocks.query.mockResolvedValueOnce({rows:[{document:{}}]}).mockResolvedValueOnce({rows:[{expires_at:'2026-11-14'}]})
 const response=await POST(new Request('https://admin.test/api/internal/report-share/'+id,{method:'POST',headers:{origin:'https://admin.test'},body:JSON.stringify({videoUrl})}),ctx)
 expect(response.status).toBe(200)
 const snapshot=JSON.parse(mocks.query.mock.calls[1][1][3])
 expect(snapshot.videoUrl).toBe(videoUrl?'https://www.youtube.com/watch?v=abcdefghijk':'https://example.org/match.mp4')
 expect(snapshot.players[0]).not.toHaveProperty('privateField')
})
it('rejects an unsupported browser video before querying',async()=>{
 mocks.auth.mockResolvedValue({user:{id:'operator',isOperator:true}})
 const response=await POST(new Request('https://admin.test/api/internal/report-share/'+id,{method:'POST',headers:{origin:'https://admin.test'},body:JSON.stringify({videoUrl:'javascript:alert(1)'})}),ctx)
 expect(response.status).toBe(400);expect(mocks.query).not.toHaveBeenCalled()
})

afterEach(()=>vi.unstubAllEnvs())
it('accepts the production admin origin behind an internal proxy URL',async()=>{
 vi.stubEnv('NODE_ENV','production');mocks.auth.mockResolvedValue({user:{id:'operator',isOperator:true}});mocks.query.mockResolvedValue({rows:[]})
 const response=await DELETE(new Request('http://internal:8080/api/internal/report-share/'+id,{method:'DELETE',headers:{origin:'https://admin.padelnachos.com'},body:JSON.stringify({token:'a'.repeat(43)})}),ctx)
 expect(response.status).toBe(200)
})
it.each(['https://evil.test','http://internal:8080','null'])('rejects untrusted production origin %s even with forwarded headers',async origin=>{
 vi.stubEnv('NODE_ENV','production');mocks.auth.mockResolvedValue({user:{id:'operator',isOperator:true}})
 const response=await POST(new Request('http://internal:8080/api/internal/report-share/'+id,{method:'POST',headers:{origin,'x-forwarded-host':'admin.padelnachos.com'}}),ctx)
 expect(response.status).toBe(403);expect(mocks.query).not.toHaveBeenCalled()
})
it('accepts matching loopback Host in development when Next normalizes the URL',async()=>{
 vi.stubEnv('NODE_ENV','development');mocks.auth.mockResolvedValue({user:{id:'operator',isOperator:true}});mocks.query.mockResolvedValue({rows:[]})
 const response=await DELETE(new Request('http://localhost:8824/api/internal/report-share/'+id,{method:'DELETE',headers:{origin:'http://127.0.0.1:8824',host:'127.0.0.1:8824'},body:JSON.stringify({token:'a'.repeat(43)})}),ctx)
 expect(response.status).toBe(200)
})

it('shares a manual snapshot with reusable avatars and connected video',async()=>{
 mocks.auth.mockResolvedValue({user:{id:'operator',isOperator:true}})
 mocks.view.mockReturnValue({videoUrl:'https://example.org/match.mp4',players:[{id:'local-id',name:'Player',shortName:'P',avatar:'https://example.org/avatar.png'}]})
 mocks.query.mockResolvedValueOnce({rows:[{document:{},players:[]}]}).mockResolvedValueOnce({rows:[{expires_at:'2026-11-20'}]})
 const response=await POST(new Request('https://admin.test/api/internal/report-share/'+id,{method:'POST',headers:{origin:'https://admin.test'},body:JSON.stringify({manual:true})}),ctx)
 expect(response.status).toBe(200)
 expect(mocks.query.mock.calls[0][0]).toContain('operator_manual_video_scouting_sessions')
 expect(reportContext).toHaveBeenCalledWith(id,true)
 const snapshot=JSON.parse(mocks.query.mock.calls[1][1][3])
 expect(snapshot.players[0].avatar).toBe('https://example.org/avatar.png')
 expect(snapshot.videoUrl).toBe('https://example.org/match.mp4')
 expect((await response.json()).path).toMatch(/^\/s\//)
})
it('does not fall back to tournament data for a missing manual session',async()=>{
 mocks.auth.mockResolvedValue({user:{id:'operator',isOperator:true}});mocks.query.mockResolvedValueOnce({rows:[]})
 const response=await POST(new Request('https://admin.test/api/internal/report-share/'+id,{method:'POST',headers:{origin:'https://admin.test'},body:JSON.stringify({manual:true})}),ctx)
 expect(response.status).toBe(404);expect(mocks.query).toHaveBeenCalledTimes(1)
})
it('rejects invalid match types before reading any session',async()=>{
 mocks.auth.mockResolvedValue({user:{id:'operator',isOperator:true}})
 const response=await POST(new Request('https://admin.test/api/internal/report-share/'+id,{method:'POST',headers:{origin:'https://admin.test'},body:JSON.stringify({manual:'true'})}),ctx)
 expect(response.status).toBe(400);expect(mocks.query).not.toHaveBeenCalled()
})

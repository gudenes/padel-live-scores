import {beforeEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({auth:vi.fn(),query:vi.fn()}))
vi.mock('@/lib/auth',()=>({auth:mocks.auth}))
vi.mock('@/lib/db',()=>({pgPool:()=>({query:mocks.query})}))
import {GET,POST,DELETE} from '@/app/api/internal/scouting-review-notes/[id]/route'
import {parseReviewNote} from '@/lib/scouting/review-notes'
import {canScout,canWriteSession,scouterRouteAllowed} from '@/lib/scouting-permissions'
const id='11111111-1111-4111-8111-111111111111',noteId='22222222-2222-4222-8222-222222222222'
const ctx={params:Promise.resolve({id})},viewer={id:'viewer-id',isViewer:true,name:'Reviewer'}
const body={id:noteId,tag:'question',note:'Check the defense here',seconds:94,videoUrl:'https://youtu.be/abcdefghijk'}
const req=(method='GET',value:unknown=body,kind='canonical',origin='https://admin.test')=>new Request(`https://admin.test/api/internal/scouting-review-notes/${id}?kind=${kind}&noteId=${noteId}`,{method,headers:{origin},...(method==='POST'?{body:JSON.stringify(value)}:{})})
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({user:viewer});mocks.query.mockResolvedValue({rowCount:1,rows:[{id:noteId}]})})
it('allows Viewer annotations without granting scouting writes',async()=>{
 expect((await POST(req('POST'),ctx)).status).toBe(201)
 expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('insert into public.scouting_review_notes'),[noteId,id,viewer.id,'Reviewer','https://www.youtube.com/watch?v=abcdefghijk',94,'question',body.note])
 expect(canScout(viewer)).toBe(false);expect(canWriteSession(viewer,null)).toBe(false)
 for(const kind of ['video-scouting','manual-video-scouting','scouting'])expect(scouterRouteAllowed(`/api/internal/${kind}/${id}`,'POST',true)).toBe(false)
 for(const method of ['GET','HEAD','POST','DELETE'])expect(scouterRouteAllowed(`/api/internal/scouting-review-notes/${id}`,method,true)).toBe(true)
 for(const method of ['PATCH','PUT'])expect(scouterRouteAllowed(`/api/internal/scouting-review-notes/${id}`,method,true)).toBe(false)
})
it.each([null,{id:'outsider'}, {id:'revoked',isViewer:false}])('denies signed-out, nonstaff and revoked users: %o',async user=>{
 mocks.auth.mockResolvedValue(user?{user}:null)
 for(const [method,handler] of [['GET',GET],['POST',POST],['DELETE',DELETE]] as const)expect((await handler(req(method),ctx)).status).toBe(user?403:401)
 expect(mocks.query).not.toHaveBeenCalled()
})
it('rejects cross-origin writes',async()=>{
 for(const [method,handler] of [['POST',POST],['DELETE',DELETE]] as const)expect((await handler(req(method,body,'canonical','https://evil.test'),ctx)).status).toBe(403)
 expect(mocks.query).not.toHaveBeenCalled()
})
it.each([{...body,score:{}},{...body,author_user_id:'other'},{...body,seconds:-1},{...body,seconds:1.5},{...body,videoUrl:'javascript:alert(1)'},{...body,note:' '},{...body,note:'x'.repeat(2001)},{...body,tag:'winner'},{...body,seconds:86401},{...body,videoUrl:''},{...body,tag:'__proto__'}])('rejects invalid or forged payloads',async value=>{
 expect((await POST(req('POST',value),ctx)).status).toBe(400);expect(mocks.query).not.toHaveBeenCalled()
})
it('accepts untimed match notes',()=>{expect(parseReviewNote({...body,seconds:null,videoUrl:''}).seconds).toBeNull()})
it('keeps canonical and private match notes separate',async()=>{
 await GET(req(),ctx);expect(mocks.query).toHaveBeenLastCalledWith(expect.stringContaining('where canonical_match_id=$1'),[id])
 await POST(req('POST',body,'manual'),ctx);expect(mocks.query).toHaveBeenLastCalledWith(expect.stringContaining('from public.operator_manual_scouting_matches'),expect.any(Array))
 await GET(req('GET',body,'manual'),ctx);expect(mocks.query).toHaveBeenLastCalledWith(expect.stringContaining('where manual_match_id=$1'),[id])
})
it('does not expose notes for missing matches',async()=>{mocks.query.mockResolvedValue({rowCount:0,rows:[]});expect((await GET(req(),ctx)).status).toBe(404)})
it('only deletes the authenticated author’s note in this match',async()=>{
 expect((await DELETE(req('DELETE'),ctx)).status).toBe(200)
 expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('where id=$1 and canonical_match_id=$2 and author_user_id=$3'),[noteId,id,viewer.id])
 mocks.query.mockResolvedValue({rowCount:0,rows:[]});expect((await DELETE(req('DELETE'),ctx)).status).toBe(403)
})
it('handles retries without duplicates and rejects changed payloads',async()=>{
 const row={video_url:'https://www.youtube.com/watch?v=abcdefghijk',video_seconds:94,tag:body.tag,note:body.note}
 mocks.query.mockResolvedValueOnce({rowCount:0,rows:[]}).mockResolvedValueOnce({rowCount:1,rows:[row]})
 expect((await POST(req('POST'),ctx)).status).toBe(200)
 mocks.query.mockResolvedValueOnce({rowCount:0,rows:[]}).mockResolvedValueOnce({rowCount:1,rows:[{...row,note:'other'}]})
 expect((await POST(req('POST'),ctx)).status).toBe(409)
})
it('reports storage failure',async()=>{mocks.query.mockRejectedValue(Error('offline'));expect((await POST(req('POST'),ctx)).status).toBe(503)})

it('rejects actual video scouting saves from Viewers before touching session storage',async()=>{
 const {videoScoutingApi}=await import('@/lib/video-scouting-api')
 const roster=vi.fn()
 const api=videoScoutingApi({table:'operator_video_scouting_sessions',roster})
 expect((await api.POST(req('POST',{document:{score:'forged'}}),ctx)).status).toBe(401)
 expect(roster).not.toHaveBeenCalled()
 expect(mocks.query).not.toHaveBeenCalled()
})

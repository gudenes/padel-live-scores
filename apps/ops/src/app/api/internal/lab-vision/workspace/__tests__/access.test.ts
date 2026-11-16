import {beforeEach,describe,it,expect,vi} from 'vitest'
const mock=vi.hoisted(()=>({auth:vi.fn(),query:vi.fn(),origin:vi.fn()}))
vi.mock('@/lib/auth',()=>({auth:mock.auth}))
vi.mock('@/lib/db',()=>({pgPool:()=>({query:mock.query})}))
vi.mock('@/lib/admin-request-origin',()=>({hasAdminRequestOrigin:mock.origin}))
vi.mock('@/lib/match-video-storage',()=>({playbackVideo:vi.fn()}))
vi.mock('@/lib/lab-vision/workspace-storage',()=>({annotationProject:vi.fn(),serveCandidates:vi.fn()}))
import {GET,POST} from '../route'
describe('admin annotation access',()=>{
 beforeEach(()=>{vi.clearAllMocks();mock.origin.mockReturnValue(true)})
 it.each([null,{user:{id:'viewer',isViewer:true}},{user:{id:'scouter',isScouter:true}}])('denies non-admin read and write',async session=>{
  mock.auth.mockResolvedValue(session)
  expect((await GET(new Request('https://example.com/api/internal/lab-vision/workspace'))).status).toBe(403)
  expect((await POST(new Request('https://example.com/api/internal/lab-vision/workspace',{method:'POST'}))).status).toBe(403)
  expect(mock.query).not.toHaveBeenCalled()
 })
 it('rejects foreign-origin admin mutation',async()=>{
  mock.auth.mockResolvedValue({user:{id:'admin',isOperator:true}});mock.origin.mockReturnValue(false)
  expect((await POST(new Request('https://example.com/api/internal/lab-vision/workspace',{method:'POST'}))).status).toBe(403)
  expect(mock.query).not.toHaveBeenCalled()
 })
 it('allows admins to list the shared workspace',async()=>{
  mock.auth.mockResolvedValue({user:{id:'admin',isOperator:true}});mock.query.mockResolvedValue({rows:[]})
  const r=await GET(new Request('https://example.com/api/internal/lab-vision/workspace'));expect(r.status).toBe(200);expect(await r.json()).toMatchObject({jobs:[],workers:[]})
 })
 it('summarizes labels per run using source duration and latest revisions',async()=>{
  mock.auth.mockResolvedValue({user:{id:'admin',isOperator:true}})
  const shot={id:'a',kind:'Shot contact',status:'verified',shot:'Serve',confirmed:true,player:'Player',box:{x:0,y:0,width:.2,height:.4},time:5,start:4,end:6}
  mock.query.mockResolvedValueOnce({rows:[{id:'job-a',status:'complete'},{id:'job-b',status:'complete'}]})
   .mockResolvedValueOnce({rows:[]})
   .mockResolvedValueOnce({rows:[{job_id:'job-a',payload:shot,duration_seconds:'20'},{job_id:'job-a',payload:{...shot,id:'b',supersedes:'a',box:null},duration_seconds:'20'},{job_id:'job-b',payload:shot,duration_seconds:'20'}]})
  const r=await GET(new Request('https://example.com/api/internal/lab-vision/workspace'))
  const data=await r.json()
  expect(data.jobs[0].labels).toEqual({total:1,reviewed:1,eligible:0,pending:1})
  expect(data.jobs[1].labels).toEqual({total:1,reviewed:1,eligible:1,pending:0})
  expect(mock.query.mock.calls[2][1]).toEqual([['job-a','job-b']])
 })

})

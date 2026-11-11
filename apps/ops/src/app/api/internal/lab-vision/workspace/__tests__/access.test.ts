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
})

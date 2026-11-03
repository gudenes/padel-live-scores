import { beforeEach,it,expect,vi } from 'vitest'
const mocks=vi.hoisted(()=>({auth:vi.fn(),read:vi.fn()}))
vi.mock('@/lib/auth',()=>({auth:mocks.auth}))
vi.mock('@/lib/world-cup-history',async(original)=>({...await original<typeof import('../src/lib/world-cup-history')>(),readWorldCupArchive:mocks.read}))
import { GET } from '../src/app/api/internal/world-cup-history/route'
beforeEach(()=>vi.resetAllMocks())
it('rejects signed-out and non-operator callers before reading records',async()=>{
 for(const session of [null,{user:{isOperator:false}}]){
  mocks.auth.mockResolvedValue(session)
  expect((await GET(new Request('https://admin.test/api/internal/world-cup-history'))).status).toBe(401)
 }
 expect(mocks.read).not.toHaveBeenCalled()
})
it('exports JSON only for operators with valid filters',async()=>{
 mocks.auth.mockResolvedValue({user:{isOperator:true}})
 expect((await GET(new Request('https://admin.test/api/internal/world-cup-history?year=bad'))).status).toBe(400)
 expect(mocks.read).not.toHaveBeenCalled()
 mocks.read.mockResolvedValue({records:[],editions:[],total:0})
 const response=await GET(new Request('https://admin.test/api/internal/world-cup-history?year=2024'))
 expect(response.status).toBe(200);expect(response.headers.get('content-disposition')).toContain('world-cup-2024.json')
 expect(response.headers.get('cache-control')).toContain('no-store')
})

import {beforeEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({access:vi.fn(),pages:vi.fn(),member:vi.fn()}))
vi.mock('@/lib/play-access',()=>({requirePlayAccess:mocks.access}))
vi.mock('@/lib/db-paginate',()=>({paginatedSelect:mocks.pages}))
import {GET} from './route'
const request=(query='')=>new Request('https://padelnachos.com/api/play/players/stats'+query)
beforeEach(()=>{
 vi.clearAllMocks()
 const chain={select:()=>chain,eq:()=>chain,maybeSingle:mocks.member}
 mocks.access.mockResolvedValue({userId:'12345678-1234-4234-8234-123456789abc',supabase:{from:()=>chain}})
 mocks.member.mockResolvedValue({data:{user_id:'member'},error:null})
 mocks.pages.mockResolvedValue([])
})
it('protects stats behind Play membership',async()=>{mocks.access.mockResolvedValue(null);expect((await GET(request())).status).toBe(404);expect(mocks.pages).not.toHaveBeenCalled()})
it('does not expose nonmember statistics',async()=>{mocks.member.mockResolvedValue({data:null});expect((await GET(request())).status).toBe(404);expect(mocks.pages).not.toHaveBeenCalled()})
it('validates target identity',async()=>{expect((await GET(request('?userId=bad'))).status).toBe(400)})
it('returns no percentage for no results',async()=>{const r=await GET(request());expect(await r.json()).toEqual({correct:0,settled:0,percent:null});expect(r.headers.get('cache-control')).toBe('private, no-store')})
it('never presents failed history as zero',async()=>{mocks.pages.mockRejectedValue(Error());expect((await GET(request())).status).toBe(503)})

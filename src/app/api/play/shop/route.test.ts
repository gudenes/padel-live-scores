import {beforeEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({access:vi.fn(),balance:vi.fn(),rpc:vi.fn()}))
vi.mock('@/lib/play-access',()=>({requirePlayAccess:mocks.access}))
vi.mock('../_shared',()=>({ensureBalance:mocks.balance,playNotFound:()=>Response.json({error:'not_found'},{status:404})}))
import {GET,POST} from './route'
beforeEach(()=>{vi.clearAllMocks();mocks.access.mockResolvedValue({userId:'session-user',supabase:{rpc:mocks.rpc}});mocks.balance.mockResolvedValue({seasonId:'season'});mocks.rpc.mockResolvedValue({data:{balance:100,owned:[]},error:null})})
const request=(body:object,origin='http://localhost:3012')=>new Request('http://localhost:3012/api/play/shop',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)})
it('denies reads and writes before any wallet access when uninvited',async()=>{mocks.access.mockResolvedValue(null);expect((await GET()).status).toBe(404);expect((await POST(request({action:'buy',item:'hat-club'}))).status).toBe(404);expect(mocks.balance).not.toHaveBeenCalled()})
it('ignores client identities, price, balance and wins',async()=>{expect((await POST(request({action:'buy',item:'hat-club',userId:'other',price:0,balance:99999,wins:999}))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('play_shop_update',{p_user:'session-user',p_season:'season',p_action:'buy',p_item:'hat-club',p_avatar:null})})
it('rejects cross-origin writes',async()=>{expect((await POST(request({action:'buy'},'https://evil.example'))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled()})
it('does not cache personal wardrobe responses',async()=>{expect((await GET()).headers.get('cache-control')).toBe('private, no-store')})

import {beforeEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({access:vi.fn(),season:vi.fn(),rpc:vi.fn(),trusted:vi.fn()}))
vi.mock('@/lib/play-access',()=>({requirePlayAccess:mocks.access}))
vi.mock('@/lib/play-write-origin',()=>({isTrustedPlayWrite:mocks.trusted}))
vi.mock('../../_shared',()=>({getActiveSeason:mocks.season}))
import {GET,POST} from './route'
beforeEach(()=>{vi.clearAllMocks();mocks.access.mockResolvedValue({userId:'signed-in-user',supabase:{rpc:mocks.rpc}});mocks.season.mockResolvedValue({id:'active-season'});mocks.trusted.mockReturnValue(true);mocks.rpc.mockResolvedValue({data:{change:null},error:null})})
it('denies nonmembers without reading wallet history',async()=>{mocks.access.mockResolvedValue(null);expect((await GET()).status).toBe(404);expect(mocks.rpc).not.toHaveBeenCalled()})
it('uses the session identity and active season',async()=>{expect((await GET()).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('play_wallet_changes',{p_user:'signed-in-user',p_season:'active-season',p_ack:null})})
it('rejects cross-origin acknowledgements',async()=>{mocks.trusted.mockReturnValue(false);expect((await POST(new Request('https://padelnachos.com/api/play/wallet/changes',{method:'POST'}))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled()})
it('accepts only the opaque change id, ignoring client balances and identities',async()=>{
 const id='12345678-1234-4234-8234-123456789abc'
 expect((await POST(new Request('https://padelnachos.com/api/play/wallet/changes',{method:'POST',body:JSON.stringify({id,userId:'other',balance:99999})}))).status).toBe(200)
 expect(mocks.rpc).toHaveBeenCalledWith('play_wallet_changes',{p_user:'signed-in-user',p_season:'active-season',p_ack:id})
})
it('returns a recoverable failure when history has not been installed',async()=>{mocks.rpc.mockResolvedValue({error:{message:'missing function'}});expect((await GET()).status).toBe(503)})

import {beforeEach,expect,it,vi} from 'vitest'
const m=vi.hoisted(()=>({auth:vi.fn(),enabled:vi.fn(),allowed:vi.fn(),read:vi.fn(),rpc:vi.fn(),origin:vi.fn()}))
vi.mock('@/auth',()=>({auth:m.auth}))
vi.mock('@/lib/supabase',()=>({createServiceClient:()=>({rpc:m.rpc})}))
vi.mock('@/lib/play-access',()=>({isPlayEnabled:m.enabled,isWhitelisted:m.allowed}))
vi.mock('@/lib/play-write-origin',()=>({isTrustedPlayWrite:m.origin}))
vi.mock('@/lib/play-invites',()=>({readInvitation:m.read}))
import {POST} from './route'
const req=()=>new Request('https://padelnachos.com/api/play/invites/accept',{method:'POST',headers:{origin:'https://padelnachos.com','content-type':'application/json'},body:JSON.stringify({token:'test'})})
beforeEach(()=>{vi.clearAllMocks();m.auth.mockResolvedValue({user:{id:'friend'}});m.origin.mockReturnValue(true);m.enabled.mockResolvedValue(true);m.allowed.mockResolvedValue(true);m.read.mockReturnValue({issuer:'host'});m.rpc.mockResolvedValue({error:null})})
it('requires sign in without granting access',async()=>{m.auth.mockResolvedValue(null);expect((await POST(req())).status).toBe(401);expect(m.rpc).not.toHaveBeenCalled()})
it('rejects foreign origins before auth',async()=>{m.origin.mockReturnValue(false);expect((await POST(req())).status).toBe(403);expect(m.auth).not.toHaveBeenCalled()})
it('rejects expired or altered links',async()=>{m.read.mockReturnValue(null);expect((await POST(req())).status).toBe(410);expect(m.rpc).not.toHaveBeenCalled()})
it('rejects removed inviters',async()=>{m.allowed.mockResolvedValue(false);expect((await POST(req())).status).toBe(410);expect(m.rpc).not.toHaveBeenCalled()})
it('honors the master game switch',async()=>{m.enabled.mockResolvedValue(false);expect((await POST(req())).status).toBe(410);expect(m.rpc).not.toHaveBeenCalled()})
it('atomically joins and connects only the signed-in account to the verified inviter',async()=>{expect((await POST(req())).status).toBe(200);expect(m.rpc).toHaveBeenCalledWith('play_accept_friend_invitation',{p_user:'friend',p_inviter:'host'})})
it('does not report success after database failure',async()=>{m.rpc.mockResolvedValue({error:{message:'failed'}});expect((await POST(req())).status).toBe(503)})

it('accepts an idempotent no-op without duplicating relationships',async()=>{m.rpc.mockResolvedValue({data:false,error:null});expect((await POST(req())).status).toBe(200);expect(m.rpc).toHaveBeenCalledTimes(1)})

import { beforeEach, afterEach, it, expect, vi } from 'vitest'
const mock = vi.hoisted(() => ({ host: 'localhost:3012', auth: vi.fn(), client: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers({host: mock.host}) }))
vi.mock('@/auth', () => ({ auth: mock.auth }))
vi.mock('@/lib/supabase', () => ({ createServiceClient: mock.client }))
import { isPlayEnabled, requirePlayAccess } from '../play-access'
import { isTrustedPlayWrite } from '../play-write-origin'
beforeEach(() => { vi.stubEnv('NODE_ENV','production'); vi.clearAllMocks() })
afterEach(() => vi.unstubAllEnvs())
function client(enabled: boolean, invited: boolean) {
 const flag = {data:{enabled,enabled_local:true},error:null}
 const list = {data:invited ? {user_id:'owner'} : null,error:null}
 return {from: vi.fn((table:string) => {const q={select:()=>q,eq:()=>q,maybeSingle:async()=>table==='feature_flags'?flag:list};return q})}
}
it('production never selects the local flag, including a localhost Host',async()=>{
 expect(await isPlayEnabled(client(false,true) as never)).toBe(false)
})
it('denies uninvited accounts even with the production switch on',async()=>{
 mock.auth.mockResolvedValue({user:{id:'lia'}});mock.client.mockReturnValue(client(true,false))
 expect(await requirePlayAccess()).toBeNull()
})
it('allows the invited account only with the production switch on',async()=>{
 mock.auth.mockResolvedValue({user:{id:'owner'}});mock.client.mockReturnValue(client(true,true))
 expect((await requirePlayAccess())?.userId).toBe('owner')
 mock.client.mockReturnValue(client(false,true));expect(await requirePlayAccess()).toBeNull()
})
it('blocks cross-site and missing-origin trades while allowing the public site behind a proxy',()=>{
 const req=(origin?:string,type='application/json')=>new Request('http://internal:3000/api/play/trade',{headers:{...(origin?{origin}:{}),'content-type':type}})
 expect(isTrustedPlayWrite(req('https://padelnachos.com'))).toBe(true)
 for(const origin of [undefined,'https://evil.example','http://localhost:3012']) expect(isTrustedPlayWrite(req(origin))).toBe(false)
 expect(isTrustedPlayWrite(req('https://padelnachos.com','text/plain'))).toBe(false)
})

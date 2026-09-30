import {beforeEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({access:vi.fn(),image:vi.fn()}))
vi.mock('@/lib/play-access',()=>({requirePlayAccess:mocks.access}))
vi.mock('@/lib/production-avatar-store',()=>({readProductionAvatar:mocks.image}))
import {GET} from '@/app/api/play/players/avatar/route'
const user='11111111-1111-4111-8111-111111111111'
const asset='22222222-2222-4222-8222-222222222222'
const request=(extra='')=>new Request(`http://localhost/api/play/players/avatar?userId=${user}${extra}`)
function setup(member:unknown,wardrobe:unknown){const from=vi.fn((table:string)=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:table==='play_access'?member:wardrobe,error:null})})})}));mocks.access.mockResolvedValue({supabase:{from}});return from}
beforeEach(()=>vi.clearAllMocks())
it('denies unauthenticated viewers',async()=>{mocks.access.mockResolvedValue(null);expect((await GET(request())).status).toBe(404);expect(mocks.image).not.toHaveBeenCalled()})
it('denies targets outside Play membership',async()=>{const from=setup(null,{});expect((await GET(request())).status).toBe(404);expect(from).toHaveBeenCalledTimes(1)})
it('returns only shared appearance, excluding private inventory and wallet',async()=>{setup({user_id:user},{avatar:`custom:${asset}`,equipped:{invalid:'secret'},balance:1000,owned:['secret']});expect(await (await GET(request())).json()).toEqual({avatar:`custom:${asset}`,equipped:{}})})
it('only serves the equipped image, ignoring caller supplied asset ids',async()=>{setup({user_id:user},{avatar:`custom:${asset}`,equipped:{}});mocks.image.mockResolvedValue(Buffer.from('png'));const response=await GET(request('&image=1&id=arbitrary'));expect(response.status).toBe(200);expect(mocks.image).toHaveBeenCalledWith(expect.anything(),user,asset)})

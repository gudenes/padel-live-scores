import {beforeEach,expect,it,vi} from 'vitest'
const m=vi.hoisted(()=>({enabled:vi.fn(),db:{}}))
vi.mock('@/lib/play-access',()=>({isPlayEnabled:m.enabled}))
vi.mock('@/lib/supabase',()=>({createServiceClient:()=>m.db}))
import {GET} from './route'
beforeEach(()=>vi.clearAllMocks())
it('shows Predict navigation to everyone when enabled',async()=>{m.enabled.mockResolvedValue(true);const response=await GET();expect(await response.json()).toEqual({allowed:true});expect(response.headers.get('Cache-Control')).toContain('no-store')})
it('respects the global kill switch',async()=>{m.enabled.mockResolvedValue(false);expect(await (await GET()).json()).toEqual({allowed:false})})

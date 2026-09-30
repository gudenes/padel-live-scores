import {beforeEach,afterEach,it,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({access:vi.fn(),list:vi.fn()}))
vi.mock('@/lib/play-access',()=>({requirePlayAccess:mocks.access}))
import {GET} from './route'
beforeEach(()=>{vi.stubEnv('NODE_ENV','production');vi.clearAllMocks();mocks.access.mockResolvedValue({userId:'owner',supabase:{storage:{from:()=>({list:mocks.list})}}})})
afterEach(()=>vi.unstubAllEnvs())
it('does not list files without play access',async()=>{mocks.access.mockResolvedValue(null);expect((await GET()).status).toBe(404);expect(mocks.list).not.toHaveBeenCalled()})
it('lists only owner-scoped valid avatar ids with private caching',async()=>{mocks.list.mockResolvedValue({data:[{name:'20fca730-15c5-4e54-ab12-b2e34e2fd913.png'},{name:'usage.json'},{name:'../other.png'}],error:null});const response=await GET();expect(mocks.list).toHaveBeenCalledWith('owner',expect.objectContaining({limit:100}));expect(await response.json()).toEqual({avatars:['custom:20fca730-15c5-4e54-ab12-b2e34e2fd913']});expect(response.headers.get('Cache-Control')).toBe('private, no-store')})
it('returns a recoverable error when storage is unavailable',async()=>{mocks.list.mockResolvedValue({error:Error('private storage detail')});expect((await GET()).status).toBe(503)})

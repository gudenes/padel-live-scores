import {beforeEach,describe,it,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({auth:vi.fn(),query:vi.fn()}))
vi.mock('@/lib/auth',()=>({auth:mocks.auth}))
vi.mock('@/lib/db',()=>({pgPool:()=>({query:mocks.query})}))
vi.mock('@/lib/youtube-channel-api',()=>({listUploadsPlaylistItems:vi.fn(),listVideoDetails:vi.fn()}))
import {GET} from '../../app/api/internal/scouting/[id]/broadcasts/route'
const context={params:Promise.resolve({id:'40953efd-4146-406a-adb9-9605fdff55d9'})}
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({user:{id:'u',isOperator:true}})})
describe('broadcast route',()=>{
 it('allows authenticated scouters on the production host',async()=>{mocks.query.mockResolvedValue({rows:[]});expect((await GET(new Request('https://admin.padelnachos.com'),context)).status).toBe(404);expect(mocks.query).toHaveBeenCalledTimes(1)})
 it('requires scouting privileges',async()=>{mocks.auth.mockResolvedValue({user:{isViewer:true}});expect((await GET(new Request('http://localhost'),context)).status).toBe(403);expect(mocks.query).not.toHaveBeenCalled()})
 it('rejects invalid match ids before querying',async()=>{expect((await GET(new Request('http://localhost'),{params:Promise.resolve({id:'bad'})})).status).toBe(400);expect(mocks.query).not.toHaveBeenCalled()})
 it('returns a clear not-found response',async()=>{mocks.query.mockResolvedValue({rows:[]});expect((await GET(new Request('http://localhost'),context)).status).toBe(404)})
})

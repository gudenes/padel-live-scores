import {beforeEach,it,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({auth:vi.fn(),list:vi.fn(),mutate:vi.fn()}))
vi.mock('@/lib/auth',()=>({auth:mocks.auth}))
vi.mock('../player-view-store',()=>({listPlayerViews:mocks.list,mutatePlayerViews:mocks.mutate}))
import {GET,POST} from '@/app/api/internal/player-views/route'
import {scouterRouteAllowed} from '@/lib/scouting-permissions'
const request=(body:unknown,origin='https://admin.test')=>new Request('https://admin.test/api/internal/player-views',{method:'POST',headers:{origin},body:JSON.stringify(body)})
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({user:{id:'account-a',isViewer:true}});mocks.list.mockResolvedValue([]);mocks.mutate.mockResolvedValue([])})
it('requires scouting access',async()=>{
 mocks.auth.mockResolvedValue({user:{id:'a'}})
 expect((await GET()).status).toBe(401)
 expect((await POST(request({action:'import',views:[]}))).status).toBe(401)
 expect(mocks.list).not.toHaveBeenCalled();expect(mocks.mutate).not.toHaveBeenCalled()
})
it('uses only the signed-in owner and never caches private views',async()=>{
 const response=await GET()
 expect(response.headers.get('cache-control')).toContain('no-store')
 expect(mocks.list).toHaveBeenCalledWith('account-a')
 await POST(request({action:'import',views:[],userId:'victim'}))
 expect(mocks.mutate).toHaveBeenCalledWith('account-a',{action:'import',views:[]})
})
it('rejects cross-origin writes and malformed requests',async()=>{
 expect((await POST(request({action:'import',views:[]},'https://attacker.test'))).status).toBe(403)
 expect((await POST(request({action:'save',view:{},revision:0}))).status).toBe(400)
 expect(mocks.mutate).not.toHaveBeenCalled()
})
it('allows scoped staff to manage their own preferences',()=>{
 expect(scouterRouteAllowed('/api/internal/player-views','POST',true)).toBe(true)
 expect(scouterRouteAllowed('/api/internal/player-views','GET')).toBe(true)
})

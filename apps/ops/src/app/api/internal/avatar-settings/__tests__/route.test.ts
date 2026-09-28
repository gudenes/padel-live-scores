import {beforeEach,afterEach,it,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({auth:vi.fn(),read:vi.fn(),write:vi.fn(),prodRead:vi.fn(),prodWrite:vi.fn()}))
vi.mock('@/lib/auth',()=>({auth:mocks.auth}))
vi.mock('../../../../../../../../src/lib/local-avatar-settings',()=>({readAvatarSettings:mocks.read,writeAvatarSettings:mocks.write,avatarSettingsStatus:(s:{enabled:boolean;apiKey:string|null})=>({enabled:s.enabled,configured:!!s.apiKey,suffix:s.apiKey?.slice(-4)??null})}))
vi.mock('../../../../../../../../src/lib/supabase',()=>({createServiceClient:()=>({})}))
vi.mock('../../../../../../../../src/lib/production-avatar-settings',()=>({readProductionAvatarSettings:mocks.prodRead,writeProductionAvatarSettings:mocks.prodWrite}))
import {GET,POST} from '../route'
const url='http://127.0.0.1:3014/api/internal/avatar-settings'
const post=(data:unknown,origin='http://127.0.0.1:3014')=>new Request(url,{method:'POST',headers:{origin},body:JSON.stringify(data)})
beforeEach(()=>{vi.stubEnv('NODE_ENV','development');vi.clearAllMocks();mocks.auth.mockResolvedValue({user:{isOperator:true}});mocks.read.mockResolvedValue({enabled:false,apiKey:null})})
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()})
it('requires a local operator and same-origin writes',async()=>{
 mocks.auth.mockResolvedValueOnce(null)
 expect((await GET(new Request(url))).status).toBe(401)
 expect((await POST(post({action:'remove'},'https://other.test'))).status).toBe(403)
 vi.stubEnv('NODE_ENV','production')
 mocks.prodRead.mockResolvedValue({enabled:false,apiKey:null})
 expect((await GET(new Request(url))).status).toBe(200)
 expect(mocks.write).not.toHaveBeenCalled()
})
it('does not enable without a key, saves masked status, and removes with disable',async()=>{
 expect((await POST(post({action:'save',enabled:true}))).status).toBe(400)
 const key='sk-test-placeholder-abcdefghijkl1234'
 const response=await POST(post({action:'save',enabled:true,apiKey:key}))
 expect(await response.json()).toEqual({enabled:true,configured:true,suffix:'1234'})
 expect(mocks.write).toHaveBeenCalledWith({enabled:true,apiKey:key})
 await POST(post({action:'remove'}))
 expect(mocks.write).toHaveBeenLastCalledWith({enabled:false,apiKey:null})
})
it('checks a saved key with a read-only request and never returns it',async()=>{
 mocks.read.mockResolvedValue({enabled:true,apiKey:'secret-1234'})
 const fetch=vi.fn().mockResolvedValue({ok:true});vi.stubGlobal('fetch',fetch)
 const response=await POST(post({action:'test'}))
 expect(await response.text()).not.toContain('secret-1234')
 expect(fetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/models/gpt-image-2')
 expect(mocks.write).not.toHaveBeenCalled()
})
it('accepts the browser Host when Next normalizes its internal request URL', async()=>{
 const req=new Request('http://localhost:3014/api/internal/avatar-settings',{method:'POST',headers:{host:'127.0.0.1:3014',origin:'http://127.0.0.1:3014'},body:JSON.stringify({action:'test'})})
 const response=await POST(req)
 expect(response.status).toBe(400)
 expect(await response.json()).toEqual({error:'Save an OpenAI key first.'})
 expect(mocks.write).not.toHaveBeenCalled()
})

it('production accepts only admin-origin mutations and returns only masked status',async()=>{
 vi.stubEnv('NODE_ENV','production');mocks.prodRead.mockResolvedValue({enabled:false,apiKey:null})
 expect((await POST(post({action:'save',enabled:true,apiKey:'sk-example-secret-abcdefghijklmnop'},'https://other.test'))).status).toBe(403)
 const r=await POST(post({action:'save',enabled:true,apiKey:'sk-example-secret-abcdefghijklmnop'},'https://admin.padelnachos.com'))
 expect(r.status).toBe(200);expect(await r.text()).not.toContain('sk-example-secret')
 expect(mocks.prodWrite).toHaveBeenCalled();expect(mocks.write).not.toHaveBeenCalled()
})

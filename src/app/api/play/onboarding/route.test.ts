import {beforeEach,it,expect,vi} from 'vitest'
const m=vi.hoisted(()=>({access:vi.fn(),rpc:vi.fn(),from:vi.fn()}))
vi.mock('@/lib/play-access',()=>({requirePlayAccess:m.access}))
vi.mock('../_shared',()=>({playNotFound:()=>Response.json({error:'not_found'},{status:404})}))
import {GET,POST} from './route'
const req=(body:object,origin='http://localhost:3015')=>new Request('http://localhost:3015/api/play/onboarding',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)})
beforeEach(()=>{vi.clearAllMocks();m.access.mockResolvedValue({userId:'me',supabase:{rpc:m.rpc,from:m.from}});m.rpc.mockResolvedValue({error:null})})
it('keeps all onboarding data behind whitelist',async()=>{m.access.mockResolvedValue(null);expect((await GET()).status).toBe(404);expect((await POST(req({}))).status).toBe(404);expect(m.from).not.toHaveBeenCalled()})
it('rejects cross-origin writes',async()=>{expect((await POST(req({action:'identity',name:'Alex',avatar:'face-01'},'https://evil.example'))).status).toBe(403);expect(m.rpc).not.toHaveBeenCalled()})
it('uses session identity and only saves a valid roster face',async()=>{const response=await POST(req({action:'identity',name:'  Alex  ',avatar:'face-03',userId:'victim',balance:99999}));expect(response.status).toBe(200);expect(m.rpc).toHaveBeenCalledWith('play_onboarding_identity',{p_user:'me',p_name:'Alex',p_avatar:'face-03'});expect(response.headers.get('cache-control')).toBe('private, no-store')})
it('rejects invalid names and avatars before writes',async()=>{for(const body of [{name:'x@y.com',avatar:'face-01'},{name:'Alex',avatar:'custom:fake'},{name:'',avatar:'face-01'}])expect((await POST(req({action:'identity',...body}))).status).toBe(400);expect(m.rpc).not.toHaveBeenCalled()})
it('does not report a failed transaction as saved',async()=>{m.rpc.mockResolvedValue({error:{message:'failed'}});expect((await POST(req({action:'identity',name:'Alex',avatar:'face-01'}))).status).toBe(503)})
function reads(progress:unknown,trades:unknown[],fail=false){
 m.from.mockImplementation((table:string)=>{
  const result={data:table==='play_onboarding'?progress:table==='profiles'?{display_name:'Alex'}:table==='play_wardrobes'?{avatar:'face-03'}:trades,error:fail?{message:'offline'}:null}
  const chain={select:vi.fn(),eq:vi.fn(),single:vi.fn(),maybeSingle:vi.fn(),limit:vi.fn()}
  chain.select.mockReturnValue(chain);chain.eq.mockImplementation((field,id)=>{expect(id).toBe('me');return chain});chain.single.mockResolvedValue(result);chain.maybeSingle.mockResolvedValue(result);chain.limit.mockResolvedValue(result)
  return chain
 })
}
it('starts new players at identity with their current name and avatar',async()=>{reads(null,[]);expect(await(await GET()).json()).toEqual({step:'identity',name:'Alex',avatar:'face-03'})})
it('does not force existing players through identity setup',async()=>{reads(null,[{id:'trade'}]);expect((await(await GET()).json()).step).toBe('done')})
it('resumes saved progress on another device',async()=>{reads({step:'wallet'},[]);expect((await(await GET()).json()).step).toBe('wallet')})
it('does not invent progress when reads fail',async()=>{reads(null,[],true);expect((await GET()).status).toBe(503)})

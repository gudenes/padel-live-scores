import {beforeEach,it,expect,vi} from 'vitest'
const m=vi.hoisted(()=>({access:vi.fn(),from:vi.fn()}))
vi.mock('@/lib/play-access',()=>({requirePlayAccess:m.access}))
vi.mock('../_shared',()=>({playNotFound:()=>Response.json({error:'not_found'},{status:404})}))
import {GET,POST} from './route'
const req=(body:object,origin='http://localhost:3016')=>new Request('http://localhost:3016/api/play/results',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)})
const chain:any={}
function data(rows:unknown[],error:unknown=null){for(const name of ['select','update','eq','in','gte','order'])chain[name]=vi.fn(()=>chain);chain.limit=vi.fn().mockResolvedValue({data:rows,error});chain.is=vi.fn().mockResolvedValue({error});m.from.mockReturnValue(chain)}
beforeEach(()=>{vi.clearAllMocks();m.access.mockResolvedValue({userId:'me',supabase:{from:m.from}});data([])})
it('gates reads and writes to whitelisted users',async()=>{m.access.mockResolvedValue(null);expect((await GET()).status).toBe(404);expect((await POST(req({id:'n'}))).status).toBe(404);expect(m.from).not.toHaveBeenCalled()})
it('scopes dismissal to the current user and settlement category',async()=>{expect((await POST(req({id:'n',userId:'someone'}))).status).toBe(200);expect(chain.eq).toHaveBeenCalledWith('user_id','me');expect(chain.eq).toHaveBeenCalledWith('category','play_result');expect(chain.in).toHaveBeenCalledWith('id',['n'])})
it('rejects cross-origin writes and invalid ids',async()=>{expect((await POST(req({id:'n'},'https://evil.example'))).status).toBe(403);expect((await POST(req({id:7}))).status).toBe(400);expect(m.from).not.toHaveBeenCalled()})
it('does not replay an old unread revision once a newer result was read',async()=>{data([{id:'new',metadata:{market_id:'m'},read_at:'now'},{id:'old',metadata:{market_id:'m'},read_at:null},{id:'other',metadata:{market_id:'b'},read_at:null}]);const r=await GET();expect((await r.json()).items.map((n:any)=>n.id)).toEqual(['other']);expect(r.headers.get('cache-control')).toBe('private, no-store');expect(chain.eq).toHaveBeenCalledWith('user_id','me')})
it('does not report failed reads or writes as successful',async()=>{data([],{message:'offline'});expect((await GET()).status).toBe(503);expect((await POST(req({id:'n'}))).status).toBe(503)})

it('marks only the supplied batch read',async()=>{expect((await POST(req({ids:['a','b']}))).status).toBe(200);expect(chain.in).toHaveBeenCalledWith('id',['a','b']);expect(chain.eq).toHaveBeenCalledWith('user_id','me');expect((await POST(req({ids:[]}))).status).toBe(400)})

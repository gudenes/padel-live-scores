import {beforeEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({auth:vi.fn(),data:vi.fn()}))
vi.mock('@/lib/auth',()=>({auth:mocks.auth}))
vi.mock('@/lib/scouting/intelligence/data',()=>({intelligenceData:mocks.data}))
import {GET} from '@/app/api/internal/scouting/[id]/pregame/route'
const id='11111111-1111-4111-8111-111111111111'
const call=(suffix='')=>GET(new Request('http://localhost/api/internal/scouting/'+id+'/pregame'+suffix),{params:Promise.resolve({id})})
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({user:{isOperator:true}})})
it('rejects anonymous requests before reading history',async()=>{mocks.auth.mockResolvedValue(null);expect((await call()).status).toBe(401);expect(mocks.data).not.toHaveBeenCalled()})
it('rejects malformed year filters',async()=>{expect((await call('?year=all')).status).toBe(400);expect(mocks.data).not.toHaveBeenCalled()})
it('never exposes a private match through the official endpoint',async()=>{mocks.data.mockResolvedValue({history:[{id,manual:true}]});expect((await call()).status).toBe(404)})
it('reports incomplete rosters without fabricating a comparison',async()=>{mocks.data.mockResolvedValue({history:[{id,manual:false,date:'2026-10-27',playerIds:['a',null,'c','d']}]});expect((await call()).status).toBe(422)})
it('returns a retryable error without leaking database details',async()=>{mocks.data.mockRejectedValue(new Error('db failed'));const spy=vi.spyOn(console,'error').mockImplementation(()=>{});const response=await call();expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'Pre-game comparison could not be loaded. Please retry.'});spy.mockRestore()})

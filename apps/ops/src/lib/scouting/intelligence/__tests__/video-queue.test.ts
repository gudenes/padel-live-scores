import {beforeEach,describe,it,expect,vi} from 'vitest'
const {query,auth}=vi.hoisted(()=>({query:vi.fn(),auth:vi.fn()}))
vi.mock('@/lib/auth',()=>({auth}))
vi.mock('@/lib/db',()=>({pgPool:()=>({query})}))
vi.mock('@/lib/scouting-permissions',()=>({canViewReports:(u:unknown)=>!!u}))
import {GET} from '@/app/api/internal/scouting-intelligence/video-status/route'
const match='386b5bd2-9dca-4bae-ba32-5482ba0dbdbd'
beforeEach(()=>{query.mockReset();auth.mockReset();auth.mockResolvedValue({user:{id:'owner',isOperator:true}})})
describe('video queue visibility',()=>{
 it('requires authentication',async()=>{auth.mockResolvedValue(null);expect((await GET(new Request('http://localhost/api'))).status).toBe(401);expect(query).not.toHaveBeenCalled()})
 it('ranks the complete waiting queue without counting the running job',async()=>{
  const job=(id:string,status:string)=>({id,status,owner_user_id:'owner',match_id:match,match_kind:'canonical',names:['A','B','C','D'],online:true,stage:'players',progress:{processed:42,total:100}})
  query.mockResolvedValueOnce({rows:[job('running','running'),job('elsewhere','queued'),job('visible','queued')]}).mockResolvedValueOnce({rows:[{key:`canonical:${match}`,id:'visible',status:'queued',owner_user_id:'owner'}]})
  const body=await (await GET(new Request(`http://localhost/api?matches=canonical:${match}`))).json()
  expect(body.statuses[`canonical:${match}`]).toMatchObject({state:'queued',position:2,owned:true})
  expect(body.queue[0]).toMatchObject({state:'processing',percent:42})
  expect(query.mock.calls[0][1]).toEqual(['owner'])
 })
 it('preserves ready results and hides other owners’ queue positions',async()=>{
  query.mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{key:'ready',ready:true,status:'running'},{key:'other',status:'queued',owner_user_id:'someone-else'}]})
  const body=await (await GET(new Request(`http://localhost/api?matches=canonical:${match}`))).json()
  expect(body.statuses.ready).toEqual({state:'ready'})
  expect(body.statuses.other).toEqual({state:'queued',owned:false})
  expect(body.queue).toEqual([])
 })
})

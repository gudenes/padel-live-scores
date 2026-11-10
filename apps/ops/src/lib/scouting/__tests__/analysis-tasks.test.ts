import {beforeEach,describe,it,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({auth:vi.fn(),query:vi.fn()}))
vi.mock('@/lib/auth',()=>({auth:mocks.auth}))
vi.mock('@/lib/db',()=>({pgPool:()=>({query:mocks.query})}))
vi.mock('@/lib/scouting/analysis-estimate',()=>({estimateAnalysis:()=>null}))
import {GET} from '@/app/api/internal/lab-vision/tasks/route'
describe('personal analysis tasks',()=>{
 beforeEach(()=>vi.clearAllMocks())
 it('requires an authorized signed-in operator',async()=>{mocks.auth.mockResolvedValue(null);expect((await GET()).status).toBe(403);expect(mocks.query).not.toHaveBeenCalled()})
 it('scopes tasks to the initiating account and omits sensitive job fields',async()=>{mocks.auth.mockResolvedValue({user:{id:'owner',isOperator:true}});mocks.query.mockResolvedValue({rows:[{id:'job',status:'running',stage:'players',match_id:'match',file_name:'final.mp4',setup:{secret:'not returned'}}]});const r=await GET(),d=await r.json();expect(mocks.query.mock.calls[0][0]).toContain('j.owner_user_id=$1');expect(mocks.query.mock.calls[0][1]).toEqual(['owner']);expect(d.tasks[0].href).toBe('/scouting/match/report?analysis=1');expect(d.tasks[0].setup).toBeUndefined()})
})

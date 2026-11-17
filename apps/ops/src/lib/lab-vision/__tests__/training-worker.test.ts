import {beforeEach,describe,it,expect,vi} from 'vitest'
const m=vi.hoisted(()=>({query:vi.fn(),tx:vi.fn(),operator:vi.fn(),body:vi.fn(),release:vi.fn()}))
vi.mock('@/lib/db',()=>({pgPool:()=>({query:m.query,connect:async()=>({query:m.tx,release:m.release})})}))
vi.mock('@/lib/operators',()=>({isUserOperator:m.operator}))
vi.mock('@/lib/lab-vision-jobs',()=>({jobBody:m.body}))
import {POST} from '../../../app/api/lab-vision/training-worker/route'
const request=()=>new Request('https://admin.padelnachos.com/api/lab-vision/training-worker',{method:'POST',headers:{authorization:'Bearer '+'a'.repeat(64)}})
let plan:any
beforeEach(()=>{vi.resetAllMocks();plan={id:'p',execution:'local',createdBy:'owner',workerId:'w',status:'awaiting_approval'};m.query.mockResolvedValue({rows:[{id:'w',owner_user_id:'owner'}]});m.operator.mockResolvedValue(true);m.body.mockResolvedValue({action:'poll',id:'p'});m.tx.mockImplementation(async(q:string)=>({rows:q.includes('for update')?[plan]:[]}))})
describe('Local worker claims',()=>{
 it('requires bearer credentials and an active operator-owned worker',async()=>{expect((await POST(new Request('https://example.com'))).status).toBe(401);expect(m.query).not.toHaveBeenCalled();m.operator.mockResolvedValue(false);expect((await POST(request())).status).toBe(401);expect(m.tx).not.toHaveBeenCalled()})
 it('polling never starts an unapproved plan',async()=>{m.tx.mockImplementation(async(q:string)=>({rows:q.includes('for update')?[{payload:plan}]:[]}));const r=await (await POST(request())).json();expect(r.status).toBe('awaiting_approval');expect(r.claimed).toBe(false);expect(r.attemptId).toBeUndefined()})
 it('claims an approved plan once and does not re-claim running work',async()=>{plan.status='queued';m.tx.mockImplementation(async(q:string,args:any[])=>{if(q.startsWith('update'))plan=args[1];return {rows:q.includes('for update')?[{payload:plan}]:[]}});const first=await (await POST(request())).json();expect(first.status).toBe('running');expect(first.claimed).toBe(true);expect(first.attemptId).toBeTruthy();const second=await (await POST(request())).json();expect(second.claimed).toBe(false);expect(second.attemptId).toBe(first.attemptId)})
 it('rejects another worker and stale progress after cancellation',async()=>{m.tx.mockImplementation(async(q:string)=>({rows:q.includes('for update')?[{payload:plan}]:[]}));plan.workerId='other';expect((await POST(request())).status).toBe(400);plan.workerId='w';plan.status='cancelled';m.body.mockResolvedValue({action:'progress',id:'p',attemptId:'old',epoch:1,loss:1,validationLoss:1});expect((await POST(request())).status).toBe(400);expect(m.tx.mock.calls.some(([q])=>q.startsWith('update'))).toBe(false)})
 it('scopes snapshot reads to worker owner',async()=>{m.body.mockResolvedValue({action:'snapshot',snapshotId:'s'});expect((await POST(request())).status).toBe(400);expect(m.tx.mock.calls.find(([q])=>q.includes("kind='snapshot'"))?.[1]).toEqual(['s','owner'])})
})

describe('Persistent preparation discovery',()=>{
 it('claims only owner-scoped pending preparation and does not approve training',async()=>{m.body.mockResolvedValue({action:'discover'});const pending={id:'new-plan',createdBy:'owner',snapshotId:'new-snapshot',execution:'local',status:'preparing'};m.tx.mockImplementation(async(q:string)=>({rows:q.includes('skip locked')?[{id:'new-plan',payload:pending}]:[]}));const r=await (await POST(request())).json();expect(r).toEqual({snapshotId:'new-snapshot',planId:'new-plan'});const query=m.tx.mock.calls.find(([q])=>q.includes('skip locked'));expect(query?.[1]).toEqual(['owner','w']);expect(query?.[0]).toContain("payload->>'status' in ('preparing','awaiting_approval','queued','running')");const update=m.tx.mock.calls.find(([q])=>q.startsWith('update'));expect(update?.[1][1]).toMatchObject({status:'preparing',workerId:'w'});expect(update?.[1][1].approvedAt).toBeUndefined()})
 it('returns idle when there is no pending request',async()=>{m.tx.mockResolvedValue({rows:[]});m.body.mockResolvedValue({action:'discover'});expect(await (await POST(request())).json()).toEqual({snapshotId:null});expect(m.tx.mock.calls.some(([q])=>q.startsWith('update'))).toBe(false)})
})

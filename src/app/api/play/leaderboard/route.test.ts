import {beforeEach,expect,it,vi} from 'vitest'
const m=vi.hoisted(()=>({access:vi.fn(),from:vi.fn(),season:vi.fn(),sim:vi.fn(),rows:{} as Record<string,unknown[]>,calls:[] as Array<[string,string,unknown[]]>}))
vi.mock('@/lib/play-access',()=>({requirePlayAccess:m.access}))
vi.mock('../_shared',()=>({getActiveSeason:m.season,playNotFound:()=>Response.json({}, {status:404})}))
vi.mock('@/lib/local-simulation-leaders',()=>({localSimulationLeaders:m.sim}))
vi.mock('@/lib/leaderboard-week',()=>({leaderboardWeek:()=>({start:'2026-10-05T00:00:00Z',end:'2026-10-12T00:00:00Z'})}))
import {GET} from './route'
beforeEach(()=>{
 vi.clearAllMocks();m.calls=[]
 m.rows={markets:[],market_trades:[{user_id:'pending'},{user_id:'pending'}],profiles:[]}
 m.from.mockImplementation((table:string)=>{
  const q:Record<string,unknown>={then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:m.rows[table]??[],error:null}).then(resolve)}
  for(const method of ['select','eq','not','order','range','gte','lt','in'])q[method]=(...args:unknown[])=>{m.calls.push([table,method,args]);return q}
  return q
 })
 m.access.mockResolvedValue({supabase:{from:m.from},userId:'pending'})
 m.season.mockResolvedValue({id:'season'});m.sim.mockResolvedValue([])
})
it('includes a weekly participant once at zero before any result settles',async()=>{
 const data=await(await GET(new Request('https://test/api/play/leaderboard?period=week'))).json()
 expect(data.rows).toHaveLength(1)
 expect(data.me).toMatchObject({userId:'pending',netWinnings:0,rank:1})
 expect(m.calls).toContainEqual(['market_trades','eq',['direction','buy']])
 expect(m.calls).toContainEqual(['market_trades','gte',['created_at','2026-10-05T00:00:00Z']])
 expect(m.calls).toContainEqual(['market_trades','lt',['created_at','2026-10-12T00:00:00Z']])
})
it('keeps settled gains and losses when adding weekly participants',async()=>{
 m.rows.markets=[{id:'match'}]
 m.rows.market_positions=[{user_id:'winner',market_id:'match',cost_basis:100},{user_id:'loser',market_id:'match',cost_basis:100}]
 m.rows.market_payouts=[{user_id:'winner',market_id:'match',yes_paid:250,no_paid:0},{user_id:'loser',market_id:'match',yes_paid:0,no_paid:0}]
 m.rows.market_trades=[{user_id:'winner'},{user_id:'loser'},{user_id:'pending'}]
 const data=await(await GET(new Request('https://test/api/play/leaderboard?period=week'))).json()
 expect(data.rows.map((r:{userId:string;netWinnings:number})=>[r.userId,r.netWinnings])).toEqual([['winner',150],['pending',0],['loser',-100]])
})
it('preserves season eligibility based on settlement',async()=>{
 const data=await(await GET(new Request('https://test/api/play/leaderboard?period=season'))).json()
 expect(data.rows).toEqual([])
 expect(m.from).not.toHaveBeenCalledWith('market_trades')
})

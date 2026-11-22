import {beforeEach,expect,it,vi} from 'vitest'
const m=vi.hoisted(()=>({access:vi.fn(),from:vi.fn(),season:vi.fn(),sim:vi.fn(),rows:{} as Record<string,unknown[]>,calls:[] as Array<[string,string,unknown[]]>}))
vi.mock('@/lib/play-access',()=>({requirePlayAccess:m.access}))
vi.mock('../_shared',()=>({getActiveSeason:m.season,playNotFound:()=>Response.json({}, {status:404})}))
vi.mock('@/lib/local-simulation-leaders',()=>({loadSimulationLeaderboard:async()=>({activityDates:[],leaders:m.sim})}))
import {leaderboardWeek} from '@/lib/leaderboard-week'
import {GET} from './route'
beforeEach(()=>{
 vi.clearAllMocks();m.calls=[]
 m.rows={markets:[],market_trades:[{user_id:'pending',created_at:new Date().toISOString()},{user_id:'pending',created_at:new Date().toISOString()}],profiles:[]}
 m.from.mockImplementation((table:string)=>{
  const q:Record<string,unknown>={then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:m.rows[table]??[],error:null}).then(resolve)}
  for(const method of ['select','eq','not','order','range','gte','lt','in'])q[method]=(...args:unknown[])=>{m.calls.push([table,method,args]);return q}
  return q
 })
 m.access.mockResolvedValue({supabase:{from:m.from},userId:'pending'})
 m.season.mockResolvedValue({id:'season'});m.sim.mockReturnValue([])
})
it('includes a weekly participant once at zero before any result settles',async()=>{
 const data=await(await GET(new Request('https://test/api/play/leaderboard?period=week'))).json()
 expect(data.rows).toHaveLength(1)
 expect(data.me).toMatchObject({userId:'pending',netWinnings:0,rank:1})
 expect(m.calls).toContainEqual(['market_trades','eq',['direction','buy']])
 expect(m.calls).toContainEqual(['market_trades','gte',['created_at',leaderboardWeek().start]])
 expect(m.calls).toContainEqual(['market_trades','lt',['created_at',leaderboardWeek().end]])
})
it('keeps settled gains and losses when adding weekly participants',async()=>{
 m.rows.markets=[{id:'match',settled_at:new Date().toISOString()}]
 m.rows.market_positions=[{user_id:'winner',market_id:'match',cost_basis:100},{user_id:'loser',market_id:'match',cost_basis:100}]
 m.rows.market_payouts=[{user_id:'winner',market_id:'match',yes_paid:250,no_paid:0},{user_id:'loser',market_id:'match',yes_paid:0,no_paid:0}]
 m.rows.market_trades=[{user_id:'winner',created_at:new Date().toISOString()},{user_id:'loser',created_at:new Date().toISOString()},{user_id:'pending',created_at:new Date().toISOString()}]
 const data=await(await GET(new Request('https://test/api/play/leaderboard?period=week'))).json()
 expect(data.rows.map((r:{userId:string;netWinnings:number})=>[r.userId,r.netWinnings])).toEqual([['winner',150],['pending',0],['loser',-100]])
})
it('preserves season eligibility based on settlement',async()=>{
 const data=await(await GET(new Request('https://test/api/play/leaderboard?period=season'))).json()
 expect(data.rows).toEqual([])
 expect(m.from).not.toHaveBeenCalledWith('market_trades')
})

it('returns the latest active week and skips empty gaps in history',async()=>{
 m.rows.market_trades = [{user_id:'pending',created_at:leaderboardWeek(2).start},{user_id:'pending',created_at:leaderboardWeek(5).start}]
 const data = await (await GET(new Request('https://test/api/play/leaderboard?period=week'))).json()
 expect(data).toMatchObject({weekOffset:2,previousWeek:5,nextWeek:null})
 expect(m.calls).toContainEqual(['market_trades','gte',['created_at',leaderboardWeek(2).start]])
 const older = await (await GET(new Request('https://test/api/play/leaderboard?period=week&week=5'))).json()
 expect(older).toMatchObject({weekOffset:5,previousWeek:null,nextWeek:2})
})
it('returns bounded empty history when nobody has played',async()=>{
 m.rows.market_trades=[]
 const data=await(await GET(new Request('https://test/api/play/leaderboard?period=week'))).json()
 expect(data).toMatchObject({weekOffset:0,previousWeek:null,nextWeek:null,rows:[]})
})

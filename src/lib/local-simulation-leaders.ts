import {leaderboardWeek} from './leaderboard-week'
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { simulationStoragePath } from './simulation-storage'
import type { SupabaseClient } from '@supabase/supabase-js'
import { simulationDisplayName } from './local-market-activity'
import { paginatedSelect } from './db-paginate'

export interface SimulationLeader { userId: string; displayName: string; avatarSeed: string; netWinnings: number; isSimulation: true; prizeEligible: false }
interface Bot { id: string; name: string }
interface Holding { bot_id: string; source_market_id: string | null; side: string; shares: number; cost: number }
interface Result { id:string; status:string; outcome:boolean|null; settled_at:string|null; season_id:string }

/** Use the same confirmed source results and settlement window as human players.
 * Ignore wallet grants, open holdings and stale local resolution copies. */
export async function localSimulationLeaders(req: Request, supabase: SupabaseClient, period: string, seasonId: string | null = null, weekOffset=0): Promise<SimulationLeader[]> {
  let bots: Bot[], holdings: Holding[]
  if (process.env.NODE_ENV === 'production' && process.env.PLAY_SIMULATION_ENABLED === 'true') {
    const [botRows, positionRows, marketRows] = await Promise.all([
      paginatedSelect<Bot>((a,b)=>supabase.from('play_sim_bots').select('id,name').eq('prize_eligible',0).order('id').range(a,b),{what:'simulation players'}),
      paginatedSelect<{bot_id:string;market_id:string;side:string;shares:number;cost:number}>((a,b)=>supabase.from('play_sim_positions').select('bot_id,market_id,side,shares,cost').order('bot_id').order('market_id').order('side').range(a,b),{what:'simulation positions'}),
      paginatedSelect<{id:string;source_market_id:string|null}>((a,b)=>supabase.from('play_sim_markets').select('id,source_market_id').order('id').range(a,b),{what:'simulation markets'}),
    ])
    bots=botRows
    const sources=new Map(marketRows.map(m=>[m.id,m.source_market_id]))
    holdings=positionRows.map(p=>({...p,source_market_id:sources.get(p.market_id)??null}))
  } else {
    const file=simulationStoragePath(req)
    if (!file || !existsSync(file)) return []
    const db=new DatabaseSync(file,{readOnly:true})
    try {
      bots=db.prepare('SELECT id,name FROM bots WHERE prize_eligible=0').all() as unknown as Bot[]
      holdings=db.prepare(`SELECT p.bot_id,p.side,p.shares,p.cost,m.source_market_id
        FROM positions p JOIN markets m ON m.id=p.market_id`).all() as unknown as Holding[]
    } finally {db.close()}
  }
  const ids=[...new Set(holdings.map(p=>p.source_market_id).filter((id):id is string=>!!id))]
  const results:Result[]=[]
  for(let offset=0;offset<ids.length;offset+=200) {
    const {data,error}=await supabase.from('markets').select('id,status,outcome,settled_at,season_id').in('id',ids.slice(offset,offset+200))
    if(error) throw new Error('Could not load simulation results')
    results.push(...(data??[]) as Result[])
  }
  const scores=simulationNetWinnings(holdings,results,period,seasonId,Date.now(),weekOffset)
  return bots.filter(b=>scores.has(b.id)).map(b=>({userId:`sim:${b.id}`,displayName:simulationDisplayName(b.name),avatarSeed:b.id,
    netWinnings:scores.get(b.id)!,isSimulation:true,prizeEligible:false}))
}

export function simulationNetWinnings(holdings:Holding[],results:Result[],period:string,seasonId:string|null,now=Date.now(),weekOffset=0) {
  const week=leaderboardWeek(weekOffset,new Date(now))
  const eligible=new Map(results.filter(m=>m.status==='settled' && typeof m.outcome==='boolean' && m.settled_at &&
    (period!=='season'||m.season_id===seasonId) && (period!=='week'||(m.settled_at>=week.start && m.settled_at<week.end))).map(m=>[m.id,m]))
  const scores=new Map<string,number>()
  for(const p of holdings) {
    const result=p.source_market_id?eligible.get(p.source_market_id):undefined
    if(!result) continue
    const paid=result.outcome===(p.side==='yes')?Math.floor(p.shares):0
    scores.set(p.bot_id,(scores.get(p.bot_id)??0)+paid-Number(p.cost))
  }
  return scores
}

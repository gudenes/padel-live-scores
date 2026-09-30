import { predictionBadgeCounts } from './prediction-badges'
import type { createServiceClient } from './supabase'

type Client = ReturnType<typeof createServiceClient>
// Range every query: lifetime progress must not silently stop at Supabase's row limit.
async function pages<T>(read: (from:number,to:number)=>PromiseLike<{data:T[]|null;error:unknown}>) {
  const rows:T[] = []
  for(let from=0;;from+=500) {
    const {data,error} = await read(from,from+499)
    if(error) throw new Error('Badge progress unavailable')
    rows.push(...(data ?? []))
    if(!data || data.length<500) return rows
  }
}
export async function getPredictionBadgeProgress(db:Client,userId:string) {
  const [positions,payouts,notices] = await Promise.all([
    pages((a,b)=>db.from('market_positions').select('market_id,cost_basis').eq('user_id',userId).order('market_id').range(a,b)),
    pages((a,b)=>db.from('market_payouts').select('market_id,yes_paid,no_paid,revision').eq('user_id',userId).order('market_id').range(a,b)),
    pages((a,b)=>db.from('play_result_notices').select('market_id,created_at').eq('user_id',userId).eq('revision',1).order('market_id').range(a,b)),
  ])
  const paid = new Map(payouts.map(p=>[p.market_id,p]))
  const initialTime = new Map(notices.map(n=>[n.market_id,n.created_at]))
  const markets = []
  for(let i=0;i<positions.length;i+=100) {
    const {data,error} = await db.from('markets').select('id,status,settled_at,settlement_revision,tournament_id,match:matches!markets_match_id_fkey(tournament_id)').in('id',positions.slice(i,i+100).map(p=>p.market_id))
    if(error) throw new Error('Badge market progress unavailable')
    markets.push(...(data??[]))
  }
  const marketById = new Map(markets.map(m=>[m.id,m]))
  return predictionBadgeCounts(positions.flatMap(p=>{
    const m = marketById.get(p.market_id), payout = paid.get(p.market_id)
    if(!m || !payout || !m.settled_at) return []
    const match = Array.isArray(m.match) ? m.match[0] : m.match
    return [{marketId:m.id,tournamentId:m.tournament_id ?? match?.tournament_id ?? null,settledAt:initialTime.get(m.id) ?? m.settled_at,status:m.status,cost:p.cost_basis,paid:payout.yes_paid+payout.no_paid,revision:m.settlement_revision,payoutRevision:payout.revision}]
  }))
}

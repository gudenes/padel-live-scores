/** Sum authoritative latest payouts once per retained market position. */
export function settledNetWinnings(
  positions: {user_id:string;market_id:string;cost_basis:number}[],
  payouts: {user_id:string;market_id:string;yes_paid:number;no_paid:number}[],
) {
  const costs=new Map(positions.map(p=>[`${p.market_id}:${p.user_id}`,Number(p.cost_basis)]))
  const latest=new Map(payouts.map(p=>[`${p.market_id}:${p.user_id}`,p]))
  const scores=new Map<string,number>()
  for(const [key,p] of latest) {
    const cost=costs.get(key)
    if(cost===undefined) continue
    scores.set(p.user_id,(scores.get(p.user_id)??0)+Number(p.yes_paid)+Number(p.no_paid)-cost)
  }
  return scores
}

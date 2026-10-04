import { requirePlayAccess } from '@/lib/play-access'
import { paginatedSelect } from '@/lib/db-paginate'
import { predictionRate, type PredictionRateRow } from '@/lib/prediction-rate'
export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }
export async function GET(req: Request) {
  const access = await requirePlayAccess()
  const reply = (data: unknown, status = 200) => Response.json(data, { status, headers })
  if (!access) return reply({ error: 'not_found' }, 404)
  const target = new URL(req.url).searchParams.get('userId') ?? access.userId
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(target)) return reply({ error: 'invalid_target' }, 400)
  const db = access.supabase
  const member = await db.from('play_access').select('user_id').eq('user_id', target).maybeSingle()
  if (member.error) return reply({ error: 'unavailable' }, 503)
  if (!member.data) return reply({ error: 'not_found' }, 404)
  try {
    const [positions, payouts] = await Promise.all([
      paginatedSelect<{ market_id: string; yes_shares: number; no_shares: number }>((a,b) => db.from('market_positions').select('market_id,yes_shares,no_shares').eq('user_id',target).order('market_id').range(a,b), {what:'prediction rate positions'}),
      paginatedSelect<{ market_id: string; revision: number }>((a,b) => db.from('market_payouts').select('market_id,revision').eq('user_id',target).order('market_id').range(a,b), {what:'prediction rate payouts'}),
    ])
    const paid = new Map(payouts.map(p => [p.market_id,p.revision]))
    const eligible = positions.filter(p => paid.has(p.market_id))
    const rows: PredictionRateRow[] = []
    for (let i=0; i<eligible.length; i+=100) {
      const batch = eligible.slice(i,i+100)
      const {data,error} = await db.from('markets').select('id,status,outcome,settlement_revision').in('id',batch.map(p=>p.market_id))
      if(error) throw error
      for(const m of data ?? []) {
        const p = batch.find(p=>p.market_id===m.id)!
        rows.push({status:m.status,outcome:m.outcome,revision:m.settlement_revision,payoutRevision:paid.get(m.id)!,yesShares:Number(p.yes_shares),noShares:Number(p.no_shares)})
      }
    }
    return reply(predictionRate(rows))
  } catch { return reply({error:'unavailable'},503) }
}

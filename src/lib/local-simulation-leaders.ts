import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { simulationStoragePath } from './simulation-storage'
import type { SupabaseClient } from '@supabase/supabase-js'
import { priceYes } from './lmsr'
import { simulationDisplayName } from './local-market-activity'

export interface SimulationLeader { userId: string; displayName: string; avatarSeed: string; netWorth: number; isSimulation: true; prizeEligible: false }
interface Bot { id: string; name: string; balance: number }
interface Holding { bot_id: string; source_market_id: string | null; status: string; side: string; shares: number; cost: number; q_yes: number; q_no: number; b: number }

/** Local simulation wallets are read-only and never enter the prize ranking. */
export async function localSimulationLeaders(req: Request, supabase: SupabaseClient, period: string): Promise<SimulationLeader[]> {
  const file = simulationStoragePath(req)
  if (!file || !existsSync(file)) return []
  const db = new DatabaseSync(file, { readOnly: true })
  let bots: Bot[], holdings: Holding[]
  try {
    // Season/all include enrolled wallets. Week matches the human activity filter.
    bots = db.prepare(`SELECT b.id,b.name,b.balance FROM bots b WHERE b.prize_eligible=0
      AND (? = 0 OR EXISTS(SELECT 1 FROM trades t WHERE t.bot_id=b.id AND t.created_at>=?))`)
      .all(period === 'week' ? 1 : 0, Date.now()-7*86400000) as unknown as Bot[]
    holdings = db.prepare(`SELECT p.bot_id,p.side,p.shares,p.cost,m.source_market_id,m.status,m.q_yes,m.q_no,m.b
      FROM positions p JOIN markets m ON m.id=p.market_id WHERE m.status='open'`).all() as unknown as Holding[]
  } finally { db.close() }
  const ids = [...new Set(holdings.map(p => p.source_market_id).filter((id): id is string => !!id))]
  const source = ids.length ? await supabase.from('markets').select('id,status,outcome').in('id', ids) : { data: [], error: null }
  if (source.error) throw new Error('Could not value local simulation holdings')
  const outcomes = new Map((source.data ?? []).map(m => [m.id, m]))
  const values = new Map(bots.map(b => [b.id, b.balance]))
  for (const p of holdings) {
    if (!values.has(p.bot_id)) continue
    const m = p.source_market_id ? outcomes.get(p.source_market_id) : null
    const price = priceYes(p.q_yes, p.q_no, p.b)
    // A confirmed result values unpaid simulation shares at their final
    // entitlement. Locally settled positions are excluded above (already cash).
    const value = m?.status === 'void' ? p.cost
      : m?.status === 'settled' && typeof m.outcome === 'boolean'
        ? m.outcome === (p.side === 'yes') ? Math.floor(p.shares) : 0
        : p.shares * (p.side === 'yes' ? price : 1-price)
    values.set(p.bot_id, values.get(p.bot_id)! + value)
  }
  return bots.map(b => ({ userId: `sim:${b.id}`, displayName: simulationDisplayName(b.name), avatarSeed: b.id,
    netWorth: values.get(b.id)!, isSimulation: true, prizeEligible: false }))
}

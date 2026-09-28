import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { simulationStoragePath } from './simulation-storage'

const SIM_NAMES = ['Chispa', 'Rayo', 'Brasa', 'Ziggy', 'Nova', 'Nacho', 'Mika', 'Dash', 'Coco', 'Ace']
export function simulationDisplayName(name: string) {
  const legacy = /^Bot (\d+)$/i.exec(name)
  if (!legacy) return name
  const number = Number(legacy[1])
  return `${SIM_NAMES[(number - 1) % SIM_NAMES.length]}${number}`
}

/** Read existing simulation trades only. Never creates or changes the ledger. */
export function localMarketActivity(req: Request, marketId: string | null) {
  const file = simulationStoragePath(req)
  if (!file || !existsSync(file)) return []
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const rows = db.prepare(`SELECT t.id,t.bot_id,t.side,t.cost,t.price,t.created_at,b.name,m.source_market_id,m.question
      FROM trades t JOIN bots b ON b.id=t.bot_id JOIN markets m ON m.id=t.market_id
      WHERE m.source_market_id IS NOT NULL ${marketId ? 'AND m.source_market_id=?' : ''}
      ORDER BY t.created_at DESC,t.rowid DESC LIMIT 30`).all(...(marketId ? [marketId] : []))
    return rows.map(row => ({
      id: `sim:${row.id}`, marketId: String(row.source_market_id), userId: null,
      displayName: simulationDisplayName(String(row.name)), avatarUrl: null, isMe: false, isSimulation: true,
      avatarSeed: String(row.bot_id), side: row.side, direction: 'buy', guacas: Number(row.cost),
      price: Number(row.price), question: String(row.question), createdAt: new Date(Number(row.created_at)).toISOString(),
    }))
  } finally { db.close() }
}

export async function productionMarketActivity(supabase: import('@supabase/supabase-js').SupabaseClient, marketId: string | null) {
  if (process.env.PLAY_SIMULATION_ENABLED !== 'true') return []
  let query = supabase.from('play_sim_trades')
    .select('id,bot_id,side,cost,price,created_at,play_sim_bots!inner(name),play_sim_markets!inner(source_market_id,question)')
    .not('play_sim_markets.source_market_id', 'is', null)
    .order('created_at', { ascending: false }).limit(30)
  if (marketId) query = query.eq('play_sim_markets.source_market_id', marketId)
  const {data, error} = await query
  if (error) throw new Error('Could not load simulation activity')
  return (data ?? []).map(row => {
    const bot = row.play_sim_bots as unknown as {name: string}
    const market = row.play_sim_markets as unknown as {source_market_id: string; question: string}
    return {
      id: `sim:${row.id}`, marketId: market.source_market_id, userId: null,
      displayName: simulationDisplayName(bot.name), avatarUrl: null, isMe: false, isSimulation: true,
      avatarSeed: row.bot_id, side: row.side, direction: 'buy', guacas: Number(row.cost),
      price: Number(row.price), question: market.question, createdAt: new Date(Number(row.created_at)).toISOString(),
    }
  })
}

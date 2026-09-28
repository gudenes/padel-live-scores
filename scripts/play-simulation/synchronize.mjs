import { importMarkets, resolve } from './engine.mjs'
import { priceYes } from '../../src/lib/lmsr.ts'

// Read source markets only. No writes to human wallets, prices, trades or profiles.
export async function synchronize(db, client) {
  const existing = db.prepare('SELECT source_market_id FROM markets WHERE source_market_id IS NOT NULL').all().map(m => m.source_market_id)
  const columns = 'id,status,outcome,locks_at,seed_prob,lmsr_b,q_yes,q_no,tokens,template:market_templates!markets_template_id_fkey(question_i18n)'
  const open = await client.from('markets').select(columns).eq('status','open').gt('locks_at',new Date().toISOString()).limit(100)
  if (open.error) throw new Error('Source market lookup failed')
  const sources = new Map((open.data || []).map(m => [m.id,m]))
  for (let offset=0; offset<existing.length; offset+=100) {
    const result = await client.from('markets').select(columns).in('id',existing.slice(offset,offset+100))
    if (result.error) throw new Error('Source result lookup failed')
    for (const m of result.data || []) sources.set(m.id,m)
  }
  for (const source of sources.values()) {
    let local = db.prepare('SELECT * FROM markets WHERE source_market_id=?').get(source.id)
    if (!local && source.status==='open' && Date.parse(source.locks_at)>Date.now()) {
      const template = source.template?.question_i18n
      const question = String(template?.en || template?.es || 'Prediction market').replace(/\{([^}]+)\}/g, (match,key) => String(source.tokens?.[key] ?? match))
      const probability = priceYes(Number(source.q_yes),Number(source.q_no),Number(source.lmsr_b))
      importMarkets(db,[{sourceMarketId:source.id,question,probability:Math.max(.001,Math.min(.999,probability)),liquidity:Number(source.lmsr_b),locksAt:Date.parse(source.locks_at)}])
      local = db.prepare('SELECT * FROM markets WHERE source_market_id=?').get(source.id)
    }
    if (!local) continue
    if (source.status==='void' || (source.status==='settled' && typeof source.outcome==='boolean')) {
      resolve(db,local.id,source.status==='void' ? 'void' : source.outcome ? 'yes' : 'no')
    } else if (local.status==='open') {
      // Held/proposed/locked sources immediately stop accepting simulated trades.
      const locksAt = source.status==='open' ? Date.parse(source.locks_at) : 0
      db.prepare('UPDATE markets SET locks_at=? WHERE id=?').run(locksAt,local.id)
    }
  }
  for (const id of existing) if (!sources.has(id)) db.prepare('UPDATE markets SET locks_at=0 WHERE source_market_id=?').run(id)
  // Demo markets are never traded in production.
  db.prepare("UPDATE markets SET locks_at=0 WHERE source_market_id IS NULL").run()
}

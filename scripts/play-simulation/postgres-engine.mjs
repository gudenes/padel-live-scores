import { randomUUID } from 'node:crypto'
import { priceYes, quoteBuy, seedShares } from '../../src/lib/lmsr.ts'
const one=async(db,sql,args=[]) => (await db.query(sql,args)).rows[0]

// Called inside the scheduler transaction. Settlement and its ledger commit together.
async function settle(db, market, outcome, now) {
 const previous=await one(db,'SELECT outcome FROM play_sim_resolutions WHERE market_id=$1',[market.id])
 if(previous) {
  if(previous.outcome!==outcome) throw new Error('Simulation outcome correction needs review')
  return
 }
 const positions=(await db.query('SELECT * FROM play_sim_positions WHERE market_id=$1',[market.id])).rows
 let paid=0
 for(const p of positions) {
  const amount=outcome==='void'?Number(p.cost):p.side===outcome?Math.floor(p.shares):0
  if(!amount) continue
  await db.query('UPDATE play_sim_bots SET balance=balance+$1 WHERE id=$2',[amount,p.bot_id])
  await db.query('INSERT INTO play_sim_ledger(id,bot_id,amount,kind,market_id,created_at) VALUES($1,$2,$3,$4,$5,$6)',
   [`resolution:${market.id}:${p.bot_id}:${p.side}`,p.bot_id,amount,outcome==='void'?'refund':'settlement',market.id,now])
  paid+=amount
 }
 await db.query('UPDATE play_sim_markets SET status=$1 WHERE id=$2',[outcome==='void'?'void':'settled',market.id])
 await db.query('INSERT INTO play_sim_resolutions VALUES($1,$2,$3,$4)',[market.id,outcome,paid,now])
}

export async function postgresTick(db, now=Date.now(), random=Math.random) {
 await db.query('BEGIN')
 try {
  // One shared control lock across both Railway regions. Never multiply the rate.
  const control=await one(db,'SELECT * FROM play_sim_control WHERE id=1 FOR UPDATE SKIP LOCKED')
  if(!control) { await db.query('ROLLBACK');return {reason:'worker_busy'} }
  if(now-Number(control.worker_seen)<4000) {await db.query('COMMIT');return {reason:'recent_sync'}}
  const local=(await db.query('SELECT * FROM play_sim_markets')).rows
  const sourceIds=local.map(m=>m.source_market_id).filter(Boolean)
  const sources=(await db.query(`SELECT m.*,t.question_i18n FROM public.markets m
   LEFT JOIN public.market_templates t ON t.id=m.template_id
   WHERE (m.status='open' AND m.locks_at>to_timestamp($1/1000.0)) OR m.id::text=ANY($2::text[])`,[now,sourceIds])).rows
  const found=new Set(sources.map(m=>m.id))
  const books=new Map(local.map(m=>[m.source_market_id,m]))
  for(const source of sources) {
   let market=books.get(source.id)
   if(!market && source.status==='open') {
    const probability=Math.max(.001,Math.min(.999,priceYes(Number(source.q_yes),Number(source.q_no),Number(source.lmsr_b))))
    const seed=seedShares(probability,Number(source.lmsr_b))
    const question=String(source.question_i18n?.en || source.question_i18n?.es || 'Prediction market').replace(/\{([^}]+)\}/g,(match,key)=>String(source.tokens?.[key]??match))
    market={id:'sim-copy-'+source.id}
    await db.query(`INSERT INTO play_sim_markets(id,source_market_id,question,seed,b,q_yes,q_no,locks_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(source_market_id) DO NOTHING`,
     [market.id,source.id,question,probability,Number(source.lmsr_b),seed.qYes,seed.qNo,new Date(source.locks_at).getTime()])
   }
   if(!market) continue
   if(source.status==='void' || (source.status==='settled' && typeof source.outcome==='boolean')) {
    await settle(db,market,source.status==='void'?'void':source.outcome?'yes':'no',now)
   } else {
    await db.query("UPDATE play_sim_markets SET locks_at=$1 WHERE id=$2 AND status='open'",
      [source.status==='open'?new Date(source.locks_at).getTime():0,market.id])
   }
  }
  for(const m of local) if(!m.source_market_id || !found.has(m.source_market_id)) await db.query('UPDATE play_sim_markets SET locks_at=0 WHERE id=$1',[m.id])
  await db.query('UPDATE play_sim_control SET worker_seen=$1 WHERE id=1',[now])
  if(control.paused || now<Number(control.next_tick)) {await db.query('COMMIT');return {reason:control.paused?'paused':'not_due'}}
  const pick=items=>items[Math.min(items.length-1,Math.floor(random()*items.length))]
  await db.query('UPDATE play_sim_control SET next_tick=$1 WHERE id=1',[now+Math.round(control.interval_ms*(.75+random()*.5))])
  const bots=(await db.query('SELECT * FROM (SELECT * FROM play_sim_bots ORDER BY id LIMIT $1) b WHERE balance>=10',[control.bot_limit])).rows
  const markets=(await db.query("SELECT * FROM play_sim_markets WHERE status='open' AND locks_at>$1 AND source_market_id IS NOT NULL ORDER BY id",[now])).rows
  if(!bots.length || !markets.length) {await db.query('COMMIT');return {reason:'no_candidates'}}
  const market=pick(markets), bot=pick(bots), stake=pick([10,20,25,50])
  const price=priceYes(market.q_yes,market.q_no,market.b)
  const chance=Math.max(.15,Math.min(.85,market.seed+2*(market.seed-price)))
  const side=random()<chance?'yes':'no'
  const day=Math.floor(now/86400000)*86400000
  const spend=await one(db,`SELECT
   COALESCE(sum(cost) FILTER(WHERE bot_id=$1),0) AS bot_spent,
   COALESCE(sum(cost) FILTER(WHERE market_id=$2),0) AS market_spent
   FROM play_sim_trades WHERE created_at>=$3 AND created_at<$4`,[bot.id,market.id,day,day+86400000])
  const exposure=await one(db,'SELECT COALESCE(sum(cost),0) spent FROM play_sim_positions WHERE bot_id=$1 AND market_id=$2',[bot.id,market.id])
  let reason
  if(Number(bot.balance)<stake) reason='balance'
  else if(Number(spend.bot_spent)+stake>500 || Number(spend.market_spent)+stake>2000 || Number(exposure.spent)+stake>500) reason='limit'
  if(reason) {await db.query('COMMIT');return {reason}}
  const quote=quoteBuy(market.q_yes,market.q_no,market.b,side,stake)
  const after=priceYes(quote.qYesAfter,quote.qNoAfter,market.b)
  if(Math.abs(after-market.seed)>.10) {await db.query('COMMIT');return {reason:'price_drift'}}
  if(quote.cost!==stake) throw new Error('Unexpected simulation charge')
  const id=randomUUID()
  await db.query('UPDATE play_sim_markets SET q_yes=$1,q_no=$2 WHERE id=$3',[quote.qYesAfter,quote.qNoAfter,market.id])
  await db.query('UPDATE play_sim_bots SET balance=balance-$1,last_trade_at=$2 WHERE id=$3',[stake,now,bot.id])
  await db.query(`INSERT INTO play_sim_positions VALUES($1,$2,$3,$4,$5) ON CONFLICT(bot_id,market_id,side)
   DO UPDATE SET shares=play_sim_positions.shares+EXCLUDED.shares,cost=play_sim_positions.cost+EXCLUDED.cost`,[bot.id,market.id,side,quote.shares,stake])
  await db.query('INSERT INTO play_sim_trades VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,bot.id,market.id,side,stake,quote.shares,quote.avgPrice,after,now])
  await db.query("INSERT INTO play_sim_ledger VALUES($1,$2,$3,'buy',$4,$5)",['buy:'+id,bot.id,-stake,market.id,now])
  await db.query('COMMIT')
  return {accepted:true}
 } catch(error) {await db.query('ROLLBACK');throw error}
}

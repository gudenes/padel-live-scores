import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openSimulation, seed, importMarkets, setPaused, trade, audit } from './engine.mjs'
import { synchronize } from './synchronize.mjs'
function client(rows,fail=false) {
 return {from(table) {
  assert.equal(table,'markets')
  return {select() {return {
   eq(){return {gt(){return {limit:async()=>({data:rows.filter(m=>m.status==='open'),error:fail?{}:null})}}}},
   in:async()=>({data:rows,error:fail?{}:null})
  }}}
 }}
}
test('imports live snapshots, closes held markets, settles copies once and never mutates sources',async()=>{
 const db=openSimulation(':memory:');seed(db,2);setPaused(db,false)
 const row={id:'real-market',status:'open',outcome:null,locks_at:new Date(Date.now()+86400000).toISOString(),lmsr_b:2000,q_yes:0,q_no:0,tokens:{pair:'Test'},template:{question_i18n:{en:'Will {pair} win?'}}}
 try {
 await synchronize(db,client([row]))
 assert.equal(db.prepare('SELECT question FROM markets WHERE source_market_id=?').get(row.id).question,'Will Test win?')
 const order={id:'trade1',botId:'sim-bot-0001',marketId:'sim-copy-real-market',side:'yes',stake:25}
 assert.equal(trade(db,order).accepted,true)
 row.status='held';await synchronize(db,client([row]))
 assert.equal(trade(db,{...order,id:'trade2'}).reason,'market_closed')
 row.status='settled';row.outcome=true
 await synchronize(db,client([row]))
 const balance=db.prepare('SELECT balance FROM bots WHERE id=?').get(order.botId).balance
 await synchronize(db,client([row]))
 assert.equal(db.prepare('SELECT balance FROM bots WHERE id=?').get(order.botId).balance,balance)
 assert.equal(audit(db).ok,true)
 assert.equal(row.q_yes,0)
 assert.equal(db.prepare('SELECT count(*) n FROM markets WHERE source_market_id IS NULL AND locks_at>0').get().n,0)
 }finally{db.close()}
})
test('source lookup failure fails before trading; missing sources are locked',async()=>{
 const db=openSimulation(':memory:')
 try{
 seed(db,1)
 importMarkets(db,[{sourceMarketId:'missing',question:'Test',probability:.5,liquidity:2000,locksAt:Date.now()+100000}])
 await assert.rejects(synchronize(db,client([],true)),/lookup failed/)
 await synchronize(db,client([]))
 assert.equal(db.prepare("SELECT locks_at FROM markets WHERE source_market_id='missing'").get().locks_at,0)
 assert.equal(db.prepare('SELECT count(*) n FROM trades').get().n,0)
 }finally{db.close()}
})

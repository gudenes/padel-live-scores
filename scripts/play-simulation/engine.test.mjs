import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openSimulation, seed, trade, setPaused, tick, activity, status, resolve, setIntervalMs, importMarkets, audit, configure } from './engine.mjs'
const now = Date.UTC(2026, 8, 27, 12)
function setup(t) {
  const db = openSimulation(':memory:')
  t.after(() => db.close())
  seed(db, 50, now)
  setPaused(db, false)
  return db
}
const request = { id: 'test-1', botId: 'sim-bot-0001', marketId: 'sim-day', side: 'yes', stake: 25 }
function reconciles(db) {
  const mismatches = db.prepare(`SELECT b.id FROM bots b LEFT JOIN ledger l ON b.id=l.bot_id
    GROUP BY b.id HAVING b.balance != SUM(l.amount)`).all()
  assert.equal(mismatches.length, 0)
}

test('seed scales to 1000 without resetting wallets or duplicating grants, defaults paused', t => {
  const db = openSimulation(':memory:'); t.after(() => db.close())
  seed(db, 50, now)
  assert.equal(status(db).paused, 1)
  setPaused(db, false); trade(db, request, now)
  seed(db, 1000, now)
  assert.equal(status(db).bots, 1000)
  assert.equal(db.prepare('SELECT balance FROM bots WHERE id=?').get(request.botId).balance, 9975)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ledger WHERE kind='grant'").get().n, 1000)
  assert.throws(() => seed(db, 1001, now))
  assert.throws(() => db.exec('UPDATE bots SET prize_eligible=1'))
  reconciles(db)
})

test('trade is idempotent, labelled, and balance reconciles', t => {
  const db = setup(t)
  assert.equal(trade(db, request, now).accepted, true)
  assert.equal(trade(db, request, now).replay, true)
  assert.throws(() => trade(db, { ...request, side: 'no' }, now), /Idempotency/)
  assert.equal(status(db).trades, 1)
  const event = activity(db).trades[0]
  assert.equal(event.isSimulation, true)
  assert.equal(event.prizeEligible, false)
  assert.equal(event.actorType, 'simulation_bot')
  reconciles(db)
})

test('late write failure rolls back book, wallet, position and trade', t => {
  const db = setup(t)
  const before = status(db)
  db.exec("CREATE TRIGGER fail_buy BEFORE INSERT ON ledger WHEN NEW.kind='buy' BEGIN SELECT RAISE(ABORT,'injected failure'); END")
  assert.throws(() => trade(db, request, now), /injected failure/)
  assert.deepEqual(status(db), before)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM positions').get().n, 0)
  reconciles(db)
})

test('pause, close time, bad stakes, and price drift reject without writes', t => {
  const db = setup(t)
  setPaused(db, true)
  assert.equal(trade(db, request, now).reason, 'paused')
  setPaused(db, false)
  assert.equal(trade(db, request, now + 86400000).reason, 'market_closed')
  assert.throws(() => trade(db, { ...request, stake: 51 }, now), /Invalid/)
  assert.throws(() => trade(db, { ...request, stake: -1 }, now), /Invalid/)
  db.exec("UPDATE markets SET q_yes=q_yes+10000 WHERE id='sim-day'")
  assert.equal(trade(db, request, now).reason, 'price_drift')
  assert.equal(status(db).trades, 0)
})

test('daily bot, market and position limits are enforced', t => {
  const db = setup(t)
  // Large local liquidity isolates cap tests from price-drift protection.
  db.exec('UPDATE markets SET b=b*100,q_yes=q_yes*100,q_no=q_no*100')
  for (let i = 0; i < 10; i++) assert.equal(trade(db, { ...request, id: `cap-${i}`, stake: 50, side: i % 2 ? 'yes' : 'no' }, now).accepted, true)
  assert.equal(trade(db, { ...request, id: 'daily', marketId: 'sim-season' }, now).reason, 'limit')
  assert.equal(trade(db, { ...request, id: 'exposure' }, now + 86400000 - 1).reason, 'limit')
  for (let i = 0; i < 30; i++) {
    assert.equal(trade(db, { ...request, id: `market-${i}`, botId: `sim-bot-${String(2 + Math.floor(i / 10)).padStart(4, '0')}`, stake: 50, side: i % 2 ? 'yes' : 'no' }, now).accepted, true)
  }
  assert.equal(trade(db, { ...request, id: 'market-limit', botId: 'sim-bot-0010' }, now).reason, 'limit')
  reconciles(db)
})

test('scheduler shared across connections persists next due time and honours pause', t => {
  const directory = mkdtempSync(join(tmpdir(), 'play-simulation-'))
  const path = join(directory, 'test.sqlite')
  const first = openSimulation(path), second = openSimulation(path)
  t.after(() => { first.close(); second.close(); rmSync(directory, { recursive: true }) })
  seed(first, 50, now); setPaused(first, false)
  assert.equal(tick(first, now, () => .5).accepted, true)
  assert.equal(tick(second, now, () => .5).reason, 'not_due')
  setPaused(second, true)
  assert.equal(tick(first, now + 30000).reason, 'paused')
  assert.throws(() => setIntervalMs(first, 0))
  assert.equal(status(second).trades, 1)
})

test('winner settlement is atomic, repeat-safe, and cannot change outcome', t => {
  const db = setup(t)
  const purchase = trade(db, request, now)
  const settled = resolve(db, request.marketId, 'yes', now + 86400000)
  assert.equal(settled.paid, Math.floor(purchase.trade.shares))
  assert.deepEqual(resolve(db, request.marketId, 'yes', now + 86400001), settled)
  assert.throws(() => resolve(db, request.marketId, 'no'), /differently/)
  assert.equal(trade(db, { ...request, id: 'after-settlement' }, now).reason, 'market_closed')
  reconciles(db)
})

test('void refunds both sides once', t => {
  const db = setup(t)
  trade(db, request, now)
  trade(db, { ...request, id: 'opposite', side: 'no' }, now)
  assert.equal(resolve(db, request.marketId, 'void', now).paid, 50)
  resolve(db, request.marketId, 'void', now)
  assert.equal(db.prepare('SELECT balance FROM bots WHERE id=?').get(request.botId).balance, 10000)
  reconciles(db)
})

test('snapshot import validates atomically and never overwrites a traded copy', t => {
  const db = setup(t)
  const snapshot = { sourceMarketId: 'source-123', question: 'Snapshot question', probability: .6, liquidity: 2000, locksAt: now + 100000 }
  assert.throws(() => importMarkets(db, [snapshot, { ...snapshot, sourceMarketId: 'bad', probability: 1 }], now))
  assert.equal(status(db).markets.length, 3)
  assert.equal(importMarkets(db, [snapshot], now).imported, 1)
  trade(db, { ...request, marketId: 'sim-copy-source-123' }, now)
  const before = status(db)
  assert.equal(importMarkets(db, [{ ...snapshot, probability: .2 }], now).imported, 0)
  assert.deepEqual(status(db), before)
  assert.equal(activity(db).trades[0].sourceMarketId, 'source-123')
  assert.equal(audit(db).ok, true)
})

test('1000-bot simulation respects all limits over a full day and reconciles', t => {
  const db = setup(t); seed(db, 1000, now); configure(db, 1000, 15000)
  let state = 12345
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 }
  for (let i = 0; i < 3000; i++) tick(db, now + i * 30000, random)
  assert.ok(status(db).trades > 0)
  for (const market of status(db).markets) assert.ok(Math.abs(market.priceYes - market.seed) <= .100000001)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM trades t JOIN markets m ON m.id=t.market_id WHERE t.created_at>=m.locks_at").get().n, 0)
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM (SELECT market_id,CAST(created_at/86400000 AS INTEGER) day,SUM(cost) spent FROM trades GROUP BY market_id,day HAVING spent>2000)`).get().n, 0)
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM (SELECT bot_id,CAST(created_at/86400000 AS INTEGER) day,SUM(cost) spent FROM trades GROUP BY bot_id,day HAVING spent>500)`).get().n, 0)
  assert.equal(audit(db).ok, true)
})

test('admin can reduce active bots without deleting accounts or history', t => {
  const db = setup(t)
  configure(db, 100, 30000)
  trade(db, request, now)
  configure(db, 1, 15000)
  assert.equal(status(db).bots, 100)
  assert.equal(status(db).bot_limit, 1)
  assert.equal(status(db).trades, 1)
  const result = tick(db, now + 30000, () => .5)
  assert.equal(result.trade.bot_id, 'sim-bot-0001')
  assert.throws(() => configure(db, 200, 0))
  assert.equal(status(db).bots, 100)
})

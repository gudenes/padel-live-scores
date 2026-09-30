import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { priceYes, quoteBuy, seedShares } from '../../src/lib/lmsr.ts'

// Intentionally no network clients, auth profiles, or production credentials.
export function openSimulation(filename) {
  const db = new DatabaseSync(filename)
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS control (
      id INTEGER PRIMARY KEY CHECK(id=1), paused INTEGER NOT NULL DEFAULT 1,
      next_tick INTEGER NOT NULL DEFAULT 0, interval_ms INTEGER NOT NULL DEFAULT 15000
    );
    INSERT OR IGNORE INTO control(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      actor_type TEXT NOT NULL DEFAULT 'simulation_bot' CHECK(actor_type='simulation_bot'),
      prize_eligible INTEGER NOT NULL DEFAULT 0 CHECK(prize_eligible=0),
      balance INTEGER NOT NULL CHECK(balance>=0)
    );
    CREATE TABLE IF NOT EXISTS markets (
      id TEXT PRIMARY KEY, source_market_id TEXT UNIQUE, question TEXT NOT NULL, seed REAL NOT NULL CHECK(seed>0 AND seed<1),
      b REAL NOT NULL CHECK(b>0), q_yes REAL NOT NULL, q_no REAL NOT NULL,
      locks_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open'
        CHECK(status IN ('open','settled','void'))
    );
    CREATE TABLE IF NOT EXISTS positions (
      bot_id TEXT REFERENCES bots(id), market_id TEXT REFERENCES markets(id),
      side TEXT CHECK(side IN ('yes','no')), shares REAL NOT NULL CHECK(shares>=0),
      cost INTEGER NOT NULL CHECK(cost>=0), PRIMARY KEY(bot_id,market_id,side)
    );
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id),
      market_id TEXT NOT NULL REFERENCES markets(id), side TEXT NOT NULL CHECK(side IN ('yes','no')),
      cost INTEGER NOT NULL CHECK(cost>0), shares REAL NOT NULL CHECK(shares>0),
      price REAL NOT NULL, price_after REAL NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS trades_time ON trades(created_at);
    CREATE TABLE IF NOT EXISTS ledger (
      id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), amount INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('grant','buy','settlement','refund')),
      market_id TEXT REFERENCES markets(id), created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS resolutions (
      market_id TEXT PRIMARY KEY REFERENCES markets(id), outcome TEXT NOT NULL,
      paid INTEGER NOT NULL, created_at INTEGER NOT NULL
    );`)
  const columns = db.prepare('PRAGMA table_info(control)').all().map(column => column.name)
  if (!columns.includes('bot_limit')) db.exec('ALTER TABLE control ADD COLUMN bot_limit INTEGER NOT NULL DEFAULT 50')
  if (!columns.includes('worker_seen')) db.exec('ALTER TABLE control ADD COLUMN worker_seen INTEGER NOT NULL DEFAULT 0')
  return db
}

function atomic(db, fn) {
  db.exec('BEGIN IMMEDIATE')
  try { const result = fn(); db.exec('COMMIT'); return result }
  catch (error) { db.exec('ROLLBACK'); throw error }
}

export const LIMITS = Object.freeze({ botDaily: 500, marketDaily: 2000, botMarket: 500, maxStake: 50, maxDrift: 0.10 })
const one = (db, sql, ...args) => db.prepare(sql).get(...args)
const run = (db, sql, ...args) => db.prepare(sql).run(...args)

export function seed(db, count = 50, now = Date.now()) {
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('Bot count must be 1–1000')
  return atomic(db, () => {
    for (let i = 1; i <= count; i++) {
      const id = `sim-bot-${String(i).padStart(4, '0')}`
      const added = run(db, 'INSERT OR IGNORE INTO bots(id,name,balance) VALUES(?,?,10000)', id, `Bot ${String(i).padStart(4, '0')}`)
      if (added.changes) run(db, "INSERT INTO ledger VALUES(?,?,10000,'grant',NULL,?)", `grant:${id}`, id, now)
    }
    for (const [id, question, probability, days] of [
      ['sim-day', 'Demo · Partido del día', .65, 1],
      ['sim-tournament', 'Demo · Ganador del torneo', .4, 7],
      ['sim-season', 'Demo · Campeón de temporada', .25, 90],
    ]) {
      const q = seedShares(probability, 2000)
      run(db, 'INSERT OR IGNORE INTO markets(id,question,seed,b,q_yes,q_no,locks_at) VALUES(?,?,?,?,?,?,?)', id, question, probability, 2000, q.qYes, q.qNo, now + days * 86400000)
    }
    return status(db)
  })
}

function execute(db, { id, botId, marketId, side, stake }, now) {
  if (typeof id !== 'string' || !id.trim()) throw new Error('A nonempty idempotency key is required')
  const previous = one(db, 'SELECT * FROM trades WHERE id=?', id)
  if (previous) {
    if (previous.bot_id !== botId || previous.market_id !== marketId || previous.side !== side || previous.cost !== stake) throw new Error('Idempotency key reused with different trade')
    return { accepted: true, replay: true, trade: previous }
  }
  if (one(db, 'SELECT paused FROM control WHERE id=1').paused) return { accepted: false, reason: 'paused' }
  if (!['yes', 'no'].includes(side) || !Number.isInteger(stake) || stake < 1 || stake > LIMITS.maxStake) throw new Error('Invalid trade')
  const bot = one(db, 'SELECT * FROM bots WHERE id=?', botId)
  const market = one(db, 'SELECT * FROM markets WHERE id=?', marketId)
  if (!bot || !market) return { accepted: false, reason: 'not_found' }
  if (market.status !== 'open' || market.locks_at <= now) return { accepted: false, reason: 'market_closed' }
  const day = Math.floor(now / 86400000) * 86400000
  const spent = (column, value) => one(db, `SELECT COALESCE(SUM(cost),0) n FROM trades WHERE ${column}=? AND created_at>=? AND created_at<?`, value, day, day + 86400000).n
  const exposure = one(db, 'SELECT COALESCE(SUM(cost),0) n FROM positions WHERE bot_id=? AND market_id=?', botId, marketId).n
  if (bot.balance < stake) return { accepted: false, reason: 'balance' }
  if (spent('bot_id', botId) + stake > LIMITS.botDaily || spent('market_id', marketId) + stake > LIMITS.marketDaily || exposure + stake > LIMITS.botMarket) return { accepted: false, reason: 'limit' }
  const quote = quoteBuy(market.q_yes, market.q_no, market.b, side, stake)
  const after = priceYes(quote.qYesAfter, quote.qNoAfter, market.b)
  if (Math.abs(after - market.seed) > LIMITS.maxDrift) return { accepted: false, reason: 'price_drift' }
  if (quote.cost !== stake) throw new Error('Unexpected quote charge')
  run(db, 'UPDATE markets SET q_yes=?,q_no=? WHERE id=?', quote.qYesAfter, quote.qNoAfter, marketId)
  run(db, 'UPDATE bots SET balance=balance-? WHERE id=?', quote.cost, botId)
  run(db, `INSERT INTO positions VALUES(?,?,?,?,?) ON CONFLICT(bot_id,market_id,side)
    DO UPDATE SET shares=shares+excluded.shares,cost=cost+excluded.cost`, botId, marketId, side, quote.shares, quote.cost)
  run(db, 'INSERT INTO trades VALUES(?,?,?,?,?,?,?,?,?)', id, botId, marketId, side, quote.cost, quote.shares, quote.avgPrice, after, now)
  run(db, "INSERT INTO ledger VALUES(?,?,?,'buy',?,?)", `buy:${id}`, botId, -quote.cost, marketId, now)
  return { accepted: true, replay: false, trade: one(db, 'SELECT * FROM trades WHERE id=?', id) }
}

export function trade(db, request, now = Date.now()) {
  return atomic(db, () => execute(db, request, now))
}

export function setPaused(db, paused) {
  run(db, 'UPDATE control SET paused=? WHERE id=1', paused ? 1 : 0)
}

export function setIntervalMs(db, ms) {
  if (!Number.isInteger(ms) || ms < 5000 || ms > 300000) throw new Error('Interval must be 5000–300000 ms')
  run(db, 'UPDATE control SET interval_ms=? WHERE id=1', ms)
}

// A database lease prevents duplicate scheduling when two workers are launched.
// Each attempt and its next due time commit together. No catch-up bursts.
export function tick(db, now = Date.now(), random = Math.random) {
  return atomic(db, () => {
    const control = one(db, 'SELECT * FROM control WHERE id=1')
    if (control.paused || now < control.next_tick) return { accepted: false, reason: control.paused ? 'paused' : 'not_due' }
    const pick = items => items[Math.min(items.length - 1, Math.floor(random() * items.length))]
    const bots = db.prepare('SELECT id FROM (SELECT id,balance FROM bots ORDER BY id LIMIT ?) WHERE balance>=10').all(control.bot_limit)
    const markets = db.prepare("SELECT * FROM markets WHERE status='open' AND locks_at>? ORDER BY id").all(now)
    run(db, 'UPDATE control SET next_tick=? WHERE id=1', now + Math.round(control.interval_ms * (.75 + random() * .5)))
    if (!bots.length || !markets.length) return { accepted: false, reason: 'no_candidates' }
    const market = pick(markets)
    const p = priceYes(market.q_yes, market.q_no, market.b)
    // More likely to buy YES below the starting price, NO above it; hard drift cap also applies.
    const yesChance = Math.max(.15, Math.min(.85, market.seed + 2 * (market.seed - p)))
    return execute(db, { id: randomUUID(), botId: pick(bots).id, marketId: market.id,
      side: random() < yesChance ? 'yes' : 'no', stake: pick([10, 20, 25, 50]) }, now)
  })
}

export function resolve(db, marketId, outcome, now = Date.now()) {
  if (!['yes', 'no', 'void'].includes(outcome)) throw new Error('Outcome must be yes, no or void')
  return atomic(db, () => {
    const prior = one(db, 'SELECT * FROM resolutions WHERE market_id=?', marketId)
    if (prior) {
      if (prior.outcome !== outcome) throw new Error('Market already resolved differently')
      return prior
    }
    const market = one(db, 'SELECT * FROM markets WHERE id=?', marketId)
    if (!market) throw new Error('Unknown market')
    let paid = 0
    const rows = db.prepare('SELECT * FROM positions WHERE market_id=?').all(marketId)
    for (const pos of rows) {
      const amount = outcome === 'void' ? pos.cost : pos.side === outcome ? Math.floor(pos.shares) : 0
      if (!amount) continue
      run(db, 'UPDATE bots SET balance=balance+? WHERE id=?', amount, pos.bot_id)
      run(db, 'INSERT INTO ledger VALUES(?,?,?,?,?,?)', `resolution:${marketId}:${pos.bot_id}:${pos.side}`, pos.bot_id, amount, outcome === 'void' ? 'refund' : 'settlement', marketId, now)
      paid += amount
    }
    run(db, 'UPDATE markets SET status=? WHERE id=?', outcome === 'void' ? 'void' : 'settled', marketId)
    run(db, 'INSERT INTO resolutions VALUES(?,?,?,?)', marketId, outcome, paid, now)
    return one(db, 'SELECT * FROM resolutions WHERE market_id=?', marketId)
  })
}

export function status(db) {
  return { mode: 'local_simulation', prizeEligible: false,
    ...one(db, 'SELECT paused,interval_ms,next_tick,bot_limit,worker_seen FROM control WHERE id=1'),
    bots: one(db, 'SELECT COUNT(*) n FROM bots').n,
    trades: one(db, 'SELECT COUNT(*) n FROM trades').n,
    markets: db.prepare('SELECT id,source_market_id,question,status,locks_at,seed,b,q_yes,q_no FROM markets').all()
      .map(m => ({ ...m, priceYes: priceYes(m.q_yes, m.q_no, m.b) })) }
}

export function activity(db, limit = 30) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Limit must be 1–100')
  return { mode: 'local_simulation', trades: db.prepare(`SELECT t.*, b.name, m.question, m.source_market_id FROM trades t
    JOIN bots b ON b.id=t.bot_id JOIN markets m ON m.id=t.market_id
    ORDER BY t.created_at DESC,t.rowid DESC LIMIT ?`).all(limit).map(t => ({
      id: t.id, marketId: t.market_id, sourceMarketId: t.source_market_id, question: t.question, actorType: 'simulation_bot',
      displayName: t.name, isSimulation: true, prizeEligible: false,
      side: t.side, direction: 'buy', guacas: t.cost, shares: t.shares,
      price: t.price, priceAfter: t.price_after, createdAt: new Date(t.created_at).toISOString(),
    })) }
}

// Import an explicit local snapshot, never fetch or mutate the source market.
// Reimport is insert-only so it cannot erase trades, reopen a market or extend its deadline.
export function importMarkets(db, snapshots, now = Date.now()) {
  if (!Array.isArray(snapshots) || !snapshots.length || snapshots.length > 100) throw new Error('Supply 1–100 market snapshots')
  return atomic(db, () => {
    let imported = 0
    for (const m of snapshots) {
      if (!m || typeof m.sourceMarketId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(m.sourceMarketId)
        || typeof m.question !== 'string' || !m.question.trim() || m.question.length > 500
        || !Number.isFinite(m.probability) || m.probability <= 0 || m.probability >= 1
        || !Number.isFinite(m.liquidity) || m.liquidity < 100 || m.liquidity > 1000000
        || !Number.isSafeInteger(m.locksAt) || m.locksAt <= now) throw new Error('Invalid or expired market snapshot')
      const q = seedShares(m.probability, m.liquidity)
      imported += Number(run(db, `INSERT OR IGNORE INTO markets
        (id,source_market_id,question,seed,b,q_yes,q_no,locks_at) VALUES(?,?,?,?,?,?,?,?)`,
        `sim-copy-${m.sourceMarketId}`, m.sourceMarketId, m.question, m.probability, m.liquidity,
        q.qYes, q.qNo, m.locksAt).changes)
    }
    return { imported, mode: 'local_simulation' }
  })
}

export function audit(db) {
  const wallets = db.prepare(`SELECT b.id,b.balance,COALESCE(SUM(l.amount),0) ledger_balance
    FROM bots b LEFT JOIN ledger l ON l.bot_id=b.id GROUP BY b.id
    HAVING b.balance != COALESCE(SUM(l.amount),0)`).all()
  const trades = db.prepare(`SELECT t.id FROM trades t LEFT JOIN ledger l ON l.id='buy:'||t.id
    WHERE l.id IS NULL OR l.amount != -t.cost OR l.bot_id != t.bot_id OR l.market_id != t.market_id`).all()
  return { ok: wallets.length === 0 && trades.length === 0, walletMismatches: wallets, tradeMismatches: trades }
}

export function configure(db, count, intervalMs) {
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('Active bots must be 1–1000')
  if (!Number.isInteger(intervalMs) || intervalMs < 5000 || intervalMs > 300000) throw new Error('Interval must be 5000–300000 ms')
  seed(db, count)
  run(db, 'UPDATE control SET bot_limit=?,interval_ms=? WHERE id=1', count, intervalMs)
}

export function heartbeat(db) {
  run(db, 'UPDATE control SET worker_seen=? WHERE id=1', Date.now())
}

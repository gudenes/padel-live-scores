# Play Prediction Market — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the market engine — schema, LMSR pricing, resolver registry, and the two padelgod workers that generate and settle markets — entirely behind flags with no user-facing UI.

**Architecture:** All money-like maths lives in pure, unit-tested functions in `padelgod/src/lib/`. The workers are thin shells that read from Supabase, call those functions, and write back. Every decision the pipeline makes (does this candidate pass its gates, should this market settle now) is a pure function tested against fixtures, so the database round-trip is never the thing under test.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Supabase Postgres, vitest, node-cron via padelgod's scheduler, pino logging.

---

## Scope refinement — read this first

The spec lists **8 templates**. This plan implements the engine plus **2 resolvers**, one per horizon:

- `match.winner_is_pair` (pre-match)
- `tournament.champion_is_pair` (tournament)

That is deliberate. Two resolvers prove the whole pipeline end-to-end — generation, pricing, locking, proposal, hold, settlement — while keeping this plan executable. The remaining six are mechanical once the registry and its test harness exist, and get a short follow-on plan.

Phase 1 ships **no UI and no user trading**. Success is a dry-run against a live Premier event showing the right markets would be created at the right prices.

## Prerequisites

The worktree has no `node_modules` and no `.env.local` (gitignored). Before Task 1:

```bash
cd /Volumes/Crucial/dev/padel-play-market
npm install
cd padelgod && npm install && cd ..
cp /Volumes/Crucial/dev/padel-live-scores/.env.local .env.local
```

Verify `.env.local` contains `DATABASE_URL`. Migrations are applied with the repo's pg-driver script, **not** `supabase db push` (the migration history has drift):

```bash
node scripts/apply-migration.mjs supabase/migrations/<file>.sql
```

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260923120000_play_market_core.sql` | seasons, templates, limits |
| `supabase/migrations/20260923120100_play_market_trading.sql` | markets, trades, positions |
| `supabase/migrations/20260923120200_play_market_ledger.sql` | ledger, balance cache, audit log, RLS |
| `supabase/migrations/20260923120300_play_market_seed.sql` | season 1 + the 2 phase-1 templates |
| `padelgod/src/lib/lmsr.ts` | pricing: cost, price, seeding, buy/sell quotes |
| `padelgod/src/lib/market-gates.ts` | eligibility gates, candidate scoring, cap application |
| `padelgod/src/lib/market-settlement.ts` | the propose/hold/settle/void decision |
| `padelgod/src/lib/market-resolvers/types.ts` | resolver contract |
| `padelgod/src/lib/market-resolvers/index.ts` | the registry |
| `padelgod/src/lib/market-resolvers/match-winner.ts` | `match.winner_is_pair` |
| `padelgod/src/lib/market-resolvers/tournament-champion.ts` | `tournament.champion_is_pair` |
| `padelgod/src/workers/market-generator.ts` | hourly :25 — creates markets |
| `padelgod/src/workers/market-resolver.ts` | every 5 min — proposes and settles |
| `padelgod/src/lib/env.ts` (modify) | two flags + dry-run switches |
| `padelgod/src/index.ts` (modify) | thread flags into scheduler config |
| `padelgod/src/scheduler.ts` (modify) | worker names, admin-trigger cases, cron registration |

Tests mirror source: `padelgod/src/lib/__tests__/*.test.ts`, `padelgod/src/workers/__tests__/*.test.ts`.

---

## Task 1: Core schema — seasons, templates, limits

**Files:**
- Create: `supabase/migrations/20260923120000_play_market_core.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Play prediction market — core configuration tables.
-- Spec: docs/superpowers/specs/2026-09-23-prediction-market-design.md

CREATE TABLE market_seasons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  reset_balance integer     NOT NULL DEFAULT 10000,
  status        text        NOT NULL DEFAULT 'upcoming'
                CHECK (status IN ('upcoming','active','archived')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Exactly one active season, enforced by the database rather than by code.
CREATE UNIQUE INDEX market_seasons_one_active ON market_seasons (status)
  WHERE status = 'active';

CREATE TABLE market_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key             text UNIQUE NOT NULL,
  question_i18n   jsonb       NOT NULL,
  horizon         text        NOT NULL
                  CHECK (horizon IN ('pre-match','tournament','season','roster')),
  trigger         text        NOT NULL,
  lock_rule       text        NOT NULL
                  CHECK (lock_rule IN ('match_start','round_first_ball','final_start')),
  resolver_key    text        NOT NULL,
  seed_source     text        NOT NULL
                  CHECK (seed_source IN ('elo','projection','inplay','fip_rank','fixed')),
  max_loss_guacas integer     NOT NULL DEFAULT 5000 CHECK (max_loss_guacas > 0),
  params          jsonb       NOT NULL DEFAULT '{}',
  gates           jsonb       NOT NULL DEFAULT '{}',
  enabled         boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Single-row table. The boolean PK forces exactly one row: a second INSERT
-- collides on the primary key, so no code path can create competing limits.
CREATE TABLE market_limits (
  id                     boolean PRIMARY KEY DEFAULT true CHECK (id),
  max_open_markets       integer NOT NULL DEFAULT 15,
  max_new_per_day        integer NOT NULL DEFAULT 20,
  max_per_match          integer NOT NULL DEFAULT 3,
  max_per_tournament_day integer NOT NULL DEFAULT 8,
  max_subsidy_per_day    integer NOT NULL DEFAULT 250000,
  max_stake_user_market  integer NOT NULL DEFAULT 2000,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             text
);

INSERT INTO market_limits DEFAULT VALUES;
```

- [ ] **Step 2: Apply it**

Run: `node scripts/apply-migration.mjs supabase/migrations/20260923120000_play_market_core.sql`
Expected: `Applied.`

- [ ] **Step 3: Verify the single-row guard actually holds**

```bash
node -e "
import('pg').then(async ({default:{Pool}}) => {
  const fs=await import('node:fs');
  for (const l of fs.readFileSync('.env.local','utf8').split(/\r?\n/)) {
    const m=l.match(/^([A-Z0-9_]+)=(.*)\$/i); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'');
  }
  const u=new URL(process.env.DATABASE_URL);
  const p=new Pool({host:u.hostname,port:+(u.port||5432),database:u.pathname.slice(1),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:false}});
  try { await p.query('INSERT INTO market_limits DEFAULT VALUES'); console.log('FAIL: second row inserted'); }
  catch (e) { console.log('OK: second row rejected —', e.code); }
  const r = await p.query('SELECT count(*)::int AS n FROM market_limits');
  console.log('rows:', r.rows[0].n);
  await p.end();
});
"
```

Expected: `OK: second row rejected — 23505` then `rows: 1`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260923120000_play_market_core.sql
git commit -m "feat(play): core schema for seasons, templates and limits"
```

---

## Task 2: Trading schema — markets, trades, positions

**Files:**
- Create: `supabase/migrations/20260923120100_play_market_trading.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Play prediction market — market instances and trading.

CREATE TABLE markets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id      text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(8), 'hex'),
  season_id      uuid NOT NULL REFERENCES market_seasons(id),
  template_id    uuid NOT NULL REFERENCES market_templates(id),

  match_id       uuid REFERENCES matches(id) ON DELETE CASCADE,
  tournament_id  uuid REFERENCES tournaments(id) ON DELETE CASCADE,
  category       text CHECK (category IN ('men','women')),
  tokens         jsonb NOT NULL DEFAULT '{}',

  -- Frozen at creation. Editing the template must never reach back.
  resolver_key    text          NOT NULL,
  resolver_params jsonb         NOT NULL DEFAULT '{}',
  lmsr_b          numeric(12,4) NOT NULL CHECK (lmsr_b > 0),
  seed_prob       numeric(5,4)  NOT NULL CHECK (seed_prob > 0 AND seed_prob < 1),
  seed_source     text          NOT NULL,

  q_yes          numeric(14,4) NOT NULL DEFAULT 0,
  q_no           numeric(14,4) NOT NULL DEFAULT 0,
  volume_guacas  bigint  NOT NULL DEFAULT 0,
  position_count integer NOT NULL DEFAULT 0,

  -- 'held' is a TERMINAL-until-operator state. It exists because the hold
  -- rule is otherwise unenforceable: without a persisted status, a market
  -- whose answer flapped reverts to 'proposed' and auto-settles once the
  -- answer flaps back. Verified during execution — see Task 9.
  status         text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','locked','proposed','held','settled','void')),
  locks_at       timestamptz NOT NULL,

  proposed_outcome  boolean,
  proposed_at       timestamptz,
  proposed_evidence jsonb,
  settles_at        timestamptz,
  outcome           boolean,
  settled_at        timestamptz,
  settled_by        text,
  void_reason       text,
  hold_reason       text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((match_id IS NULL) <> (tournament_id IS NULL))
);

CREATE INDEX markets_status_locks_idx ON markets (status, locks_at);
CREATE INDEX markets_season_status_idx ON markets (season_id, status);
CREATE INDEX markets_match_idx ON markets (match_id) WHERE match_id IS NOT NULL;

-- Idempotency guard: the generator can run repeatedly without duplicating.
CREATE UNIQUE INDEX markets_one_per_template_match
  ON markets (template_id, match_id, category) WHERE match_id IS NOT NULL;
CREATE UNIQUE INDEX markets_one_per_template_tournament
  ON markets (template_id, tournament_id, category, (tokens->>'pair_key'))
  WHERE tournament_id IS NOT NULL;

CREATE TABLE market_trades (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  market_id    uuid NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  side         text NOT NULL CHECK (side IN ('yes','no')),
  direction    text NOT NULL CHECK (direction IN ('buy','sell')),
  shares       numeric(14,4) NOT NULL CHECK (shares > 0),
  cost_guacas  integer NOT NULL,
  price        numeric(5,4) NOT NULL,
  q_yes_after  numeric(14,4) NOT NULL,
  q_no_after   numeric(14,4) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX market_trades_market_idx ON market_trades (market_id, created_at DESC);
CREATE INDEX market_trades_user_idx ON market_trades (user_id, created_at DESC);

CREATE TABLE market_positions (
  market_id    uuid NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  yes_shares   numeric(14,4) NOT NULL DEFAULT 0,
  no_shares    numeric(14,4) NOT NULL DEFAULT 0,
  cost_basis   integer NOT NULL DEFAULT 0,
  realised_pnl integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (market_id, user_id)
);

CREATE INDEX market_positions_user_idx ON market_positions (user_id)
  WHERE yes_shares > 0 OR no_shares > 0;
```

- [ ] **Step 2: Apply it**

Run: `node scripts/apply-migration.mjs supabase/migrations/20260923120100_play_market_trading.sql`
Expected: `Applied.`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260923120100_play_market_trading.sql
git commit -m "feat(play): markets, trades and positions schema"
```

---

## Task 3: Ledger schema and RLS

**Files:**
- Create: `supabase/migrations/20260923120200_play_market_ledger.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Play prediction market — ledger, balance cache, audit log, RLS.

CREATE TABLE guaca_ledger (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  season_id  uuid NOT NULL REFERENCES market_seasons(id),
  kind       text NOT NULL CHECK (kind IN (
               'signup_grant','daily_stipend','referral','achievement',
               'trade_buy','trade_sell','settlement','refund',
               'cosmetic','market_fee','season_reset')),
  amount     integer NOT NULL,
  market_id  uuid REFERENCES markets(id) ON DELETE SET NULL,
  trade_id   bigint REFERENCES market_trades(id) ON DELETE SET NULL,
  memo       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX guaca_ledger_user_season_idx ON guaca_ledger (user_id, season_id);
CREATE INDEX guaca_ledger_kind_idx ON guaca_ledger (kind, created_at DESC);

CREATE TABLE user_guaca_balance (
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  season_id  uuid NOT NULL REFERENCES market_seasons(id),
  balance    integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  locked     integer NOT NULL DEFAULT 0 CHECK (locked >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, season_id)
);

CREATE TABLE market_audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  market_id   uuid REFERENCES markets(id) ON DELETE SET NULL,
  template_id uuid REFERENCES market_templates(id) ON DELETE SET NULL,
  actor       text NOT NULL,
  action      text NOT NULL,
  -- NOT NULL by design: an override without a stated reason is exactly the
  -- thing we will want in six months and not have.
  reason      text NOT NULL,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX market_audit_log_market_idx ON market_audit_log (market_id, created_at DESC);

-- ── RLS ────────────────────────────────────────────────────────────────
-- Browser reads open markets; everything else is own-rows-only or
-- service-role-only. All writes go through service-role API routes.

ALTER TABLE markets              ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_trades        ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_positions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE guaca_ledger         ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_guaca_balance   ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_templates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_limits        ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_seasons       ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_audit_log     ENABLE ROW LEVEL SECURITY;

CREATE POLICY markets_public_read ON markets
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY seasons_public_read ON market_seasons
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY trades_own_read ON market_trades
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY positions_own_read ON market_positions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY ledger_own_read ON guaca_ledger
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY balance_own_read ON user_guaca_balance
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- market_templates, market_limits and market_audit_log get NO policies:
-- RLS enabled with zero policies denies anon/authenticated entirely, while
-- the service role bypasses RLS. That is the intended access shape.
```

- [ ] **Step 2: Apply it**

Run: `node scripts/apply-migration.mjs supabase/migrations/20260923120200_play_market_ledger.sql`
Expected: `Applied.`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260923120200_play_market_ledger.sql
git commit -m "feat(play): ledger, balance cache, audit log and RLS"
```

---

## Task 4: LMSR — cost, price and seeding

**Files:**
- Create: `padelgod/src/lib/lmsr.ts`
- Test: `padelgod/src/lib/__tests__/lmsr.test.ts`

- [ ] **Step 1: Write the failing test**

Create `padelgod/src/lib/__tests__/lmsr.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { bFromMaxLoss, maxLoss, cost, priceYes, seedShares } from '../lmsr.js'

describe('bFromMaxLoss / maxLoss', () => {
  it('round-trips: b derived from a ceiling reproduces that ceiling', () => {
    const b = bFromMaxLoss(5000)
    expect(b).toBeCloseTo(5000 / Math.LN2, 6)
    expect(maxLoss(b)).toBeCloseTo(5000, 6)
  })
  it('rejects a non-positive ceiling', () => {
    expect(() => bFromMaxLoss(0)).toThrow()
  })
})

describe('priceYes', () => {
  it('is 0.5 at equal share counts', () => {
    expect(priceYes(0, 0, 7213)).toBeCloseTo(0.5, 9)
  })
  it('rises as YES shares are bought', () => {
    expect(priceYes(1000, 0, 7213)).toBeGreaterThan(0.5)
  })
  it('stays in (0,1) at extreme imbalance', () => {
    const p = priceYes(1e6, 0, 7213)
    expect(p).toBeLessThanOrEqual(1)
    expect(p).toBeGreaterThan(0.5)
    expect(Number.isFinite(p)).toBe(true)
  })
})

describe('cost', () => {
  it('is b·ln(2) at the origin', () => {
    expect(cost(0, 0, 7213)).toBeCloseTo(7213 * Math.LN2, 6)
  })
  it('does not overflow at large share counts', () => {
    // exp(q/b) overflows float64 well before this; logsumexp must not.
    expect(Number.isFinite(cost(1e7, 0, 7213))).toBe(true)
  })
})

describe('seedShares', () => {
  it('produces exactly the requested opening price', () => {
    const b = 7213
    for (const p of [0.05, 0.34, 0.5, 0.68, 0.95]) {
      const { qYes, qNo } = seedShares(p, b)
      expect(priceYes(qYes, qNo, b)).toBeCloseTo(p, 9)
    }
  })
  it('costs nothing to open — C(seed) is zero', () => {
    const b = 7213
    const { qYes, qNo } = seedShares(0.34, b)
    expect(cost(qYes, qNo, b)).toBeCloseTo(0, 6)
  })
  it('rejects probabilities outside (0,1)', () => {
    expect(() => seedShares(0, 7213)).toThrow()
    expect(() => seedShares(1, 7213)).toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd padelgod && npx vitest run src/lib/__tests__/lmsr.test.ts`
Expected: FAIL — `Failed to resolve import "../lmsr.js"`

- [ ] **Step 3: Implement the module**

Create `padelgod/src/lib/lmsr.ts`:

```ts
// Logarithmic Market Scoring Rule — the pricing engine for Play markets.
//
// Chosen because the market maker's worst-case loss is bounded and knowable
// BEFORE any trade happens: b·ln(2) for a binary market. That is what makes
// the subsidy budget on the operator's Economy page honest.
//
// Spec: docs/superpowers/specs/2026-09-23-prediction-market-design.md

/** Worst-case maker loss for a binary market with liquidity parameter b. */
export function maxLoss(b: number): number {
  return b * Math.LN2
}

/** Inverse of maxLoss: the operator picks a ceiling, b follows. */
export function bFromMaxLoss(maxLossGuacas: number): number {
  if (!(maxLossGuacas > 0)) throw new Error(`maxLoss must be > 0, got ${maxLossGuacas}`)
  return maxLossGuacas / Math.LN2
}

/**
 * C(q) = b · ln( e^(qYes/b) + e^(qNo/b) )
 *
 * Computed via logsumexp. The naive form overflows float64 once q/b exceeds
 * ~709, which a long-running market reaches easily.
 */
export function cost(qYes: number, qNo: number, b: number): number {
  const a = qYes / b
  const c = qNo / b
  const m = Math.max(a, c)
  return b * (m + Math.log(Math.exp(a - m) + Math.exp(c - m)))
}

/** Current YES price — a numerically stable sigmoid, always in (0,1). */
export function priceYes(qYes: number, qNo: number, b: number): number {
  return 1 / (1 + Math.exp((qNo - qYes) / b))
}

/**
 * Opening share counts that make priceYes exactly `p` at zero cost.
 *
 * qYes = b·ln(p), qNo = b·ln(1−p) ⇒ price = p and C = b·ln(p + 1−p) = 0.
 * Opening at the model's number rather than a blank 0.50 is the whole reason
 * this product has a price to trade against from its first second.
 */
export function seedShares(p: number, b: number): { qYes: number; qNo: number } {
  if (!(p > 0 && p < 1)) throw new Error(`seed probability must be in (0,1), got ${p}`)
  return { qYes: b * Math.log(p), qNo: b * Math.log(1 - p) }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd padelgod && npx vitest run src/lib/__tests__/lmsr.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/lmsr.ts padelgod/src/lib/__tests__/lmsr.test.ts
git commit -m "feat(play): LMSR cost, price and seeding with bounded maker loss"
```

---

## Task 5: LMSR — buy and sell quotes

**Files:**
- Modify: `padelgod/src/lib/lmsr.ts`
- Test: `padelgod/src/lib/__tests__/lmsr.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `padelgod/src/lib/__tests__/lmsr.test.ts`:

```ts
import { quoteBuy, quoteSell } from '../lmsr.js'

describe('quoteBuy', () => {
  const b = 7213

  it('spends exactly the guacas offered', () => {
    const { qYes, qNo } = seedShares(0.38, b)
    const q = quoteBuy(qYes, qNo, b, 'yes', 250)
    // cost is rounded up against the user, so it can exceed by at most 1
    expect(q.cost).toBeGreaterThanOrEqual(250)
    expect(q.cost).toBeLessThanOrEqual(251)
  })

  it('buying YES moves the YES price up', () => {
    const { qYes, qNo } = seedShares(0.38, b)
    const before = priceYes(qYes, qNo, b)
    const q = quoteBuy(qYes, qNo, b, 'yes', 2000)
    expect(priceYes(q.qYesAfter, q.qNoAfter, b)).toBeGreaterThan(before)
  })

  it('buying NO moves the YES price down', () => {
    const { qYes, qNo } = seedShares(0.38, b)
    const before = priceYes(qYes, qNo, b)
    const q = quoteBuy(qYes, qNo, b, 'no', 2000)
    expect(priceYes(q.qYesAfter, q.qNoAfter, b)).toBeLessThan(before)
  })

  it('a cheap side buys more shares than an expensive one', () => {
    const { qYes, qNo } = seedShares(0.20, b)
    const cheap = quoteBuy(qYes, qNo, b, 'yes', 1000)   // price 0.20
    const dear  = quoteBuy(qYes, qNo, b, 'no', 1000)    // price 0.80
    expect(cheap.shares).toBeGreaterThan(dear.shares)
  })

  it('average price paid is worse than the pre-trade price (slippage)', () => {
    const { qYes, qNo } = seedShares(0.50, b)
    const q = quoteBuy(qYes, qNo, b, 'yes', 2000)
    expect(q.avgPrice).toBeGreaterThan(0.50)
  })

  it('rejects a non-positive stake', () => {
    const { qYes, qNo } = seedShares(0.5, b)
    expect(() => quoteBuy(qYes, qNo, b, 'yes', 0)).toThrow()
  })
})

describe('quoteSell', () => {
  const b = 7213

  it('selling back what you just bought returns roughly what you paid', () => {
    const { qYes, qNo } = seedShares(0.45, b)
    const buy = quoteBuy(qYes, qNo, b, 'yes', 1000)
    const sell = quoteSell(buy.qYesAfter, buy.qNoAfter, b, 'yes', buy.shares)
    // Rounding is against the user in both directions, so allow a couple of G.
    expect(sell.refund).toBeGreaterThan(996)
    expect(sell.refund).toBeLessThanOrEqual(1000)
  })

  it('rounds the refund down, never up — selling cannot mint guacas', () => {
    const { qYes, qNo } = seedShares(0.45, b)
    const buy = quoteBuy(qYes, qNo, b, 'yes', 1000)
    const sell = quoteSell(buy.qYesAfter, buy.qNoAfter, b, 'yes', buy.shares)
    expect(Number.isInteger(sell.refund)).toBe(true)
    expect(sell.refund).toBeLessThanOrEqual(buy.cost)
  })

  it('rejects selling more shares than exist on that side', () => {
    const { qYes, qNo } = seedShares(0.5, b)
    expect(() => quoteSell(qYes, qNo, b, 'yes', 1e12)).toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd padelgod && npx vitest run src/lib/__tests__/lmsr.test.ts`
Expected: FAIL — `quoteBuy is not exported` / import error

- [ ] **Step 3: Implement the quotes**

Append to `padelgod/src/lib/lmsr.ts`:

```ts
export type Side = 'yes' | 'no'

export interface BuyQuote {
  shares: number
  /** Integer guacas, rounded UP against the user. */
  cost: number
  avgPrice: number
  qYesAfter: number
  qNoAfter: number
}

export interface SellQuote {
  /** Integer guacas, rounded DOWN against the user. */
  refund: number
  avgPrice: number
  qYesAfter: number
  qNoAfter: number
}

/**
 * How many shares `guacas` buys on `side`.
 *
 * Closed form. With a = the current price of the chosen side:
 *   s = b · ln( (e^(G/b) − (1−a)) / a )
 * Derived from C(q+s) − C(q) = G, normalised by (e^(qYes/b) + e^(qNo/b)) so
 * only the price and G/b appear — no large exponentials survive.
 */
export function quoteBuy(
  qYes: number, qNo: number, b: number, side: Side, guacas: number,
): BuyQuote {
  if (!(guacas > 0)) throw new Error(`stake must be > 0, got ${guacas}`)

  const pYes = priceYes(qYes, qNo, b)
  const a = side === 'yes' ? pYes : 1 - pYes

  const shares = b * Math.log((Math.exp(guacas / b) - (1 - a)) / a)
  if (!Number.isFinite(shares) || shares <= 0) {
    throw new Error(`unpriceable trade: side=${side} guacas=${guacas} price=${a}`)
  }

  const qYesAfter = side === 'yes' ? qYes + shares : qYes
  const qNoAfter  = side === 'no'  ? qNo + shares  : qNo

  // Round the charge UP so rounding can never mint guacas.
  const exact = cost(qYesAfter, qNoAfter, b) - cost(qYes, qNo, b)
  const charged = Math.ceil(exact - 1e-9)

  return { shares, cost: charged, avgPrice: exact / shares, qYesAfter, qNoAfter }
}

/** Refund for selling `shares` back to the maker. */
export function quoteSell(
  qYes: number, qNo: number, b: number, side: Side, shares: number,
): SellQuote {
  if (!(shares > 0)) throw new Error(`shares must be > 0, got ${shares}`)

  const qYesAfter = side === 'yes' ? qYes - shares : qYes
  const qNoAfter  = side === 'no'  ? qNo - shares  : qNo

  // Solvency guard. A naive `shares > qSide` check does NOT work here: seeded
  // q values are NEGATIVE for p < 0.5 (qYes = b·ln p), so q is an offset, not a
  // count of outstanding shares — that check rejects legitimate round-trips.
  //
  // The real invariant is that C(seed) = 0 and C only rises as guacas come in,
  // so C(q) is the maker's cumulative net cash. Letting C go negative would mint
  // guacas that were never paid in, which is exactly what an oversell attempts.
  //
  // Per-USER ownership ("you only hold 12 shares") is not knowable from q alone
  // and belongs to the trade API, which has the position rows.
  const costAfter = cost(qYesAfter, qNoAfter, b)
  if (costAfter < -1e-6) {
    throw new Error(
      `cannot sell ${shares} shares on ${side}: would take the maker below zero ` +
      `(C=${costAfter}), refunding guacas that were never paid in`,
    )
  }

  const exact = cost(qYes, qNo, b) - costAfter
  // Round the refund DOWN, for the same reason buys round up.
  const refund = Math.floor(exact + 1e-9)

  return { refund, avgPrice: exact / shares, qYesAfter, qNoAfter }
}
```

> **Corrected 2026-09-23 during execution.** The first draft of this task used a
> `shares > held` guard. That is a category error: `seedShares` returns
> `b·ln(p)`, which is **negative** for `p < 0.5`, so `q` is an offset rather than
> a share count — the guard rejected legitimate round-trips (selling back exactly
> what you just bought at a seed of 0.45 threw). Verified after the fix: a
> round-trip refunds exactly what was paid, while oversells at 1.0001×, 1.5×, 3×
> and 1e12 are all rejected.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd padelgod && npx vitest run src/lib/__tests__/lmsr.test.ts`
Expected: PASS — 18 tests

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/lmsr.ts padelgod/src/lib/__tests__/lmsr.test.ts
git commit -m "feat(play): LMSR buy/sell quotes with rounding against the user"
```

---

## Task 6: Resolver contract and registry

**Files:**
- Create: `padelgod/src/lib/market-resolvers/types.ts`
- Create: `padelgod/src/lib/market-resolvers/index.ts`
- Test: `padelgod/src/lib/__tests__/market-resolver-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `padelgod/src/lib/__tests__/market-resolver-registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getResolver, listResolverKeys, RESOLVERS } from '../market-resolvers/index.js'

describe('resolver registry', () => {
  it('exposes the phase-1 resolvers', () => {
    expect(listResolverKeys().sort()).toEqual(
      ['match.winner_is_pair', 'tournament.champion_is_pair'],
    )
  })

  it('returns a resolver by key', () => {
    expect(typeof getResolver('match.winner_is_pair')).toBe('function')
  })

  it('throws on an unknown key rather than returning undefined', () => {
    // A market frozen against a deleted resolver must fail loudly, not
    // silently never settle.
    expect(() => getResolver('match.nope')).toThrow(/unknown resolver/i)
  })

  it('every registered key matches its map key', () => {
    for (const [key, fn] of Object.entries(RESOLVERS)) {
      expect(typeof fn).toBe('function')
      expect(key).toMatch(/^[a-z]+\.[a-z_]+$/)
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd padelgod && npx vitest run src/lib/__tests__/market-resolver-registry.test.ts`
Expected: FAIL — cannot resolve `../market-resolvers/index.js`

- [ ] **Step 3: Write the contract**

Create `padelgod/src/lib/market-resolvers/types.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * What a resolver may look at. Deliberately narrow: a resolver reads our own
 * tables and nothing else. No HTTP, no clock beyond `now`, no writes.
 */
export interface ResolverContext {
  supabase: SupabaseClient
  marketId: string
  matchId: string | null
  tournamentId: string | null
  category: 'men' | 'women' | null
  tokens: Record<string, unknown>
  now: Date
}

export type ResolverResult =
  /** Not yet knowable. The market stays locked and is retried. */
  | { state: 'undecided' }
  /** Definite. `evidence` is shown verbatim to the operator. */
  | { state: 'decided'; outcome: boolean; evidence: Record<string, unknown> }
  /** Unresolvable for a structural reason — refund every position. */
  | { state: 'void'; reason: string }

export type Resolver = (
  ctx: ResolverContext,
  params: Record<string, unknown>,
) => Promise<ResolverResult>
```

- [ ] **Step 4: Write the registry**

Create `padelgod/src/lib/market-resolvers/index.ts`:

```ts
// The resolver registry.
//
// Operators select a key from this map and fill in parameters; they never
// author SQL. Free-text SQL in an admin panel is how a market silently
// settles wrong and pays out thousands of guacas.
//
// Resolvers are VERSIONED BY KEY. Changing what a resolver means requires a
// new key, because existing markets froze the old one at creation.

import type { Resolver } from './types.js'
import { matchWinnerIsPair } from './match-winner.js'
import { tournamentChampionIsPair } from './tournament-champion.js'

export type { Resolver, ResolverContext, ResolverResult } from './types.js'

export const RESOLVERS: Record<string, Resolver> = {
  'match.winner_is_pair': matchWinnerIsPair,
  'tournament.champion_is_pair': tournamentChampionIsPair,
}

export function listResolverKeys(): string[] {
  return Object.keys(RESOLVERS)
}

export function getResolver(key: string): Resolver {
  const fn = RESOLVERS[key]
  if (!fn) throw new Error(`unknown resolver: ${key}`)
  return fn
}
```

- [ ] **Step 5: Run the test to verify it fails on the missing resolvers**

Run: `cd padelgod && npx vitest run src/lib/__tests__/market-resolver-registry.test.ts`
Expected: FAIL — cannot resolve `./match-winner.js` (implemented in Task 7)

- [ ] **Step 6: Commit the contract**

```bash
git add padelgod/src/lib/market-resolvers/types.ts padelgod/src/lib/market-resolvers/index.ts padelgod/src/lib/__tests__/market-resolver-registry.test.ts
git commit -m "feat(play): resolver contract and registry"
```

---

## Task 7: Resolver — `match.winner_is_pair`

**Files:**
- Create: `padelgod/src/lib/market-resolvers/match-winner.ts`
- Test: `padelgod/src/lib/__tests__/resolver-match-winner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `padelgod/src/lib/__tests__/resolver-match-winner.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { matchWinnerIsPair } from '../market-resolvers/match-winner.js'
import type { ResolverContext } from '../market-resolvers/types.js'

/** Minimal Supabase stub: one table, one row, supporting .select().eq().maybeSingle() */
function stubSupabase(row: Record<string, unknown> | null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: row, error: null }),
  }
  return { from: () => chain } as never
}

function ctx(row: Record<string, unknown> | null): ResolverContext {
  return {
    supabase: stubSupabase(row),
    marketId: 'm1',
    matchId: 'match-1',
    tournamentId: null,
    category: 'men',
    tokens: {},
    now: new Date('2026-09-23T18:00:00Z'),
  }
}

describe('match.winner_is_pair', () => {
  it('resolves YES when the bound pair won', async () => {
    const r = await matchWinnerIsPair(
      ctx({ status: 'finished', winner_pair: 1 }), { pair: 1 },
    )
    expect(r).toEqual({
      state: 'decided',
      outcome: true,
      evidence: { status: 'finished', winner_pair: 1, asked_pair: 1 },
    })
  })

  it('resolves NO when the other pair won', async () => {
    const r = await matchWinnerIsPair(
      ctx({ status: 'finished', winner_pair: 2 }), { pair: 1 },
    )
    expect(r.state).toBe('decided')
    if (r.state === 'decided') expect(r.outcome).toBe(false)
  })

  it('is undecided while the match is still live', async () => {
    const r = await matchWinnerIsPair(
      ctx({ status: 'live', winner_pair: null }), { pair: 1 },
    )
    expect(r).toEqual({ state: 'undecided' })
  })

  it('is undecided when finished but the winner has not landed yet', async () => {
    // matches briefly sit in `finished` with a null winner_pair.
    const r = await matchWinnerIsPair(
      ctx({ status: 'finished', winner_pair: null }), { pair: 1 },
    )
    expect(r).toEqual({ state: 'undecided' })
  })

  it('voids a walkover — nobody played, so no pick was meaningful', async () => {
    const r = await matchWinnerIsPair(
      ctx({ status: 'walkover', winner_pair: 1 }), { pair: 1 },
    )
    expect(r.state).toBe('void')
  })

  it('DECIDES a retirement — a retired match has a real winner', async () => {
    const r = await matchWinnerIsPair(
      ctx({ status: 'retired', winner_pair: 2 }), { pair: 2 },
    )
    expect(r.state).toBe('decided')
    if (r.state === 'decided') expect(r.outcome).toBe(true)
  })

  it('voids when the match row has vanished', async () => {
    const r = await matchWinnerIsPair(ctx(null), { pair: 1 })
    expect(r.state).toBe('void')
  })

  it('throws on a malformed pair param rather than guessing', async () => {
    await expect(
      matchWinnerIsPair(ctx({ status: 'finished', winner_pair: 1 }), { pair: 3 }),
    ).rejects.toThrow(/pair/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd padelgod && npx vitest run src/lib/__tests__/resolver-match-winner.test.ts`
Expected: FAIL — cannot resolve `../market-resolvers/match-winner.js`

- [ ] **Step 3: Implement the resolver**

Create `padelgod/src/lib/market-resolvers/match-winner.ts`:

```ts
// match.winner_is_pair — "Will {pair} win this match?"
// Settles from matches.winner_pair, which is the authoritative signal.
// Deliberately does NOT derive a winner from set scores: score data is
// revisable by fip-results-writer, winner_pair is not.

import type { Resolver } from './types.js'

/** Statuses where a winner exists and the market is meaningful. */
const DECIDING_STATUSES = new Set(['finished', 'retired'])
/** Nobody played. A prediction about how they would play is not answerable. */
const VOID_STATUSES = new Set(['walkover', 'cancelled'])

export const matchWinnerIsPair: Resolver = async (ctx, params) => {
  const pair = params.pair
  if (pair !== 1 && pair !== 2) {
    throw new Error(`match.winner_is_pair: params.pair must be 1 or 2, got ${String(pair)}`)
  }

  const { data, error } = await ctx.supabase
    .from('matches')
    .select('status, winner_pair')
    .eq('id', ctx.matchId)
    .maybeSingle()

  if (error) throw new Error(`match.winner_is_pair: ${error.message}`)
  if (!data) return { state: 'void', reason: 'match row no longer exists' }

  const status = data.status as string | null
  const winner = data.winner_pair as number | null

  if (status && VOID_STATUSES.has(status)) {
    return { state: 'void', reason: `match ${status}` }
  }
  if (!status || !DECIDING_STATUSES.has(status)) return { state: 'undecided' }
  // `finished` with a null winner is a real transient state — wait for it.
  if (winner !== 1 && winner !== 2) return { state: 'undecided' }

  return {
    state: 'decided',
    outcome: winner === pair,
    evidence: { status, winner_pair: winner, asked_pair: pair },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd padelgod && npx vitest run src/lib/__tests__/resolver-match-winner.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/market-resolvers/match-winner.ts padelgod/src/lib/__tests__/resolver-match-winner.test.ts
git commit -m "feat(play): match.winner_is_pair resolver"
```

---

## Task 8: Resolver — `tournament.champion_is_pair`

**Files:**
- Create: `padelgod/src/lib/market-resolvers/tournament-champion.ts`
- Test: `padelgod/src/lib/__tests__/resolver-tournament-champion.test.ts`

- [ ] **Step 1: Write the failing test**

Create `padelgod/src/lib/__tests__/resolver-tournament-champion.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { tournamentChampionIsPair } from '../market-resolvers/tournament-champion.js'
import type { ResolverContext } from '../market-resolvers/types.js'

/** Stub returning a list from .select().eq().eq().eq() then awaited. */
function stubSupabase(rows: Record<string, unknown>[]) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    then: (res: (v: unknown) => unknown) => res({ data: rows, error: null }),
  }
  return { from: () => chain } as never
}

function ctx(rows: Record<string, unknown>[]): ResolverContext {
  return {
    supabase: stubSupabase(rows),
    marketId: 'm1',
    matchId: null,
    tournamentId: 'tour-1',
    category: 'men',
    tokens: { pair_key: 'p1::p2' },
    now: new Date('2026-09-23T18:00:00Z'),
  }
}

const PAIR = { player1Id: 'p1', player2Id: 'p2' }

describe('tournament.champion_is_pair', () => {
  it('is undecided while no final exists yet', async () => {
    const r = await tournamentChampionIsPair(ctx([]), PAIR)
    expect(r).toEqual({ state: 'undecided' })
  })

  it('is undecided when the final exists but has no winner', async () => {
    const r = await tournamentChampionIsPair(ctx([{
      id: 'f1', status: 'live', winner_pair: null,
      pair1_player1_id: 'p1', pair1_player2_id: 'p2',
      pair2_player1_id: 'p3', pair2_player2_id: 'p4',
    }]), PAIR)
    expect(r).toEqual({ state: 'undecided' })
  })

  it('resolves YES when the bound pair won the final', async () => {
    const r = await tournamentChampionIsPair(ctx([{
      id: 'f1', status: 'finished', winner_pair: 1,
      pair1_player1_id: 'p1', pair1_player2_id: 'p2',
      pair2_player1_id: 'p3', pair2_player2_id: 'p4',
    }]), PAIR)
    expect(r.state).toBe('decided')
    if (r.state === 'decided') expect(r.outcome).toBe(true)
  })

  it('matches a pair regardless of player order within the pair', async () => {
    const r = await tournamentChampionIsPair(ctx([{
      id: 'f1', status: 'finished', winner_pair: 2,
      pair1_player1_id: 'p3', pair1_player2_id: 'p4',
      pair2_player1_id: 'p2', pair2_player2_id: 'p1', // reversed
    }]), PAIR)
    expect(r.state).toBe('decided')
    if (r.state === 'decided') expect(r.outcome).toBe(true)
  })

  it('resolves NO when a different pair won', async () => {
    const r = await tournamentChampionIsPair(ctx([{
      id: 'f1', status: 'finished', winner_pair: 1,
      pair1_player1_id: 'p3', pair1_player2_id: 'p4',
      pair2_player1_id: 'p5', pair2_player2_id: 'p6',
    }]), PAIR)
    expect(r.state).toBe('decided')
    if (r.state === 'decided') expect(r.outcome).toBe(false)
  })

  it('voids when more than one final is present — the draw is ambiguous', async () => {
    const final = {
      status: 'finished', winner_pair: 1,
      pair1_player1_id: 'p1', pair1_player2_id: 'p2',
      pair2_player1_id: 'p3', pair2_player2_id: 'p4',
    }
    const r = await tournamentChampionIsPair(
      ctx([{ id: 'f1', ...final }, { id: 'f2', ...final }]), PAIR,
    )
    expect(r.state).toBe('void')
  })

  it('throws when the pair params are missing', async () => {
    await expect(tournamentChampionIsPair(ctx([]), {})).rejects.toThrow(/player/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd padelgod && npx vitest run src/lib/__tests__/resolver-tournament-champion.test.ts`
Expected: FAIL — cannot resolve `../market-resolvers/tournament-champion.js`

- [ ] **Step 3: Implement the resolver**

Create `padelgod/src/lib/market-resolvers/tournament-champion.ts`:

```ts
// tournament.champion_is_pair — "Will {pair} win {tournament}?"
// Settles from the final's winner_pair rather than from
// tournament_projections.status, because the projection worker is a model and
// this must settle on fact.

import type { Resolver } from './types.js'

const DECIDING_STATUSES = new Set(['finished', 'retired'])

function samePair(a1: unknown, a2: unknown, b1: string, b2: string): boolean {
  if (typeof a1 !== 'string' || typeof a2 !== 'string') return false
  // Pair membership is unordered — the draw does not guarantee player order.
  return (a1 === b1 && a2 === b2) || (a1 === b2 && a2 === b1)
}

export const tournamentChampionIsPair: Resolver = async (ctx, params) => {
  const p1 = params.player1Id
  const p2 = params.player2Id
  if (typeof p1 !== 'string' || typeof p2 !== 'string') {
    throw new Error('tournament.champion_is_pair: params.player1Id and player2Id are required')
  }

  const { data, error } = await ctx.supabase
    .from('matches')
    .select('id, status, winner_pair, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id')
    .eq('tournament_id', ctx.tournamentId)
    .eq('category', ctx.category)
    .eq('round', 'F')

  if (error) throw new Error(`tournament.champion_is_pair: ${error.message}`)

  const finals = (data ?? []) as Record<string, unknown>[]
  if (finals.length === 0) return { state: 'undecided' }
  if (finals.length > 1) {
    // Multi-draw events (Games/championship formats) can produce several rows
    // labelled F for one category. Refuse rather than pick one.
    return { state: 'void', reason: `${finals.length} rows with round='F' — ambiguous final` }
  }

  const f = finals[0]
  const status = f.status as string | null
  const winner = f.winner_pair as number | null

  if (!status || !DECIDING_STATUSES.has(status)) return { state: 'undecided' }
  if (winner !== 1 && winner !== 2) return { state: 'undecided' }

  const won = winner === 1
    ? samePair(f.pair1_player1_id, f.pair1_player2_id, p1, p2)
    : samePair(f.pair2_player1_id, f.pair2_player2_id, p1, p2)

  return {
    state: 'decided',
    outcome: won,
    evidence: {
      final_match_id: f.id, status, winner_pair: winner, asked_pair: [p1, p2],
    },
  }
}
```

- [ ] **Step 4: Run the resolver tests plus the registry test**

Run: `cd padelgod && npx vitest run src/lib/__tests__/resolver-tournament-champion.test.ts src/lib/__tests__/market-resolver-registry.test.ts`
Expected: PASS — 7 + 4 = 11 tests. The registry test now passes because both imports resolve.

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/market-resolvers/tournament-champion.ts padelgod/src/lib/__tests__/resolver-tournament-champion.test.ts
git commit -m "feat(play): tournament.champion_is_pair resolver"
```

---

> **Known gap for phase 2, found during execution.** `buildMarketRow` (Task 13)
> copies `template.params` onto every market it creates. That is fine for
> `match.winner_is_pair`, whose params are the same for all its markets
> (`{"pair": 1}`). It is **wrong for `tournament.champion_is_pair`**, which needs
> a *different* `player1Id`/`player2Id` per market — one market per pair in the
> draw. Phase 1 does not hit this because the generator only enumerates
> `horizon='pre-match'` templates, so no tournament market is ever created; the
> resolver is unit-tested but not wired end to end. Phase 2 must make candidate
> enumeration emit one candidate per pair, each carrying its own resolver params,
> and have `buildMarketRow` merge candidate params over template params.
> `ResolverContext.tokens` is the other available channel and is currently unused
> by both resolvers — pick one deliberately rather than populating both.

## Task 9: Settlement decision — the propose / hold / settle state machine

**Files:**
- Create: `padelgod/src/lib/market-settlement.ts`
- Test: `padelgod/src/lib/__tests__/market-settlement.test.ts`

This is the task that protects real balances. Crionet has marked a match `finished` ~20 minutes early **with the wrong winner**, twice at Paris Major. The hold rule below converts that upstream bug from an incident into a queued row.

- [ ] **Step 1: Write the failing test**

Create `padelgod/src/lib/__tests__/market-settlement.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { decideSettlement, CONFIRMATION_WINDOW_MS, type MarketState } from '../market-settlement.js'
import type { ResolverResult } from '../market-resolvers/types.js'

const NOW = new Date('2026-09-23T18:00:00Z')

function market(over: Partial<MarketState> = {}): MarketState {
  return {
    status: 'locked',
    proposedOutcome: null,
    proposedAt: null,
    settlesAt: null,
    ...over,
  }
}

describe('decideSettlement', () => {
  it('does nothing while the resolver is undecided', () => {
    const d = decideSettlement(market(), { state: 'undecided' }, NOW)
    expect(d).toEqual({ action: 'none' })
  })

  it('proposes when a locked market first becomes decidable', () => {
    const r: ResolverResult = { state: 'decided', outcome: true, evidence: { winner_pair: 1 } }
    const d = decideSettlement(market(), r, NOW)
    expect(d.action).toBe('propose')
    if (d.action === 'propose') {
      expect(d.outcome).toBe(true)
      expect(d.settlesAt.getTime()).toBe(NOW.getTime() + CONFIRMATION_WINDOW_MS)
    }
  })

  it('does not re-propose while the window is still running', () => {
    const m = market({
      status: 'proposed', proposedOutcome: true,
      proposedAt: new Date(NOW.getTime() - 60_000),
      settlesAt: new Date(NOW.getTime() + 60_000),
    })
    const r: ResolverResult = { state: 'decided', outcome: true, evidence: {} }
    expect(decideSettlement(m, r, NOW)).toEqual({ action: 'none' })
  })

  it('settles once the window has elapsed and the answer is unchanged', () => {
    const m = market({
      status: 'proposed', proposedOutcome: true,
      proposedAt: new Date(NOW.getTime() - 3_600_000),
      settlesAt: new Date(NOW.getTime() - 1_000),
    })
    const r: ResolverResult = { state: 'decided', outcome: true, evidence: {} }
    const d = decideSettlement(m, r, NOW)
    expect(d.action).toBe('settle')
    if (d.action === 'settle') expect(d.outcome).toBe(true)
  })

  it('HOLDS when the answer flips before the window elapses', () => {
    // The Crionet case: winner_pair=1 at 14:02, flipped to 2 at 14:21.
    const m = market({
      status: 'proposed', proposedOutcome: true,
      proposedAt: new Date(NOW.getTime() - 60_000),
      settlesAt: new Date(NOW.getTime() + 60_000),
    })
    const r: ResolverResult = { state: 'decided', outcome: false, evidence: {} }
    const d = decideSettlement(m, r, NOW)
    expect(d.action).toBe('hold')
    if (d.action === 'hold') expect(d.reason).toMatch(/changed/i)
  })

  it('HOLDS when the answer flips even after the window elapsed', () => {
    // Never auto-settle a market whose answer has ever moved.
    const m = market({
      status: 'proposed', proposedOutcome: true,
      proposedAt: new Date(NOW.getTime() - 3_600_000),
      settlesAt: new Date(NOW.getTime() - 1_000),
    })
    const r: ResolverResult = { state: 'decided', outcome: false, evidence: {} }
    expect(decideSettlement(m, r, NOW).action).toBe('hold')
  })

  it('HOLDS when a proposed market becomes undecided again', () => {
    const m = market({
      status: 'proposed', proposedOutcome: true,
      proposedAt: new Date(NOW.getTime() - 60_000),
      settlesAt: new Date(NOW.getTime() + 60_000),
    })
    expect(decideSettlement(m, { state: 'undecided' }, NOW).action).toBe('hold')
  })

  it('voids immediately — no confirmation window for a refund', () => {
    const d = decideSettlement(market(), { state: 'void', reason: 'walkover' }, NOW)
    expect(d).toEqual({ action: 'void', reason: 'walkover' })
  })

  it('ignores markets that are still open — locking comes first', () => {
    const r: ResolverResult = { state: 'decided', outcome: true, evidence: {} }
    expect(decideSettlement(market({ status: 'open' }), r, NOW)).toEqual({ action: 'none' })
  })

  it('ignores markets that are already settled or void', () => {
    const r: ResolverResult = { state: 'decided', outcome: true, evidence: {} }
    expect(decideSettlement(market({ status: 'settled' }), r, NOW)).toEqual({ action: 'none' })
    expect(decideSettlement(market({ status: 'void' }), r, NOW)).toEqual({ action: 'none' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd padelgod && npx vitest run src/lib/__tests__/market-settlement.test.ts`
Expected: FAIL — cannot resolve `../market-settlement.js`

- [ ] **Step 3: Implement the state machine**

Create `padelgod/src/lib/market-settlement.ts`:

```ts
// The propose → confirm → settle decision, as a pure function.
//
// Auto-resolution PROPOSES; settlement happens only after a confirmation
// window. Crionet has marked a match `finished` roughly twenty minutes early
// WITH THE WRONG WINNER, twice at Paris Major. With instant payout, guacas
// would move on a phantom result and we would be clawing balances back from
// users. This window turns an upstream bug into a held row.

import type { ResolverResult } from './market-resolvers/types.js'

/** 30 minutes. Long enough to catch a premature-finish reversal. */
export const CONFIRMATION_WINDOW_MS = 30 * 60 * 1000

export interface MarketState {
  // 'held' is persisted and only an operator moves a market out of it.
  status: 'open' | 'locked' | 'proposed' | 'held' | 'settled' | 'void'
  proposedOutcome: boolean | null
  proposedAt: Date | null
  settlesAt: Date | null
}

export type SettlementDecision =
  | { action: 'none' }
  | { action: 'propose'; outcome: boolean; evidence: Record<string, unknown>; settlesAt: Date }
  | { action: 'settle'; outcome: boolean }
  | { action: 'hold'; reason: string }
  | { action: 'void'; reason: string }

export function decideSettlement(
  market: MarketState,
  result: ResolverResult,
  now: Date,
): SettlementDecision {
  // Only locked and proposed markets are in play. `open` has not stopped
  // trading; settled/void are terminal; 'held' is terminal until an operator
  // intervenes. That last one is the whole safety guarantee: without this
  // short-circuit a held market reverts to auto-settling the moment the
  // upstream answer flaps back to its original value.
  if (market.status !== 'locked' && market.status !== 'proposed') {
    return { action: 'none' }
  }

  if (result.state === 'void') {
    // A refund needs no confirmation window — nobody can be harmed by it.
    // NOTE: a proposed→void transition IS an answer change, but void refunds
    // every position at cost basis, so no user can lose by it. Deliberate.
    return { action: 'void', reason: result.reason }
  }

  // A proposed market with no settles_at can never advance and never reaches
  // the hold path, so it would sit invisible to the operator queue forever.
  // Surface it instead.
  if (market.status === 'proposed' && market.settlesAt === null) {
    return { action: 'hold', reason: 'proposed market has no settles_at — incomplete record' }
  }

  if (result.state === 'undecided') {
    // Going backwards from a proposal means the upstream data moved under us.
    if (market.status === 'proposed') {
      return { action: 'hold', reason: 'resolver became undecided after proposing' }
    }
    return { action: 'none' }
  }

  // result.state === 'decided'
  if (market.status === 'locked') {
    return {
      action: 'propose',
      outcome: result.outcome,
      evidence: result.evidence,
      settlesAt: new Date(now.getTime() + CONFIRMATION_WINDOW_MS),
    }
  }

  // Already proposed. The single most important rule in the pipeline:
  // if the answer has CHANGED, hold forever and never auto-settle.
  if (market.proposedOutcome !== result.outcome) {
    return {
      action: 'hold',
      reason: `resolver answer changed: proposed ${market.proposedOutcome}, now ${result.outcome}`,
    }
  }

  if (market.settlesAt && now.getTime() >= market.settlesAt.getTime()) {
    return { action: 'settle', outcome: result.outcome }
  }

  return { action: 'none' }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd padelgod && npx vitest run src/lib/__tests__/market-settlement.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/market-settlement.ts padelgod/src/lib/__tests__/market-settlement.test.ts
git commit -m "feat(play): settlement state machine with hold-on-change rule"
```

---

## Checkpoint

Run the whole padelgod suite before moving to gates and workers:

Run: `cd padelgod && npx vitest run`
Expected: all pre-existing tests still pass, plus 39 new ones.

---

## Task 10: Eligibility gates and candidate scoring

**Files:**
- Create: `padelgod/src/lib/market-gates.ts`
- Test: `padelgod/src/lib/__tests__/market-gates.test.ts`

- [ ] **Step 1: Write the failing test**

Create `padelgod/src/lib/__tests__/market-gates.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { passesGates, scoreCandidate, type Candidate, type Gates } from '../market-gates.js'

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    key: 'c1',
    matchId: 'match-1',
    tournamentId: null,
    category: 'men',
    round: 'SF',
    bestRanking: 4,
    modelProb: 0.55,
    scheduledAt: new Date('2026-09-26T18:00:00Z'),
    ...over,
  }
}

const GATES: Gates = {
  rounds: ['SF', 'F'],
  minRanking: 50,
  competitiveness: [0.35, 0.65],
}

describe('passesGates', () => {
  it('passes a candidate meeting every gate', () => {
    expect(passesGates(candidate(), GATES)).toEqual({ ok: true })
  })

  it('rejects a round outside the gate', () => {
    const r = passesGates(candidate({ round: 'R16' }), GATES)
    expect(r).toEqual({ ok: false, reason: 'below round gate' })
  })

  it('treats a null round as failing the round gate', () => {
    expect(passesGates(candidate({ round: null }), GATES).ok).toBe(false)
  })

  it('rejects when no player is inside the ranking gate', () => {
    const r = passesGates(candidate({ bestRanking: 120 }), GATES)
    expect(r).toEqual({ ok: false, reason: 'no top-50 player' })
  })

  it('treats an unranked field as failing the ranking gate', () => {
    expect(passesGates(candidate({ bestRanking: null }), GATES).ok).toBe(false)
  })

  it('rejects a foregone conclusion', () => {
    const r = passesGates(candidate({ modelProb: 0.92 }), GATES)
    expect(r).toEqual({ ok: false, reason: 'outside competitiveness band' })
  })

  it('rejects a foregone conclusion on the other side too', () => {
    expect(passesGates(candidate({ modelProb: 0.08 }), GATES).ok).toBe(false)
  })

  it('rejects a missing model probability — no anchor, no market', () => {
    const r = passesGates(candidate({ modelProb: null }), GATES)
    expect(r).toEqual({ ok: false, reason: 'no seed price available' })
  })

  it('rejects a missing scheduled_at — the market could never lock', () => {
    // A country absent from country-timezone.ts blanks scheduled_at for a
    // whole event. Without it, locks_at is unknowable.
    const r = passesGates(candidate({ scheduledAt: null }), GATES)
    expect(r).toEqual({ ok: false, reason: 'no scheduled_at' })
  })

  it('applies only the gates that are specified', () => {
    expect(passesGates(candidate({ round: 'R64', bestRanking: 900 }), {}).ok).toBe(true)
  })
})

describe('scoreCandidate', () => {
  it('ranks a final above a semi-final', () => {
    expect(scoreCandidate(candidate({ round: 'F' })))
      .toBeGreaterThan(scoreCandidate(candidate({ round: 'SF' })))
  })

  it('ranks a better-ranked field higher', () => {
    expect(scoreCandidate(candidate({ bestRanking: 1 })))
      .toBeGreaterThan(scoreCandidate(candidate({ bestRanking: 40 })))
  })

  it('ranks a coin-flip above a lopsided match', () => {
    expect(scoreCandidate(candidate({ modelProb: 0.50 })))
      .toBeGreaterThan(scoreCandidate(candidate({ modelProb: 0.64 })))
  })

  it('is deterministic', () => {
    expect(scoreCandidate(candidate())).toBe(scoreCandidate(candidate()))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd padelgod && npx vitest run src/lib/__tests__/market-gates.test.ts`
Expected: FAIL — cannot resolve `../market-gates.js`

- [ ] **Step 3: Implement the gates**

Create `padelgod/src/lib/market-gates.ts`:

```ts
// Eligibility gates and candidate scoring for the market generator.
//
// The binding constraint on this product is liquidity per market, not
// database size. At ~40 daily actives making ~120 trades, 300 markets yields
// 0.4 trades each and every price sits frozen at its seed. These gates exist
// to keep the open-market count near `daily actives ÷ 10`.

export interface Candidate {
  /** Stable identity for dedup/logging, e.g. `${templateKey}:${matchId}`. */
  key: string
  matchId: string | null
  tournamentId: string | null
  category: 'men' | 'women' | null
  round: string | null
  /** Best (lowest) FIP ranking across the four players; null if unranked. */
  bestRanking: number | null
  /** Model probability for the YES side; null when no anchor exists. */
  modelProb: number | null
  scheduledAt: Date | null
  /** This market's subsidy in guacas — the template's max_loss_guacas, i.e.
   *  lmsr_b · ln(2). Per-template, NOT a constant: match.winner is 12,000
   *  while tournament.outright is 40,000. Using a flat rate made the
   *  generator believe 20 markets cost 40% of budget when it was 96%. */
  subsidyGuacas: number
}

export interface Gates {
  rounds?: string[]
  minRanking?: number
  /** Inclusive [lo, hi] band on modelProb. */
  competitiveness?: [number, number]
  dailyCap?: number
}

export type GateResult = { ok: true } | { ok: false; reason: string }

/** Round ordering for scoring. Higher is later in the draw. */
const ROUND_WEIGHT: Record<string, number> = {
  F: 100, SF: 80, QF: 60, R16: 45, R32: 30, R64: 20,
  Q3: 12, Q2: 8, Q1: 5,
}

export function passesGates(c: Candidate, g: Gates): GateResult {
  // A market with no anchor would open at a blank 50/50, which is the exact
  // cold-start failure this product is designed to avoid.
  if (c.modelProb === null) return { ok: false, reason: 'no seed price available' }

  // Without scheduled_at the market has no lock time and would trade forever.
  if (c.scheduledAt === null) return { ok: false, reason: 'no scheduled_at' }

  if (g.rounds && g.rounds.length > 0) {
    if (!c.round || !g.rounds.includes(c.round)) {
      return { ok: false, reason: 'below round gate' }
    }
  }

  if (typeof g.minRanking === 'number') {
    if (c.bestRanking === null || c.bestRanking > g.minRanking) {
      return { ok: false, reason: `no top-${g.minRanking} player` }
    }
  }

  if (g.competitiveness) {
    const [lo, hi] = g.competitiveness
    if (c.modelProb < lo || c.modelProb > hi) {
      return { ok: false, reason: 'outside competitiveness band' }
    }
  }

  return { ok: true }
}

/**
 * Higher is more worth opening. Used to pick the top N when more candidates
 * survive the gates than the caps allow.
 */
export function scoreCandidate(c: Candidate): number {
  const roundScore = c.round ? (ROUND_WEIGHT[c.round] ?? 10) : 10

  // Rank 1 → 50 points, rank 50 → ~13, unranked → 0.
  const rankScore = c.bestRanking === null ? 0 : 50 / Math.log2(c.bestRanking + 2) * 0.6

  // A coin flip is the most interesting market; 0.5 → 40, 0.65 → 28.
  const closeness = c.modelProb === null ? 0 : (1 - Math.abs(c.modelProb - 0.5) * 2) * 40

  return roundScore + rankScore + closeness
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd padelgod && npx vitest run src/lib/__tests__/market-gates.test.ts`
Expected: PASS — 14 tests

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/market-gates.ts padelgod/src/lib/__tests__/market-gates.test.ts
git commit -m "feat(play): eligibility gates and candidate scoring"
```

---

## Task 11: Cap application with itemised drops

**Files:**
- Modify: `padelgod/src/lib/market-gates.ts`
- Test: `padelgod/src/lib/__tests__/market-caps.test.ts`

- [ ] **Step 1: Write the failing test**

Create `padelgod/src/lib/__tests__/market-caps.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { applyCaps, type Candidate, type Caps } from '../market-gates.js'

function c(key: string, over: Partial<Candidate> = {}): Candidate {
  return {
    key,
    matchId: `match-${key}`,
    tournamentId: 'tour-1',
    category: 'men',
    round: 'SF',
    bestRanking: 5,
    modelProb: 0.5,
    scheduledAt: new Date('2026-09-26T18:00:00Z'),
    ...over,
  }
}

const CAPS: Caps = {
  maxOpenMarkets: 15,
  currentOpen: 0,
  maxNewPerDay: 20,
  createdToday: 0,
  maxPerMatch: 3,
  existingPerMatch: {},
  maxPerTournamentDay: 8,
  createdPerTournamentToday: {},
  maxSubsidyPerDay: 250_000,
  subsidyUsedToday: 0,
  subsidyPerMarket: 5_000,
}

describe('applyCaps', () => {
  it('keeps everything when nothing binds', () => {
    const r = applyCaps([c('a'), c('b')], CAPS)
    expect(r.kept.map(k => k.key)).toEqual(['a', 'b'])
    expect(r.drops).toEqual([])
  })

  it('keeps the highest-scoring candidates when the global cap binds', () => {
    const cands = [
      c('boring', { modelProb: 0.64 }),
      c('close', { modelProb: 0.50 }),
    ]
    const r = applyCaps(cands, { ...CAPS, maxOpenMarkets: 1, currentOpen: 0 })
    expect(r.kept.map(k => k.key)).toEqual(['close'])
    expect(r.drops).toEqual([{ reason: 'over global open cap', count: 1 }])
  })

  it('counts markets already open against the global cap', () => {
    const r = applyCaps([c('a'), c('b')], { ...CAPS, maxOpenMarkets: 15, currentOpen: 14 })
    expect(r.kept).toHaveLength(1)
    expect(r.drops).toEqual([{ reason: 'over global open cap', count: 1 }])
  })

  it('enforces the per-match cap including markets that already exist', () => {
    const same = [c('a', { matchId: 'm1' }), c('b', { matchId: 'm1' })]
    const r = applyCaps(same, { ...CAPS, maxPerMatch: 3, existingPerMatch: { m1: 2 } })
    expect(r.kept).toHaveLength(1)
    expect(r.drops).toEqual([{ reason: 'over per-match cap', count: 1 }])
  })

  it('enforces the per-tournament-per-day cap', () => {
    const cands = [c('a'), c('b'), c('c')]
    const r = applyCaps(cands, {
      ...CAPS, maxPerTournamentDay: 8, createdPerTournamentToday: { 'tour-1': 6 },
    })
    expect(r.kept).toHaveLength(2)
    expect(r.drops).toEqual([{ reason: 'over per-tournament daily cap', count: 1 }])
  })

  it('enforces the daily subsidy budget', () => {
    const cands = [c('a'), c('b'), c('c')]
    const r = applyCaps(cands, {
      ...CAPS, maxSubsidyPerDay: 10_000, subsidyUsedToday: 0, subsidyPerMarket: 5_000,
    })
    expect(r.kept).toHaveLength(2)
    expect(r.drops).toEqual([{ reason: 'over daily subsidy budget', count: 1 }])
  })

  it('aggregates drop reasons rather than listing one row per candidate', () => {
    const cands = [c('a'), c('b'), c('c'), c('d')]
    const r = applyCaps(cands, { ...CAPS, maxNewPerDay: 2, createdToday: 0 })
    expect(r.drops).toEqual([{ reason: 'over daily new-market cap', count: 2 }])
  })

  it('returns an empty result without throwing when every cap is exhausted', () => {
    const r = applyCaps([c('a')], { ...CAPS, maxOpenMarkets: 0 })
    expect(r.kept).toEqual([])
    expect(r.drops).toEqual([{ reason: 'over global open cap', count: 1 }])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd padelgod && npx vitest run src/lib/__tests__/market-caps.test.ts`
Expected: FAIL — `applyCaps` is not exported

- [ ] **Step 3: Implement cap application**

Append to `padelgod/src/lib/market-gates.ts`:

```ts
export interface Caps {
  maxOpenMarkets: number
  currentOpen: number
  maxNewPerDay: number
  createdToday: number
  maxPerMatch: number
  /** matchId → markets that already exist for it. */
  existingPerMatch: Record<string, number>
  maxPerTournamentDay: number
  /** tournamentId → markets created for it today. */
  createdPerTournamentToday: Record<string, number>
  maxSubsidyPerDay: number
  subsidyUsedToday: number
}

export interface CapResult {
  kept: Candidate[]
  /** Aggregated by reason. Never truncate silently — a generator that drops
   *  work without saying so looks identical to one that covered everything. */
  drops: { reason: string; count: number }[]
}

export function applyCaps(candidates: Candidate[], caps: Caps): CapResult {
  // Best-first, so whatever survives is the most worth opening.
  const ordered = [...candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a))

  const kept: Candidate[] = []
  const dropCounts = new Map<string, number>()
  const drop = (reason: string) => dropCounts.set(reason, (dropCounts.get(reason) ?? 0) + 1)

  let open = caps.currentOpen
  let today = caps.createdToday
  let subsidy = caps.subsidyUsedToday
  const perMatch = { ...caps.existingPerMatch }
  const perTournament = { ...caps.createdPerTournamentToday }

  for (const cand of ordered) {
    if (open >= caps.maxOpenMarkets) { drop('over global open cap'); continue }
    if (today >= caps.maxNewPerDay) { drop('over daily new-market cap'); continue }

    if (cand.matchId) {
      const used = perMatch[cand.matchId] ?? 0
      if (used >= caps.maxPerMatch) { drop('over per-match cap'); continue }
    }

    if (cand.tournamentId) {
      const used = perTournament[cand.tournamentId] ?? 0
      if (used >= caps.maxPerTournamentDay) { drop('over per-tournament daily cap'); continue }
    }

    if (subsidy + cand.subsidyGuacas > caps.maxSubsidyPerDay) {
      drop('over daily subsidy budget'); continue
    }

    kept.push(cand)
    open += 1
    today += 1
    subsidy += cand.subsidyGuacas
    if (cand.matchId) perMatch[cand.matchId] = (perMatch[cand.matchId] ?? 0) + 1
    if (cand.tournamentId) perTournament[cand.tournamentId] = (perTournament[cand.tournamentId] ?? 0) + 1
  }

  return {
    kept,
    drops: [...dropCounts.entries()].map(([reason, count]) => ({ reason, count })),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd padelgod && npx vitest run src/lib/__tests__/market-caps.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/market-gates.ts padelgod/src/lib/__tests__/market-caps.test.ts
git commit -m "feat(play): cap application with itemised drop reasons"
```

---

## Task 12: Mapping match rows to candidates

**Files:**
- Create: `padelgod/src/lib/market-candidates.ts`
- Test: `padelgod/src/lib/__tests__/market-candidates.test.ts`

Keeping the row→candidate mapping pure means the generator worker's only untested surface is the database round-trip itself.

- [ ] **Step 1: Write the failing test**

Create `padelgod/src/lib/__tests__/market-candidates.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { matchRowToCandidate, type MatchRow } from '../market-candidates.js'

function row(over: Partial<MatchRow> = {}): MatchRow {
  return {
    id: 'match-1',
    tournament_id: 'tour-1',
    category: 'men',
    round: 'SF',
    scheduled_at: '2026-09-26T18:00:00Z',
    pred_pair1_prob: '0.62',
    pair1_player1_id: 'p1', pair1_player2_id: 'p2',
    pair2_player1_id: 'p3', pair2_player2_id: 'p4',
    ...over,
  }
}

const RANKS = new Map([['p1', 3], ['p2', 8], ['p3', 22], ['p4', 60]])

describe('matchRowToCandidate', () => {
  it('maps the happy path', () => {
    const c = matchRowToCandidate(row(), RANKS, 'match.winner')
    expect(c.key).toBe('match.winner:match-1')
    expect(c.matchId).toBe('match-1')
    expect(c.tournamentId).toBe('tour-1')
    expect(c.round).toBe('SF')
    expect(c.modelProb).toBeCloseTo(0.62, 6)
  })

  it('coerces pred_pair1_prob from the string PostgREST returns', () => {
    // PostgREST serialises numeric as a string; a naive read yields NaN.
    expect(matchRowToCandidate(row({ pred_pair1_prob: '0.34' }), RANKS, 't').modelProb)
      .toBeCloseTo(0.34, 6)
  })

  it('uses the best (lowest) ranking across all four players', () => {
    expect(matchRowToCandidate(row(), RANKS, 't').bestRanking).toBe(3)
  })

  it('ignores unranked players when finding the best ranking', () => {
    const c = matchRowToCandidate(row(), new Map([['p3', 22]]), 't')
    expect(c.bestRanking).toBe(22)
  })

  it('reports a fully unranked field as null, not Infinity', () => {
    expect(matchRowToCandidate(row(), new Map(), 't').bestRanking).toBeNull()
  })

  it('reports a missing prediction as null rather than NaN', () => {
    expect(matchRowToCandidate(row({ pred_pair1_prob: null }), RANKS, 't').modelProb).toBeNull()
  })

  it('reports a missing scheduled_at as null', () => {
    expect(matchRowToCandidate(row({ scheduled_at: null }), RANKS, 't').scheduledAt).toBeNull()
  })

  it('parses scheduled_at into a Date', () => {
    const c = matchRowToCandidate(row(), RANKS, 't')
    expect(c.scheduledAt?.toISOString()).toBe('2026-09-26T18:00:00.000Z')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd padelgod && npx vitest run src/lib/__tests__/market-candidates.test.ts`
Expected: FAIL — cannot resolve `../market-candidates.js`

- [ ] **Step 3: Implement the mapping**

Create `padelgod/src/lib/market-candidates.ts`:

```ts
// Row → Candidate mapping for the market generator.

import type { Candidate } from './market-gates.js'

export interface MatchRow {
  id: string
  tournament_id: string | null
  category: string | null
  round: string | null
  scheduled_at: string | null
  /** PostgREST returns numeric columns as strings. */
  pred_pair1_prob: string | number | null
  pair1_player1_id: string | null
  pair1_player2_id: string | null
  pair2_player1_id: string | null
  pair2_player2_id: string | null
}

function bestRanking(row: MatchRow, ranks: Map<string, number>): number | null {
  const ids = [
    row.pair1_player1_id, row.pair1_player2_id,
    row.pair2_player1_id, row.pair2_player2_id,
  ]
  let best: number | null = null
  for (const id of ids) {
    if (!id) continue
    const r = ranks.get(id)
    if (typeof r !== 'number') continue
    if (best === null || r < best) best = r
  }
  return best
}

export function matchRowToCandidate(
  row: MatchRow,
  ranks: Map<string, number>,
  templateKey: string,
): Candidate {
  const raw = row.pred_pair1_prob
  const prob = raw === null || raw === undefined ? null : Number(raw)

  return {
    key: `${templateKey}:${row.id}`,
    matchId: row.id,
    tournamentId: row.tournament_id,
    category: row.category === 'women' ? 'women' : row.category === 'men' ? 'men' : null,
    round: row.round,
    bestRanking: bestRanking(row, ranks),
    modelProb: prob !== null && Number.isFinite(prob) ? prob : null,
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at) : null,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd padelgod && npx vitest run src/lib/__tests__/market-candidates.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/market-candidates.ts padelgod/src/lib/__tests__/market-candidates.test.ts
git commit -m "feat(play): match row to candidate mapping"
```

---

> **Five findings about `applyCaps`, surfaced during execution.** None break a
> specified test; all four of the first are phase-2 concerns that the generator
> consuming these functions must handle.
>
> 1. **A single template can monopolise the whole slate.** `applyCaps` sorts
>    globally by `scoreCandidate` with no per-template cap. A match-winner
>    candidate (round `F`) scores ~155; a tournament-champion candidate scores
>    ~65 because its `round` is null and falls to the `?? 10` default. Measured:
>    20 match candidates + 4 champion candidates against `maxOpenMarkets: 15`
>    keeps **15 match markets and zero champions**, reporting only
>    `over global open cap ×9`. An operator cannot tell a whole product surface
>    was zeroed. Phase 1 does not hit this — only one template (`horizon =
>    'pre-match'`) is ever enumerated. **Fix before phase 2:** add `templateKey`
>    to `Candidate` and a per-template reservation to `Caps`.
> 2. **Aggregated drops lose identity and severity.** Drops carry counts, never
>    keys, so "why is there no market for the Coello/Tapia final?" — the likeliest
>    operator question — is unanswerable. And `{count: 1}` (normal pressure) is
>    structurally identical to `{count: 289}` (gates miscalibrated, 95% of work
>    discarded). Both read as healthy. `drops` ordering is Map-insertion order
>    and varies with input — do not snapshot-test it.
> 3. **A subsidy misconfiguration presents as routine.** `subsidyPerMarket >
>    maxSubsidyPerDay` drops every candidate at *zero* usage with the ordinary
>    `over daily subsidy budget` message. Worth a distinct error.
> 4. **`Gates.dailyCap` is declared but never read** — `passesGates` ignores it
>    and `applyCaps` takes `Caps`, not `Gates`. Removed from the seed migration
>    (Task 16) so no operator sets dead config; the field stays in the type
>    pending the per-template work in (1).
> 5. **No dedup on `key`.** A candidate with both `matchId` and `tournamentId`
>    null bypasses the per-match and per-tournament caps entirely and can be kept
>    twice. The generator must dedup by `key` itself.

## Task 13: `market-generator` worker

**Files:**
- Create: `padelgod/src/workers/market-generator.ts`
- Test: `padelgod/src/workers/__tests__/market-generator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `padelgod/src/workers/__tests__/market-generator.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildMarketRow } from '../market-generator.js'
import { priceYes } from '../../lib/lmsr.js'

const TEMPLATE = {
  id: 'tpl-1',
  key: 'match.winner',
  resolver_key: 'match.winner_is_pair',
  params: { pair: 1 },
  max_loss_guacas: 5000,
  seed_source: 'elo',
  lock_rule: 'match_start' as const,
}

const CANDIDATE = {
  key: 'match.winner:match-1',
  matchId: 'match-1',
  tournamentId: 'tour-1',
  category: 'men' as const,
  round: 'SF',
  bestRanking: 3,
  modelProb: 0.62,
  scheduledAt: new Date('2026-09-26T18:00:00Z'),
}

describe('buildMarketRow', () => {
  it('derives b from the template ceiling', () => {
    const r = buildMarketRow(TEMPLATE, CANDIDATE, 'season-1')
    expect(r.lmsr_b).toBeCloseTo(5000 / Math.LN2, 4)
  })

  it('opens at exactly the model probability', () => {
    const r = buildMarketRow(TEMPLATE, CANDIDATE, 'season-1')
    expect(priceYes(r.q_yes, r.q_no, r.lmsr_b)).toBeCloseTo(0.62, 9)
    expect(r.seed_prob).toBeCloseTo(0.62, 6)
  })

  it('freezes the resolver and its params onto the row', () => {
    const r = buildMarketRow(TEMPLATE, CANDIDATE, 'season-1')
    expect(r.resolver_key).toBe('match.winner_is_pair')
    expect(r.resolver_params).toEqual({ pair: 1 })
  })

  it('locks at the match start for lock_rule=match_start', () => {
    const r = buildMarketRow(TEMPLATE, CANDIDATE, 'season-1')
    expect(r.locks_at).toBe('2026-09-26T18:00:00.000Z')
  })

  it('opens the market', () => {
    expect(buildMarketRow(TEMPLATE, CANDIDATE, 'season-1').status).toBe('open')
  })

  it('clamps an extreme model probability away from 0 and 1', () => {
    // seed_prob has a CHECK (> 0 AND < 1); a model returning 0.999 must not
    // violate it, and ln(0) would be -Infinity.
    const r = buildMarketRow(TEMPLATE, { ...CANDIDATE, modelProb: 0.9999 }, 'season-1')
    expect(r.seed_prob).toBeLessThan(1)
    expect(Number.isFinite(r.q_yes)).toBe(true)
    expect(Number.isFinite(r.q_no)).toBe(true)
  })

  it('throws when the candidate has no model probability', () => {
    expect(() => buildMarketRow(TEMPLATE, { ...CANDIDATE, modelProb: null }, 's'))
      .toThrow(/seed/i)
  })

  it('throws when the candidate has no scheduled_at', () => {
    expect(() => buildMarketRow(TEMPLATE, { ...CANDIDATE, scheduledAt: null }, 's'))
      .toThrow(/lock/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd padelgod && npx vitest run src/workers/__tests__/market-generator.test.ts`
Expected: FAIL — cannot resolve `../market-generator.js`

- [ ] **Step 3: Implement the worker**

Create `padelgod/src/workers/market-generator.ts`:

```ts
// market-generator — turns templates × calendar into markets.
//
// Hourly at :25. Flag: ENABLE_MARKET_GENERATOR (default off),
// MARKET_GENERATOR_DRY_RUN (default on).
//
// Spec: docs/superpowers/specs/2026-09-23-prediction-market-design.md

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Logger } from 'pino'
import { bFromMaxLoss, seedShares } from '../lib/lmsr.js'
import { applyCaps, passesGates, type Candidate, type Gates } from '../lib/market-gates.js'
import { matchRowToCandidate, type MatchRow } from '../lib/market-candidates.js'
import { isPremierTier } from './match-stats-fetcher.js'

/** Never seed at a probability the CHECK constraint would reject. */
const SEED_MIN = 0.02
const SEED_MAX = 0.98

export interface GeneratorTemplate {
  id: string
  key: string
  resolver_key: string
  params: Record<string, unknown>
  max_loss_guacas: number
  seed_source: string
  lock_rule: 'match_start' | 'round_first_ball' | 'final_start'
}

export interface MarketRow {
  season_id: string
  template_id: string
  match_id: string | null
  tournament_id: string | null
  category: string | null
  tokens: Record<string, unknown>
  resolver_key: string
  resolver_params: Record<string, unknown>
  lmsr_b: number
  seed_prob: number
  seed_source: string
  q_yes: number
  q_no: number
  status: 'open'
  locks_at: string
}

export function buildMarketRow(
  template: GeneratorTemplate,
  candidate: Candidate,
  seasonId: string,
): MarketRow {
  if (candidate.modelProb === null) {
    throw new Error(`cannot seed market for ${candidate.key}: no model probability`)
  }
  if (candidate.scheduledAt === null) {
    throw new Error(`cannot lock market for ${candidate.key}: no scheduled_at`)
  }

  const p = Math.min(SEED_MAX, Math.max(SEED_MIN, candidate.modelProb))
  const b = bFromMaxLoss(template.max_loss_guacas)
  const { qYes, qNo } = seedShares(p, b)

  return {
    season_id: seasonId,
    template_id: template.id,
    match_id: candidate.matchId,
    tournament_id: candidate.matchId ? null : candidate.tournamentId,
    category: candidate.category,
    tokens: {},
    resolver_key: template.resolver_key,
    resolver_params: template.params,
    lmsr_b: b,
    seed_prob: p,
    seed_source: template.seed_source,
    q_yes: qYes,
    q_no: qNo,
    status: 'open',
    locks_at: candidate.scheduledAt.toISOString(),
  }
}

export interface MarketGeneratorDeps {
  supabase: SupabaseClient
  logger?: Logger
  dryRun: boolean
  now?: () => Date
}

export interface MarketGeneratorResult {
  dryRun: boolean
  templatesConsidered: number
  candidates: number
  gateDrops: { reason: string; count: number }[]
  capDrops: { reason: string; count: number }[]
  created: number
  durationMs: number
}

export async function runMarketGenerator(
  deps: MarketGeneratorDeps,
): Promise<MarketGeneratorResult> {
  const started = Date.now()
  const now = deps.now?.() ?? new Date()
  const log = deps.logger

  const result: MarketGeneratorResult = {
    dryRun: deps.dryRun,
    templatesConsidered: 0,
    candidates: 0,
    gateDrops: [],
    capDrops: [],
    created: 0,
    durationMs: 0,
  }

  const { data: season } = await deps.supabase
    .from('market_seasons').select('id').eq('status', 'active').maybeSingle()
  if (!season) {
    log?.warn('market-generator: no active season, nothing to do')
    result.durationMs = Date.now() - started
    return result
  }

  const { data: limits } = await deps.supabase
    .from('market_limits').select('*').maybeSingle()
  if (!limits) throw new Error('market-generator: market_limits row is missing')

  const { data: templates } = await deps.supabase
    .from('market_templates')
    .select('id, key, resolver_key, params, gates, max_loss_guacas, seed_source, lock_rule, horizon')
    .eq('enabled', true)
    .eq('horizon', 'pre-match')

  result.templatesConsidered = templates?.length ?? 0
  if (!templates || templates.length === 0) {
    result.durationMs = Date.now() - started
    return result
  }

  // Premier-tier tournaments currently in window.
  const { data: tours } = await deps.supabase
    .from('tournaments').select('id, level').in('status', ['live', 'ongoing', 'upcoming'])
  const premierIds = (tours ?? []).filter(t => isPremierTier(t.level)).map(t => t.id)
  if (premierIds.length === 0) {
    result.durationMs = Date.now() - started
    return result
  }

  const { data: matchRows } = await deps.supabase
    .from('matches')
    .select('id, tournament_id, category, round, scheduled_at, pred_pair1_prob, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id')
    .in('tournament_id', premierIds)
    .eq('status', 'scheduled')
    .gt('scheduled_at', now.toISOString())

  const rows = (matchRows ?? []) as MatchRow[]

  // Rankings for the gate, in one query rather than per candidate.
  const playerIds = new Set<string>()
  for (const r of rows) {
    for (const id of [r.pair1_player1_id, r.pair1_player2_id, r.pair2_player1_id, r.pair2_player2_id]) {
      if (id) playerIds.add(id)
    }
  }
  const ranks = new Map<string, number>()
  if (playerIds.size > 0) {
    const { data: players } = await deps.supabase
      .from('players').select('id, ranking').in('id', [...playerIds])
    for (const p of players ?? []) {
      if (typeof p.ranking === 'number') ranks.set(p.id as string, p.ranking)
    }
  }

  // Markets that already exist, for the per-match cap and dedup.
  const { data: existing } = await deps.supabase
    .from('markets').select('template_id, match_id, status')
    .eq('season_id', season.id)
  const existingKeys = new Set(
    (existing ?? []).filter(m => m.match_id).map(m => `${m.template_id}:${m.match_id}`),
  )
  const existingPerMatch: Record<string, number> = {}
  for (const m of existing ?? []) {
    if (!m.match_id) continue
    existingPerMatch[m.match_id as string] = (existingPerMatch[m.match_id as string] ?? 0) + 1
  }
  const currentOpen = (existing ?? []).filter(m => m.status === 'open').length

  const gateDrops = new Map<string, number>()
  const survivors: { template: GeneratorTemplate; candidate: Candidate }[] = []

  for (const t of templates) {
    const template = t as unknown as GeneratorTemplate
    const gates = (t.gates ?? {}) as Gates
    for (const row of rows) {
      if (existingKeys.has(`${template.id}:${row.id}`)) continue
      const cand = matchRowToCandidate(row, ranks, template.key)
      result.candidates += 1
      const gate = passesGates(cand, gates)
      if (!gate.ok) {
        gateDrops.set(gate.reason, (gateDrops.get(gate.reason) ?? 0) + 1)
        continue
      }
      survivors.push({ template, candidate: cand })
    }
  }
  result.gateDrops = [...gateDrops.entries()].map(([reason, count]) => ({ reason, count }))

  const startOfDay = new Date(now); startOfDay.setUTCHours(0, 0, 0, 0)
  const createdToday = (existing ?? []).length // conservative; refined once created_at is indexed

  const caps = applyCaps(survivors.map(s => s.candidate), {
    maxOpenMarkets: limits.max_open_markets as number,
    currentOpen,
    maxNewPerDay: limits.max_new_per_day as number,
    createdToday: 0,
    maxPerMatch: limits.max_per_match as number,
    existingPerMatch,
    maxPerTournamentDay: limits.max_per_tournament_day as number,
    createdPerTournamentToday: {},
    maxSubsidyPerDay: limits.max_subsidy_per_day as number,
    subsidyUsedToday: 0,
    subsidyPerMarket: 5000,
  })
  result.capDrops = caps.drops

  const keptKeys = new Set(caps.kept.map(c => c.key))
  const toCreate = survivors.filter(s => keptKeys.has(s.candidate.key))

  if (deps.dryRun) {
    log?.info({
      candidates: result.candidates,
      wouldCreate: toCreate.length,
      gateDrops: result.gateDrops,
      capDrops: result.capDrops,
      createdToday,
      startOfDay: startOfDay.toISOString(),
    }, 'market-generator: DRY RUN')
    result.durationMs = Date.now() - started
    return result
  }

  for (const { template, candidate } of toCreate) {
    const row = buildMarketRow(template, candidate, season.id as string)
    const { error } = await deps.supabase.from('markets').insert(row)
    if (error) {
      // 23505 = the partial unique index caught a concurrent run. Benign.
      if (error.code === '23505') continue
      log?.error({ err: error, key: candidate.key }, 'market-generator: insert failed')
      continue
    }
    result.created += 1
  }

  log?.info({
    created: result.created,
    gateDrops: result.gateDrops,
    capDrops: result.capDrops,
  }, 'market-generator: done')

  result.durationMs = Date.now() - started
  return result
}
```

- [ ] **Step 4: Confirm `isPremierTier` is still exported**

Run: `cd padelgod && grep -n "export function isPremierTier" src/workers/match-stats-fetcher.ts`
Expected: `116:export function isPremierTier(level: string | null): boolean {`

It is already exported and is the canonical tier helper — do not write a second one.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd padelgod && npx vitest run src/workers/__tests__/market-generator.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 6: Typecheck**

Run: `cd padelgod && npm run typecheck`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add padelgod/src/workers/market-generator.ts padelgod/src/workers/__tests__/market-generator.test.ts
git commit -m "feat(play): market-generator worker with dry-run and drop logging"
```

---

## Task 14: `market-resolver` worker

**Files:**
- Create: `padelgod/src/workers/market-resolver.ts`
- Test: `padelgod/src/workers/__tests__/market-resolver.test.ts`

**Payout is deliberately out of phase 1.** There is no trade API and no UI, so no positions can exist. Writing a settlement-ledger path now would put untested money-moving code into production with nothing to exercise it. Instead this worker performs the status transitions and **throws if a settling market has any positions** — loud failure rather than a silent wrong payout. The payout path lands in phase 3 alongside trading.

- [ ] **Step 1: Write the failing test**

Create `padelgod/src/workers/__tests__/market-resolver.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { toMarketState, applyDecisionPatch } from '../market-resolver.js'

const NOW = new Date('2026-09-23T18:00:00Z')

describe('toMarketState', () => {
  it('parses timestamps into Dates', () => {
    const s = toMarketState({
      status: 'proposed',
      proposed_outcome: true,
      proposed_at: '2026-09-23T17:30:00Z',
      settles_at: '2026-09-23T18:00:00Z',
    })
    expect(s.status).toBe('proposed')
    expect(s.proposedOutcome).toBe(true)
    expect(s.proposedAt?.toISOString()).toBe('2026-09-23T17:30:00.000Z')
    expect(s.settlesAt?.toISOString()).toBe('2026-09-23T18:00:00.000Z')
  })

  it('handles a never-proposed market', () => {
    const s = toMarketState({
      status: 'locked', proposed_outcome: null, proposed_at: null, settles_at: null,
    })
    expect(s.proposedAt).toBeNull()
    expect(s.settlesAt).toBeNull()
  })
})

describe('applyDecisionPatch', () => {
  it('writes the proposal plus its evidence and window', () => {
    const p = applyDecisionPatch({
      action: 'propose',
      outcome: true,
      evidence: { winner_pair: 1 },
      settlesAt: new Date('2026-09-23T18:30:00Z'),
    }, NOW)
    expect(p).toEqual({
      status: 'proposed',
      proposed_outcome: true,
      proposed_evidence: { winner_pair: 1 },
      proposed_at: NOW.toISOString(),
      settles_at: '2026-09-23T18:30:00.000Z',
    })
  })

  it('settles with an auto attribution', () => {
    const p = applyDecisionPatch({ action: 'settle', outcome: false }, NOW)
    expect(p).toEqual({
      status: 'settled',
      outcome: false,
      settled_at: NOW.toISOString(),
      settled_by: 'auto',
    })
  })

  it('voids with a reason', () => {
    expect(applyDecisionPatch({ action: 'void', reason: 'walkover' }, NOW)).toEqual({
      status: 'void',
      void_reason: 'walkover',
      settled_at: NOW.toISOString(),
      settled_by: 'auto',
    })
  })

  it('PERSISTS a hold — this is where the safety guarantee is actually enforced', () => {
    // decideSettlement can short-circuit a market that is already 'held', but
    // nothing compels this caller to write that status. If a hold left the row
    // at 'proposed', the next pass would auto-settle it the moment the upstream
    // answer flapped back. Verified during execution: that hole was real.
    expect(applyDecisionPatch({ action: 'hold', reason: 'answer changed' }, NOW)).toEqual({
      status: 'held',
      hold_reason: 'answer changed',
    })
  })

  it('no-op returns null', () => {
    expect(applyDecisionPatch({ action: 'none' }, NOW)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd padelgod && npx vitest run src/workers/__tests__/market-resolver.test.ts`
Expected: FAIL — cannot resolve `../market-resolver.js`

- [ ] **Step 3: Implement the worker**

Create `padelgod/src/workers/market-resolver.ts`:

```ts
// market-resolver — locks due markets, then proposes and settles outcomes.
//
// Every 5 minutes. Flag: ENABLE_MARKET_RESOLVER (default off),
// MARKET_RESOLVER_DRY_RUN (default on).
//
// Auto-resolution PROPOSES; settlement happens after a confirmation window.
// See lib/market-settlement.ts for why that window exists.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Logger } from 'pino'
import { getResolver } from '../lib/market-resolvers/index.js'
import { decideSettlement, type MarketState, type SettlementDecision } from '../lib/market-settlement.js'

const BATCH_LIMIT = 100

export function toMarketState(row: {
  status: string
  proposed_outcome: boolean | null
  proposed_at: string | null
  settles_at: string | null
}): MarketState {
  return {
    status: row.status as MarketState['status'],
    proposedOutcome: row.proposed_outcome,
    proposedAt: row.proposed_at ? new Date(row.proposed_at) : null,
    settlesAt: row.settles_at ? new Date(row.settles_at) : null,
  }
}

/** Columns to write for a decision, or null when nothing changes. */
export function applyDecisionPatch(
  d: SettlementDecision,
  now: Date,
): Record<string, unknown> | null {
  switch (d.action) {
    case 'propose':
      return {
        status: 'proposed',
        proposed_outcome: d.outcome,
        proposed_evidence: d.evidence,
        proposed_at: now.toISOString(),
        settles_at: d.settlesAt.toISOString(),
      }
    case 'settle':
      return {
        status: 'settled',
        outcome: d.outcome,
        settled_at: now.toISOString(),
        settled_by: 'auto',
      }
    case 'void':
      return {
        status: 'void',
        void_reason: d.reason,
        settled_at: now.toISOString(),
        settled_by: 'auto',
      }
    // A hold PERSISTS. Writing nothing would leave the market at `proposed`,
    // and the next pass would auto-settle it the moment the upstream answer
    // flapped back to its original value — which is the exact incident this
    // mechanism exists to prevent. 'held' is terminal until an operator acts.
    case 'hold':
      return { status: 'held', hold_reason: d.reason }
    case 'none':
      return null
  }
}

export interface MarketResolverDeps {
  supabase: SupabaseClient
  logger?: Logger
  dryRun: boolean
  now?: () => Date
}

export interface MarketResolverResult {
  dryRun: boolean
  locked: number
  proposed: number
  settled: number
  held: number
  voided: number
  undecided: number
  errors: number
  durationMs: number
}

export async function runMarketResolver(
  deps: MarketResolverDeps,
): Promise<MarketResolverResult> {
  const started = Date.now()
  const now = deps.now?.() ?? new Date()
  const log = deps.logger
  const r: MarketResolverResult = {
    dryRun: deps.dryRun, locked: 0, proposed: 0, settled: 0,
    held: 0, voided: 0, undecided: 0, errors: 0, durationMs: 0,
  }

  // Pass A — lock markets whose time has come.
  const { data: due } = await deps.supabase
    .from('markets').select('id')
    .eq('status', 'open').lte('locks_at', now.toISOString()).limit(BATCH_LIMIT)

  for (const m of due ?? []) {
    if (deps.dryRun) { r.locked += 1; continue }
    const { error } = await deps.supabase
      .from('markets').update({ status: 'locked' }).eq('id', m.id).eq('status', 'open')
    if (error) { r.errors += 1; continue }
    r.locked += 1
  }

  // Pass B — resolve locked and proposed markets.
  const { data: pending } = await deps.supabase
    .from('markets')
    .select('id, status, match_id, tournament_id, category, tokens, resolver_key, resolver_params, proposed_outcome, proposed_at, settles_at')
    .in('status', ['locked', 'proposed'])
    .limit(BATCH_LIMIT)

  for (const m of pending ?? []) {
    try {
      const resolver = getResolver(m.resolver_key as string)
      const outcome = await resolver({
        supabase: deps.supabase,
        marketId: m.id as string,
        matchId: (m.match_id as string | null) ?? null,
        tournamentId: (m.tournament_id as string | null) ?? null,
        category: (m.category as 'men' | 'women' | null) ?? null,
        tokens: (m.tokens ?? {}) as Record<string, unknown>,
        now,
      }, (m.resolver_params ?? {}) as Record<string, unknown>)

      const decision = decideSettlement(toMarketState(m as never), outcome, now)

      switch (decision.action) {
        case 'none':    r.undecided += 1; break
        case 'propose': r.proposed += 1; break
        case 'settle':  r.settled += 1; break
        case 'void':    r.voided += 1; break
        case 'hold':
          r.held += 1
          log?.warn({ marketId: m.id, reason: decision.reason },
            'market-resolver: HELD — needs an operator')
          break
      }

      if (deps.dryRun) continue

      // Phase 1 has no trade API, so no market can have positions. If one
      // does, something is very wrong — fail loudly rather than settle
      // without paying anybody.
      if (decision.action === 'settle' || decision.action === 'void') {
        const { count } = await deps.supabase
          .from('market_positions')
          .select('market_id', { count: 'exact', head: true })
          .eq('market_id', m.id)
        if ((count ?? 0) > 0) {
          throw new Error(
            `market ${m.id} has ${count} positions but payout is not implemented until phase 3`,
          )
        }
      }

      const patch = applyDecisionPatch(decision, now)
      if (!patch) continue

      const { error } = await deps.supabase
        .from('markets').update(patch).eq('id', m.id).eq('status', m.status)
      if (error) r.errors += 1
    } catch (err) {
      r.errors += 1
      log?.error({ err, marketId: m.id }, 'market-resolver: failed')
    }
  }

  log?.info({ ...r }, 'market-resolver: done')
  r.durationMs = Date.now() - started
  return r
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd padelgod && npx vitest run src/workers/__tests__/market-resolver.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: Typecheck and commit**

Run: `cd padelgod && npm run typecheck`
Expected: no errors

```bash
git add padelgod/src/workers/market-resolver.ts padelgod/src/workers/__tests__/market-resolver.test.ts
git commit -m "feat(play): market-resolver worker with lock, propose and hold"
```

---

> **`market-resolver` findings from execution.** The hold persistence the task
> centres on is implemented and covered. These are observability, not safety —
> but two of them change how Task 17's dry-run should be read.
>
> 1. **Dry run cannot preview the lock→propose step.** In a real run, Pass A
>    flips N markets `open → locked` *before* Pass B selects
>    `status IN ('locked','proposed')`, so those same markets get proposed in the
>    same tick. Dry run writes nothing, so they are still `open` when Pass B
>    selects and are skipped. A batch of 10 reports `locked:10, proposed:0` dry
>    versus `locked:10, proposed:10` real. **Task 17 step 5 must not read
>    `proposed: 0` as proof the resolver works.**
> 2. **The positions check is skipped under dry run**, so the one condition the
>    worker is built to fail loudly on is invisible in the mode you would use to
>    look for it.
> 3. **`BATCH_LIMIT` never drains under dry run** — repeated dry runs re-show the
>    same first 100 rows and never reveal work queued behind the cap.
> 4. **`durationMs` always logs as 0** — it is assigned after the `log?.info`
>    call. The returned object is correct; only the log line is wrong.
> 5. **Both `SELECT`s ignore their error channel.** A failed query yields
>    `data: null`, the loop runs over `[]`, and the worker returns all-zero
>    counters with `errors: 0`. **A total database failure is indistinguishable
>    from "nothing to do"** in both the result and the log. Worth fixing before
>    this runs unattended.
> 6. **`undecided` conflates two states** — a resolver that genuinely doesn't
>    know, and a proposed market simply still inside its confirmation window.
> 7. Keep the worker at **concurrency 1**: a `hold` can lose a race to a
>    `settle` from another instance, and a rejected optimistic write is silent
>    (PostgREST returns success on a zero-row update).

## Task 15: Wire both workers into the scheduler

**Files:**
- Modify: `padelgod/src/lib/env.ts`
- Modify: `padelgod/src/index.ts`
- Modify: `padelgod/src/scheduler.ts`
- Test: `padelgod/src/__tests__/scheduler.test.ts`

- [ ] **Step 1: Write the failing test**

`padelgod/src/__tests__/scheduler.test.ts` declares an explicit `ALL_ENABLED` object literal at the top of the file (not a spread), so a new worker is invisible to the test until its flag is added there. Make **two** edits.

Add to `ALL_ENABLED`:

```ts
  enableMarketGenerator: true,
  marketGeneratorDryRun: true,
  enableMarketResolver: true,
  marketResolverDryRun: true,
```

Add to the assertions inside `it('includes all 16 workers when fully enabled', …)`:

```ts
    expect(names).toContain('market-generator');
    expect(names).toContain('market-resolver');
```

Two notes. That test has no `toHaveLength` assertion, so its "16 workers" title is already stale — update it to `18` while you are in there. And `padelgod/tsconfig.json` excludes `src/**/__tests__/**`, so `npm run typecheck` will **not** catch a missing flag in `ALL_ENABLED`; the failing assertion is your only signal.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd padelgod && npx vitest run src/__tests__/scheduler.test.ts`
Expected: FAIL — `expected [...] to contain 'market-generator'`

- [ ] **Step 3: Add the env flags**

In `padelgod/src/lib/env.ts`, alongside the other `ENABLE_*` entries:

```ts
  // Play prediction market. Both default OFF with dry-run ON, so enabling in
  // Railway is a two-step commit — same pattern as
  // tournament-projection-snapshot.
  ENABLE_MARKET_GENERATOR: boolEnv(false),
  MARKET_GENERATOR_DRY_RUN: boolEnv(true),
  ENABLE_MARKET_RESOLVER: boolEnv(false),
  MARKET_RESOLVER_DRY_RUN: boolEnv(true),
```

- [ ] **Step 4: Thread them into the scheduler config**

In `padelgod/src/index.ts`, next to `enableTournamentProjectionSnapshot: env.ENABLE_TOURNAMENT_PROJECTION_SNAPSHOT,`:

```ts
      enableMarketGenerator: env.ENABLE_MARKET_GENERATOR,
      marketGeneratorDryRun: env.MARKET_GENERATOR_DRY_RUN,
      enableMarketResolver: env.ENABLE_MARKET_RESOLVER,
      marketResolverDryRun: env.MARKET_RESOLVER_DRY_RUN,
```

- [ ] **Step 5: Register in the scheduler**

In `padelgod/src/scheduler.ts` make four edits.

Imports, beside the other worker imports:

```ts
import { runMarketGenerator } from './workers/market-generator.js';
import { runMarketResolver } from './workers/market-resolver.js';
```

Flags interface, beside `enableTournamentProjectionSnapshot`:

```ts
  enableMarketGenerator: boolean;
  marketGeneratorDryRun: boolean;
  enableMarketResolver: boolean;
  marketResolverDryRun: boolean;
```

`WorkerName` union — add two members before the closing `;`:

```ts
  | 'market-generator'
  | 'market-resolver'
```

Also add both strings to the adjacent array of worker names (around line 246) so the admin trigger can find them.

Admin-trigger `switch`, beside the `tournament-projection-snapshot` case:

```ts
    case 'market-generator': return (deps) => runMarketGenerator({
      supabase: deps.supabase,
      logger: deps.logger,
      // Admin-trigger is always dry-run-safe; the cron threads the real flag.
      dryRun: true,
    });
    case 'market-resolver': return (deps) => runMarketResolver({
      supabase: deps.supabase,
      logger: deps.logger,
      dryRun: true,
    });
```

`buildSchedule`, beside the other `if (flags.enable…)` blocks:

```ts
  if (flags.enableMarketGenerator) {
    entries.push({
      name: 'market-generator',
      // :21 — deliberately NOT :25, which model-prediction-snapshot owns.
      cron: '21 * * * *',
      run: async (d) =>
        runMarketGenerator({
          supabase: d.supabase,
          logger: d.logger,
          dryRun: flags.marketGeneratorDryRun,
        }),
    });
  }
  if (flags.enableMarketResolver) {
    entries.push({
      name: 'market-resolver',
      // 4,9,…,59 — NOT 2-57/5, which fip-results-writer owns; that worker
      // writes the match outcomes this one reads.
      cron: '4-59/5 * * * *',
      run: async (d) =>
        runMarketResolver({
          supabase: d.supabase,
          logger: d.logger,
          dryRun: flags.marketResolverDryRun,
        }),
    });
  }
```

- [ ] **Step 6: Run the scheduler test and typecheck**

Run: `cd padelgod && npx vitest run src/__tests__/scheduler.test.ts && npm run typecheck`
Expected: PASS, then no type errors

- [ ] **Step 7: Commit**

```bash
git add padelgod/src/lib/env.ts padelgod/src/index.ts padelgod/src/scheduler.ts padelgod/src/__tests__/scheduler.test.ts
git commit -m "feat(play): register market-generator and market-resolver workers"
```

---

> **Subsidy accounting — FIXED during execution (commit `de7a8946b`).**
> `applyCaps` originally took a scalar `subsidyPerMarket` and the generator
> passed a constant 5,000, while this migration seeds `match.winner` at 12,000
> and `tournament.outright` at 40,000. The generator believed 20 markets used
> 40% of a 250,000 budget when the true figure was 96%, and raising
> `max_new_per_day` to 21 silently committed 252,000. The cap was also
> unreachable dead code (250,000 ÷ 5,000 = 50 markets against a daily cap of 20).
>
> Now: `Candidate.subsidyGuacas` carries the template's `max_loss_guacas`, and
> `subsidyUsedToday` is summed from each existing market's frozen
> `lmsr_b · ln(2)` rather than assumed. Verified — at 12,000/market the cap binds
> at 20 markets / 240,000, and the 21st is refused with
> `over daily subsidy budget`.
>
> Note the figure is deliberately **committed** exposure, not realised spend:
> voided and settled markets still count at full worst-case loss for the day.
> That preserves the pre-commitment property that makes the budget meaningful,
> and refuses to free budget when bad upstream data voids a batch.

## Task 16: Seed season 1 and the two phase-1 templates

**Files:**
- Create: `supabase/migrations/20260923120300_play_market_seed.sql`

- [ ] **Step 1: Write the seed migration**

```sql
-- Season 1 plus the two phase-1 templates.
-- Round gate SF + F — confirmed 2026-09-23. ~14 open markets per Premier
-- event, inside the 15 cap. Widening to QF later is a gates edit, not a
-- migration.

INSERT INTO market_seasons (name, starts_at, ends_at, reset_balance, status)
VALUES ('Season 1', now(), now() + interval '3 months', 10000, 'active');

INSERT INTO market_templates
  (key, question_i18n, horizon, trigger, lock_rule, resolver_key,
   seed_source, max_loss_guacas, params, gates, enabled)
VALUES
  (
    'match.winner',
    '{"en":"Will {pair1} win this match?",
      "es":"¿Ganará {pair1} este partido?",
      "pt":"{pair1} vai ganhar este jogo?",
      "it":"{pair1} vincerà questa partita?",
      "fr":"{pair1} va-t-il gagner ce match ?"}'::jsonb,
    'pre-match', 'match.scheduled', 'match_start', 'match.winner_is_pair',
    'elo', 12000, '{"pair": 1}'::jsonb,
    -- NOTE: no "dailyCap" here. `Gates.dailyCap` is declared in the type but
    -- never read by passesGates or applyCaps, so writing it would be dead
    -- config an operator could set with no effect. See the per-template cap
    -- note above Task 13 — it must be wired before phase 2 enables a second
    -- template.
    '{"rounds":["SF","F"],"minRanking":50,"competitiveness":[0.35,0.65]}'::jsonb,
    false
  ),
  (
    'tournament.outright',
    '{"en":"Will {pair1} win {tournament}?",
      "es":"¿Ganará {pair1} el {tournament}?",
      "pt":"{pair1} vai vencer o {tournament}?",
      "it":"{pair1} vincerà il {tournament}?",
      "fr":"{pair1} va-t-il remporter {tournament} ?"}'::jsonb,
    'tournament', 'draw.released', 'final_start', 'tournament.champion_is_pair',
    'projection', 40000, '{}'::jsonb,
    '{"minRanking":50}'::jsonb,
    false
  );
```

Both templates ship **disabled**. Enabling them is a deliberate operator action after the dry-run below looks right.

- [ ] **Step 2: Apply it**

Run: `node scripts/apply-migration.mjs supabase/migrations/20260923120300_play_market_seed.sql`
Expected: `Applied.`

- [ ] **Step 3: Verify the seed**

Run:
```bash
node -e "
import('pg').then(async ({default:{Pool}}) => {
  const fs=await import('node:fs');
  for (const l of fs.readFileSync('.env.local','utf8').split(/\r?\n/)) {
    const m=l.match(/^([A-Z0-9_]+)=(.*)\$/i); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'');
  }
  const u=new URL(process.env.DATABASE_URL);
  const p=new Pool({host:u.hostname,port:+(u.port||5432),database:u.pathname.slice(1),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:false}});
  console.log((await p.query(\"SELECT name,status FROM market_seasons\")).rows);
  console.log((await p.query(\"SELECT key,horizon,resolver_key,enabled,gates->'rounds' AS rounds FROM market_templates ORDER BY key\")).rows);
  await p.end();
});
"
```

Expected: one `Season 1 / active` row, and two templates with `enabled: false`, `match.winner` showing `rounds: ["SF","F"]`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260923120300_play_market_seed.sql
git commit -m "feat(play): seed season 1 and the two phase-1 templates"
```

---

## Task 17: Live dry-run verification

No code. This is the gate that decides whether phase 1 is actually done.

- [ ] **Step 1: Run the full suite**

Run: `cd padelgod && npx vitest run`
Expected: every pre-existing test still passes, plus ~70 new ones.

- [ ] **Step 2: Enable the templates**

Run:
```bash
node scripts/apply-migration.mjs /dev/stdin <<'SQL'
UPDATE market_templates SET enabled = true WHERE key IN ('match.winner','tournament.outright');
SQL
```

Expected: `Applied.`

- [ ] **Step 3: Dry-run the generator against live data**

Run:
```bash
cd padelgod && npx tsx -e "
import { createClient } from '@supabase/supabase-js'
import pino from 'pino'
import { runMarketGenerator } from './src/workers/market-generator.js'
import fs from 'node:fs'
for (const l of fs.readFileSync('../.env.local','utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)\$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^[\"']|[\"']\$/g,'')
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const logger = pino({ transport: { target: 'pino-pretty' } })
console.log(await runMarketGenerator({ supabase, logger, dryRun: true }))
"
```

Expected: a result object. **What to actually check:**

| Field | What good looks like |
|---|---|
| `candidates` | non-zero during a Premier tournament week |
| `gateDrops` | dominated by `below round gate` — that is SF+F doing its job |
| `capDrops` | empty or small; a large `over global open cap` means the gates are too loose |
| `created` | `0` — this is a dry run |

If `candidates` is 0, check whether a Premier event is actually in window; between events this is the correct answer, not a bug.

- [ ] **Step 4: Sanity-check a seeded price by hand**

Pick one match the dry run would create a market for, then confirm the opening price matches the model:

```bash
cd padelgod && npx tsx -e "
import { bFromMaxLoss, seedShares, priceYes, maxLoss } from './src/lib/lmsr.js'
const b = bFromMaxLoss(12000)
const { qYes, qNo } = seedShares(0.62, b)
console.log({ b, opening: priceYes(qYes, qNo, b), worstCaseLoss: maxLoss(b) })
"
```

Expected: `opening` = 0.62 (to 9 places) and `worstCaseLoss` = 12000.

- [ ] **Step 5: Dry-run the resolver**

Same harness as Step 3 but calling `runMarketResolver({ supabase, logger, dryRun: true })`.

Expected: all counters `0` — no markets exist yet, because the generator has only ever run dry. A non-zero `errors` here means a resolver key in a seeded template does not exist in the registry.

- [ ] **Step 6: Disable the templates again**

Phase 1 ends with nothing live.

```bash
node scripts/apply-migration.mjs /dev/stdin <<'SQL'
UPDATE market_templates SET enabled = false;
SQL
```

- [ ] **Step 7: Final commit and push**

```bash
git add -A
git commit -m "chore(play): phase 1 dry-run verified against live Premier data"
git push -u origin feat/play-prediction-market
```

---

## Definition of done

- [ ] All four migrations applied; `market_limits` holds exactly one row
- [ ] `cd padelgod && npx vitest run` green, including pre-existing tests
- [ ] `cd padelgod && npm run typecheck` clean
- [ ] Generator dry-run produces sensible candidate counts with drops dominated by the round gate
- [ ] A hand-checked market opens at exactly its model probability
- [ ] Both workers registered, both flags default **off**, both dry-runs default **on**
- [ ] No UI, no trade API, no user can reach any of this

## Self-review notes

**Spec coverage.** Schema (Tasks 1–3, 16) · LMSR including the `b = maxLoss/ln2` derivation and zero-cost seeding (4–5) · resolver registry with versioned keys and no operator SQL (6–8) · the confirmation window and hold-on-change rule (9) · gates, scoring, caps and itemised drops (10–12) · both workers (13–14) · scheduler and flags (15) · SF+F round gate (16).

**Deliberately deferred, with reasons:**
- **6 of 8 resolvers** — two prove the pipeline; the rest are mechanical once the harness exists.
- **Settlement payout** — no trade API exists in phase 1, so there would be nothing to pay and no way to test it. The worker throws if a settling market has positions.
- **`createdToday` / per-tournament daily counters** are passed as `0` in the generator. With the global open cap binding first at 15, they cannot change the outcome in phase 1; they are wired through `applyCaps` and tested, and get real values when the admin UI needs them in phase 2.

**Type consistency checked:** `Candidate`, `Gates`, `Caps` and `CapResult` are used with the same shapes in Tasks 10–13; `ResolverResult` matches between `types.ts`, both resolvers, and `market-settlement.ts`; `MarketState` is produced by `toMarketState` and consumed by `decideSettlement` with identical fields.

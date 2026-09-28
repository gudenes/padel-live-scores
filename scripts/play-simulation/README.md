# Local Play simulation

A standalone bot worker for developing Play activity and exercising the pricing engine.
It uses the app's existing LMSR functions and a **separate SQLite database** at
`.local/play-simulation/simulation.sqlite` in this worktree. Requires Node **22.18+**
(native TypeScript loading and `node:sqlite`); verified here on Node 26.7.
No additional packages, environment variables, Supabase connection, auth accounts,
network listener, or background service installation.

## Start and operate

Run from the worktree root:

```sh
node scripts/play-simulation/cli.mjs init 50
node scripts/play-simulation/cli.mjs resume
node scripts/play-simulation/cli.mjs run
```

In another terminal:

```sh
node scripts/play-simulation/cli.mjs status
node scripts/play-simulation/cli.mjs activity
node scripts/play-simulation/cli.mjs audit
node scripts/play-simulation/cli.mjs pause
```

- New databases start paused. `run` never implicitly resumes trading.
- Ctrl-C stops the worker. `pause` persists across process restarts.
- `init 1000` adds missing identities up to 1,000. It does not replenish balances,
  extend deadlines, reset trades, or remove previously created bots.
- `interval 30000` sets the mean attempt interval to 30 seconds (5–300 seconds allowed).
- Default interval: 15 seconds, with ±25% jitter. One attempt per tick **across all bots**.
- Multiple workers share a database lease; they do not multiply the trade rate.
- Failed/skipped attempts are logged with a reason. No busy retries or catch-up bursts.
- `tick` makes at most one scheduled attempt. It respects pause and the next due time.
- `activity` outputs JSON for a future UI adapter. It is not connected to the app UI yet.
- A harmless Node module-type warning may appear when loading the existing TypeScript
  pricing file; the root app package type has deliberately not been changed.

## Accounts, prices, and limits

All identities are visibly named `Bot 0001` etc., permanently typed `simulation_bot`,
and constrained to `prize_eligible = 0`. Each receives one 10,000 G **simulation-only**
grant. They never enter production profiles, human leaderboard queries, or prize exports.
This is separation by storage, not a change to the production prize system.

The initial three **demo** markets represent daily, tournament, and season horizons.
Their closing times are 1, 7, and 90 days after first initialization. No automatic
market reopening or replenishment. Seed copies below can use real market metadata.

Trading is buy-only for this pilot:

- Random bot, market, timing and stake (10, 20, 25, or 50 G).
- YES selection is weighted around the starting probability, with a correction when
  price moves away. This is a simulation heuristic, not a predictive model.
- Max 500 G per bot per UTC day, 2,000 G per market per UTC day, 500 G total cost
  per bot per market, and 50 G per trade.
- Reject trades moving YES price more than 10 percentage points from the seed.
- Reject closed markets and insufficient funds.
- Trade, wallet, position, book, ledger and scheduler updates are transactional.
- Trade IDs are idempotency keys. Reusing an ID with a different order is rejected.

## Optional market snapshots

To evaluate a specific market, provide a local JSON array:

```json
[
  {
    "sourceMarketId": "original-market-id",
    "question": "Demo · Will this pair win?",
    "probability": 0.65,
    "liquidity": 2000,
    "locksAt": 1893456000000
  }
]
```

`locksAt` is a future Unix timestamp in milliseconds; the example is 2030-01-01 UTC.
Use the actual intended closing time. Run:

```sh
node scripts/play-simulation/cli.mjs import /absolute/path/markets.json
```

Imports are validated and atomic, and never overwrite an existing copy. The simulator
creates `sim-copy-<sourceMarketId>` and exports `sourceMarketId` separately. It never
fetches or modifies the original. Do not display copied odds as the actual market odds.
Snapshot freshness is the operator's responsibility; no automatic source status sync.

## Local settlement

```sh
node scripts/play-simulation/cli.mjs resolve sim-day yes
node scripts/play-simulation/cli.mjs resolve sim-tournament void
```

Operator-supplied outcomes only; no live results or resolver integration. A winning
position pays its shares rounded down to whole G; a void refunds original cost on
both sides. Settlement is transactional and repeat-safe. Contradictory re-resolution
is rejected. Positions remain for audit history; market status identifies settled
holdings. Simulation balances are not prizes.

## Activity contract for the UI phase

Each event carries `id`, local `marketId`, nullable `sourceMarketId`, `question`,
`actorType: "simulation_bot"`, `displayName`, `isSimulation: true`,
`prizeEligible: false`, `side`, `direction: "buy"`, `guacas`, `shares`,
`price` (average execution price), `priceAfter` (YES probability), and ISO `createdAt`.
The response envelope has `mode: "local_simulation"`.

The UI should label these events **Simulación** and keep them separate from real
participation counts and volume. Event IDs support deduplication; animate only new
visible events. The export is read-only JSON, not a public unauthenticated endpoint.

## Verification

```sh
node --test scripts/play-simulation/engine.test.mjs
```

Tests cover idempotency, full rollback after injected failure, caps, closed markets,
shared scheduler state, prize constraints, snapshot isolation, repeat-safe settlement,
void refunds, and a deterministic 1,000-bot run with wallet/ledger reconciliation.

## Before any shared-market integration

This pilot does **not** repair the existing non-atomic `/api/play/trade` route or
implement production settlement. Integration requires a transactional shared trade
service, source-status synchronization, explicit actor flags and server-side prize
and ranking exclusions, and a decision about whether bots may influence real prices.
Do not point this worker at a shared database or relabel its events as human activity.

## Admin controls

In the local admin, open **Play · Prediction Market → Simulation** (`/play/simulation`).
The endpoint requires an authenticated operator, development mode, a loopback host,
and a same-origin write request. It is disabled in production. The admin runs from
`apps/ops`, using the same worktree-local database via the CLI bridge.

Controls: pause/resume, 1–1,000 active bots, and a 5–300 second average attempt interval.
Saving a higher active count creates missing accounts; reducing it retains balances,
positions and history while excluding the higher-numbered bots from new scheduling.
The worker heartbeat, recent trades, markets and balance audit refresh every five seconds.
Resume enables trading but does not spawn a worker: start `npm run play:sim -- run`
from the worktree root. CLI equivalent settings: `configure 50 15000` (milliseconds).

## Production deployment

Production stores simulation data in separate Supabase `play_sim_*` tables. RLS
blocks browser access; authenticated admin routes use service-role RPCs. Public
activity and standings require the existing Play allowlist. Bots stay labelled,
have no human profiles, and cannot enter prize rankings or change human balances.

Set `PLAY_SIMULATION_ENABLED=true` on the Railway web service. The supervised
worker uses DATABASE_URL and locks a shared control row for each transaction,
so multiple regions share one schedule. No filesystem volume is required.
The default mean attempt interval is 120 seconds, with 25% jitter.

The worker copies open source markets into separate books, stops held/closed/missing
sources, and settles confirmed results once. Failed reads roll back the tick.
Conflicting outcome corrections require operator review. No open markets means
no trades. Admin → Play → Simulation controls pause, count, and interval.

After deployment verify the heartbeat and ledger audit. Pause in admin to stop
trades; set PLAY_SIMULATION_ENABLED=false and redeploy to hide bots and stop workers.

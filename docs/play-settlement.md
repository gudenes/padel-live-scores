# Immediate Play settlement

Activated in shared Supabase on 2026-09-27 with explicit user approval. Migration
20260927160000 is recorded in schema history. Four pending match-winner markets
settled: total credit 1,534 G, including 382 G for Caldera / Goenaga. The affected
wallet is 8,684 G and matches its ledger (difference zero). Four in-app result
notifications were created; the retry queue was empty after activation. The held
market was left for operator review.

The immediate database trigger is active. The updated recovery worker code is
local and still needs deployment to the worker host; this activation did not
deploy any application or worker. A private pre-migration snapshot is stored in
`.local/settlement-backups/pre-20260927160000.json`.

## Behavior

- A `matches` update to `finished` or `retired` with `winner_pair` set settles `match.winner_is_pair` markets in the result transaction. No 30-minute window.
- Winners receive one G per winning share, rounded down to whole G per side. Losing sides receive zero. Void markets return the recorded remaining cost basis.
- Wallet, payout record, ledger, market status, audit trail and notifications commit together. Repeated results do not pay twice.
- A changed winner applies only the difference from the last payout. If the old payout has been spent, the balance can become negative. Future credits reduce that amount; new buys are blocked until affordable. This keeps the ledger honest instead of silently forgiving or losing an adjustment.
- A withdrawn result is held for operator review. Users receive an in-app notification. The old shares are not counted again in net worth.
- Under **Play → Markets**, **Resolve / correct** accepts Yes, No or Void and requires a reason. It uses a revision check to reject stale corrections. Users receive an inbox notification and a correction notice in My plays.
- Other resolvers and missed events use the recovery worker every minute when enabled and not dry-run. Held markets require operator action.
- Positions show Won / Lost / Refunded / Awaiting settlement. Activity labels closed markets; it remains historical activity. Market and wallet views refresh every 30 seconds while visible.
- Simulation bots remain separate local wallets. Their historical trades use the source market status in the UI; these changes do not transfer bot balances into user wallets or make them prize eligible.

## Activation

The current local app reads a shared Supabase database. Applying the migration there changes shared wallets and result processing; it is not a local UI change.

1. Stop old trade-serving instances and the resolver; let in-flight requests finish. The old trade route used separate writes and must not run alongside settlement.
2. Deploy the transactional trade route and the other code in this change. Before migration, it fails closed if its RPC is unavailable; there is intentionally no fallback to the unsafe multi-write path.
3. Apply `supabase/migrations/20260927160000_play_atomic_settlement.sql` to the chosen database. This creates the result trigger; it does not run a historical backfill.
4. Run the resolver in dry-run first to review pending markets, then enable actual resolution to catch up locked/proposed markets. Caldera / Goenaga is currently in that queue. A formerly settled market at revision zero with no ledger payout needs an explicit operator reconciliation via Resolve / correct; rows with existing legacy payouts are blocked for manual reconciliation, preventing duplicate credit.
5. Verify wallet and ledger sums, recorded revisions, and notification delivery for the affected positions.

Operator-authenticated settlement endpoints use the configured database. Do not click Apply on the local admin against the shared database until activation is intended.

## Tests

- `node --test scripts/test-play-settlement.mjs`: real SQL against isolated embedded Postgres (PGlite), with minimal parent tables and the actual Play migrations. The test replaces only the pgcrypto-based public ID default because the fixture does not need that extension. No network or real user data.
- `npx vitest run padelgod/src/lib/__tests__/market-settlement.test.ts padelgod/src/workers/__tests__/market-resolver.test.ts --maxWorkers=1`

The SQL tests cover immediate payout, retry idempotency, corrections after spending, void refunds, notifications, unknown winner, missing wallet rollback and retry, stale trade rejection, trade rollback after ledger failure, revoked results, privilege restrictions and legacy payout guards. PGlite serializes statements; this does not replace a multi-connection staging concurrency/load test before deployment.

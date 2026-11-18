# PPL live scores — local candidate, not deployed

Prepared 18 November 2026 from `origin/main` 41a676394, following CourtBit PRs #827 and #828.
Branch: `feat/ppl-live-adapter`. No PR, migration execution, production data writes or deployment performed.

## Source and behavior

- Discover published events from `propadelleague.com/tournaments/` and the site's current Next data build ID.
- Respect `hiddenFromWeb` and disabled detail pages; Guadalajara is hidden, Las Vegas is the published November event.
- Read the same public Firestore match documents used by the official site, in project `pro-padel-league`, database `prod-ppl`.
- GET-only, fixed host/path, validated IDs, timeouts and bounded response sizes. No API key, login or browser required.
- The point subcollection is permission restricted. This integration does not access it or manufacture point history.
- Poll confirmed live matches on a three-second scheduler; scheduled/unresolved rows wait 30 seconds and final rows five minutes. Runs cannot overlap in one process. Network failures back off.
- Refresh the source index every five minutes and event metadata every minute. When explicitly enabled for writes, reconcile the current season's active/future published events every five minutes. Historical backfill must be explicitly scoped.
- Podium fixtures without confirmed teams remain unmaterialized; a prepared 0–0 or missing scoring state is not a live match.
- Resolve source lineup slugs against the event roster, then strict canonical identities. Rank and existing foreign keys do not disambiguate namesakes. The explicit Javier Martinez decision is carried over from `scripts/ppl-player-map.json`, checked by a test.
- A/B orientation is checked against the confirmed lineups. Public display order can differ from home/away order.
- Use `match_tiebreak_points` for 10–6 etc., not the provider's internal 1–0 set placeholder.
- Venue-local schedules use the published IANA timezone, with explicit fallbacks only for known older venues. Do not use the scoring document's inconsistent scheduled-start field.

## Database writes (prepared, not executed)

Migration: `20261118120000_ppl_live_snapshots.sql`.

`reconcile_ppl_event` locks the event, reuses a unique event/team-tie/category fixture and reconstructs missing source IDs before creating any missing match. Team seasons must already exist for the correct year/division; unknown franchises fail the transaction. It creates no player identities and deletes no matches.

`apply_ppl_snapshot` validates event/tie/category and previous participant IDs under a match lock. Source revisions reject stale/repeated snapshots. Score, player links, status, source mapping and derived franchise/player records commit atomically. A failed write rolls back everything. Finished matches cannot regress to live.

Finals become normal `matches` + `sets` rows with four canonical player links, so existing player history can display them. Existing league exclusions keep PPL out of circuit Elo/win-rate/prize-money calculations. Derived team/player participation counters update on completion; official ranking **points** are not calculated from these counters.

The separate official standings importer remains necessary for `league_standings`. This change does not implement its periodic refresh, old fixture cancellation/deletion, player creation, live push notifications or a redesign of the PPL screens. Unknown statuses/identity conflicts are reported rather than guessed.

## Local evidence

- Public-source dry run: 24/24 Playa del Carmen matches parsed as finished, including four podium matches and supertiebreaks.
- Read-only canonical audit: all 20 existing fixtures resolve; four podium fixtures require onboarding. Missing source IDs are reconciled by the new writer, not by creating duplicate matches.
- Las Vegas: 20 scheduled matches, four podium slots awaiting teams, zero live matches at capture time. First published session is 18 November at 17:00 America/Los_Angeles (19 November 01:00 UTC; 18 November 22:00 Argentina).
- Unit tests cover real captured final/scheduled documents, synthetic live progression, ambiguity, wrong orientation, schema changes, retries, scheduler flags and dry-run isolation.
- Isolated PostgreSQL/WASM tests cover event onboarding/relinking, duplicate prevention, stale snapshots, injected failure rollback, terminal guards and team/player participation records. They never connect to Supabase.
- A genuine live point transition has **not** been verified yet. Synthetic progression is not evidence of actual live behavior.

## Commands

Run from `padelgod/`, preferably with Node 22+ (the installed Supabase client needs native WebSocket support).

```sh
npm test -- src/__tests__/lib/ppl.test.ts src/__tests__/workers/ppl-live-fetcher.test.ts src/__tests__/ppl-scheduler.test.ts
npm run build
node scripts/test-ppl-postgres.mjs /absolute/path/to/@electric-sql/pglite/dist/index.js

# Public source only; no database credentials or writes:
npx tsx scripts/dryrun-ppl.ts playa-del-carmen --out playa-capture.json
npx tsx scripts/dryrun-ppl.ts mgm-pro-padel-league-las-vegas-2026 --watch 20 --out vegas-capture.json

# Optional read-only identity audit against the connected database:
node --env-file=/absolute/path/to/.env.local --import tsx scripts/audit-ppl-identities.ts playa-capture.json
```

For the live acceptance check, compare both sides, sets, current points and serving pair with the official match center over several real transitions. Confirm changes advance with source revision, verify the final transition and reconnect/retry without duplication. Keep production writes off while doing this.

`ENABLE_PPL_LIVE=false` and `PPL_LIVE_DRY_RUN=true` are the defaults. Admin/manual worker invocations always use dry run. Neither flag has been changed in production. Applying the migration or enabling writes requires a separate deployment decision after the real-live test.

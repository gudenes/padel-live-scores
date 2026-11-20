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
- 19 November real live capture: Los Angeles Beat vs Miami Padel Club (Las Vegas, day 2 men's match 1), approximately 19:10–19:13 UTC. Observed 0–30 → 15–30 → 15–40, then second-set games 2–1 → 2–2, points reset and serving pair changed. The official match center also showed the second set at 2–2. A real transition to finished has **not** been verified.
- That test exposed incompatible absent-session tie keys: static imports use an empty field, the early adapter used literal `null`. Both resolver and SQL reconciliation now accept either, retain the existing ID/key, create new ties using the static convention, and reject two equivalent ties rather than selecting one. Regression tests cover both encodings, duplicate ties and repeated discovery.
- Fixed-path replay against an isolated copy of the prepared static dataset: all 20 Las Vegas matches retained (20 → 20), the real live fixture resolved with its original ID and four canonical players, 15 captured revisions applied, and retrying the last revision returned `unchanged`. Production was read only for canonical identity lookup; all reconciliation/score writes ran in local PostgreSQL/WASM. The previous 20 → 40 duplication is no longer reproduced. The static data PR remains separate.

## Commands

### App integration acceptance (19–20 November local run)

- PPL display priority is between FIP Gold and Silver; PPL II keeps its existing priority. The Matches list preserves round-first ordering inside the Premier and lower-tier buckets. Sporting ranking/quality weights are unchanged.
- Home accepts confirmed PPL current scores without requiring an invented point history. Shared warmup detection, tournament coverage messaging and the Matches tournament badge recognize the same evidence. PPL calendar dates display without shifting to the previous day in Argentina.
- Visible PPL cards have a three-second fallback refresh, with no overlapping PPL reads, no background-tab polling, cleanup on unmount and a stop after the final. Existing realtime subscriptions remain. Home listens for the completion of its displayed PPL match to remove it from the live section.
- Local PostgreSQL replay applied genuine captured point changes and a subsequently captured official final. Browser acceptance confirmed an automatic 0–30 → 15–30 change on Home, the existing “View matches” link opening the Las Vegas matches tab, the Vegas group on Matches, no horizontal overflow at 320/390/1280px, and zero live badges on Home after completion. The final wrote canonical match/player participation records. This is an accelerated replay, not evidence that the entire deployed pipeline has run live.
- 128 targeted app tests passed; all eight affected ordering/polling tests passed again after the final scope-preserving cleanup. The separate static-data PR supplies Vegas calendar/cover/history; preview assets and the read-only local bridge are not production integration code. No PR, migration, flag change or deploy was performed during this app test.
- Global type-check gate remains open: the first run reported two errors in the unchanged `src/app/api/admin/migrate-equipment-images/route.ts` and a group-shape error fixed in this branch. The global recheck was interrupted after disk/resource problems; do not report it as passing or publish before closing this gate.
- The public-source refresh at 01:17 UTC on 20 November reported no active live match and successfully imported the published finals locally. A new real-time end-to-end acceptance run is still needed when play resumes, followed by explicit production activation approval.

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

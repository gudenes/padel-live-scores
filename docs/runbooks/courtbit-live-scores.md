# CourtBit live scores

Implemented 17 November 2026. Not deployed or enabled by this change.

## Behavior

- Public JSON polling every five seconds with ETag/304, event/host/schema validation, bounded response size, fetch backoff and process overlap protection.
- A strict, side-effect-free Player Resolver core shared with `PlayerResolver.lookup(input, { strict: true })`. Every player, including cached identities, goes through it. Exact/alias matches enforce country/category and reject ambiguous identities. Existing callers retain their default lookup behavior.
- Match writes require one unique existing fixture, normalized gender/round and verified pair/slot orientation. Each slot uses a confirmed UUID or exact full-name/country evidence. Unresolved identities remain thin (null FK plus raw name/country); duplicate profiles never become arbitrary player links. Conflicting people/countries, placeholders, reused provider IDs and ambiguous fixtures are skipped. The worker never creates player or match records.
- The atomic writer compares the original four FKs and raw names, then stores only resolved IDs. Uncertain existing duplicate links become null; their original IDs/names are retained in CourtBit mapping metadata `identityBefore`. Later confirmed resolution fills the FK without another start notification. This does not merge duplicate players or migrate followers.
- A service-role-only PostgreSQL RPC atomically commits scores, optional observed points, provider mappings, live status and the replay baseline. Match locks and compare-and-swap state protect retries and official finalization. Initial mid-match scores appear on the first poll.
- Start pushes reuse `notifyLiveTransition` only after the transaction claims `scheduled → live`. `on_court → live` does not notify again. Dispatch remains the existing best-effort helper, not a durable outbox.
- Only unambiguous single-point advances inside the same observed game are logged. No historical points are fabricated. Score Recap is hidden for this incomplete history. `games.game_score` drives the display; `games.points` stays null so it cannot override a newer score with an old captured point.
- `games.serving_pair` displays the serving side without inventing `server_player_id` or individual service statistics.
- CourtBit `done` snapshots update observed scores and clear current-game markers. FIP/Crionet retains terminal status/winner and its existing elimination/title events. No independent final-result, break or set-win push is introduced.

The review proposed calling `applyDiff`. This implementation shares the live-state model and pure `diffLiveState` comparator, but uses an atomic persistence RPC because the older writer skips initial snapshots, tolerates individual write failures, and does not atomically commit its replay baseline. This requires one additive SQL migration, not new canonical score tables.

## Fresh Aguascalientes preflight

| Check | Result at capture |
| --- | --- |
| Parsed matches | 41 / 41 |
| Published players | 124 |
| Strictly resolved players | 108 |
| Ambiguous identities | 16 |
| Uniquely identified fixtures, including thin profiles | 36 / 41 |
| Live matches ready | 4 / 4 |
| Schema / score errors | 0 / 0 |

Two wildcard players have null slugs. Separate name/country keys now distinguish them; the initial review's slug-only count collapsed them and reported 123. The strict ambiguity count includes alias collisions beyond the original 12 same-name duplicates. Mateo Alvarez now resolves to Argentina independently of row ordering.

The preflight is time-sensitive. Ambiguous fixture links are skipped; unresolved player profiles alone do not block scores. Five scheduled fixtures in this capture still need reconciliation. Profile-linked notifications use only resolved FKs; match-bookmark notifications can still use a uniquely identified thin fixture.

## Mappings

| Entity | Source | External ID |
| --- | --- | --- |
| Tournament | `courtbit_live` | `https://fip.courtbit.com.mx` |
| Match | `courtbit` | `<tournament UUID>:<provider match ID>` |
| Player | `courtbit_player:<tournament UUID>` | Slug, or `name:<normalized name>:<country>` when null |

Tournament metadata must include `expectedName: "FIP Platinum Aguascalientes 2026"`. Player metadata contains the observed `name`, `country`, `category` fingerprint. Tournament-scoped player sources respect the existing sidecar unique indexes without changing them. Provider mappings can disambiguate a verified identity, but must never be populated by choosing an arbitrary candidate. Onboarding refuses to steal a hostname mapping from another event.

## Reconciliation and deployment order

1. Review fixture ambiguity against official FIP entries/draws. Unresolved profiles may remain thin. Do not pick profile candidates by row order or merely prefer any record with a FIP ID.
2. Reconcile duplicate profiles through the canonical identity process when evidence is available. Consolidation must preserve followers and historical references. This implementation does not merge records automatically; unresolved followers do not get player-specific notifications.
3. Rerun preflight. All relevant live fixtures must match uniquely, with verified orientation. Profile mappings are saved only for resolved identities and must carry the observed fingerprint and confirmed canonical UUID.
4. Deploy the worker and app with CourtBit disabled. Apply `supabase/migrations/20261117180000_courtbit_live_snapshots.sql` before enabling writes. The existing score display can read snapshots with or without the new `games.serving_pair` field.
5. Verify provider access from Railway. Only access from the review runtime was checked here.

From `padelgod/`, run the read-only preflight:

```sh
node --env-file=../.env.local --import tsx scripts/dryrun-courtbit.ts \
  6f06cfab-ba92-40b2-918a-37bacf21e410 \
  https://fip.courtbit.com.mx \
  'FIP Platinum Aguascalientes 2026'
```

Exit code 1 means identities, match links or scores require attention. It audits scheduled/completed/live matches and never writes aliases, players, FKs, mappings, scores or notifications. `--snapshot /path/to/snapshot.json` supports offline replay.

Preview the tournament mapping:

```sh
node --env-file=../.env.local --import tsx scripts/onboard-courtbit-tournament.ts \
  6f06cfab-ba92-40b2-918a-37bacf21e410 \
  https://fip.courtbit.com.mx \
  'FIP Platinum Aguascalientes 2026'
```

Append `--apply` only for the deliberate mapping write. The script does not enable ingestion. Verify tournament identity and dates when onboarding other events.

## Canary

1. Set `ENABLE_COURTBIT_LIVE=true`, keep `COURTBIT_LIVE_DRY_RUN=true`. Admin-triggered runs always use dry run.
2. Inspect `players`, `unresolvedPlayers`, `liveSeen`, `resolved`, `issues`, and `errors`. Failed fetches back off to one retry per minute at most. A 304 still retries unresolved or previously uncommitted data.
3. After reviewing fixture coverage, set `COURTBIT_LIVE_DRY_RUN=false`. Compare every live court and serving side with CourtBit. Verify `NOTIFY_BASE_URL` / `CRON_SECRET` and a real opted-in start transition; do not manufacture a transition to send a test push.
4. Check official result lag and `ENABLE_EVENT_NOTIFICATIONS` for elimination/title events. Immediate CourtBit terminal-status ownership is not implemented; final status can lag until FIP results arrive.
5. Roll back ingestion with `ENABLE_COURTBIT_LIVE=false`. Keep the additive migration and provenance mappings. Official FIP result workers continue independently.

## Tests

Focused adapter/identity/worker/scheduler tests and app resolver/display tests pass. The SQL transaction was also executed against isolated PostgreSQL (PGlite): initial scores, replay/CAS, stale/identity checks, rollback after injected failure, observed-point idempotency, terminal precedence and restricted execute permissions.

```sh
npm test -- src/__tests__/lib/courtbit.test.ts src/__tests__/workers/courtbit-live-fetcher.test.ts src/__tests__/courtbit-scheduler.test.ts
npm run typecheck
node scripts/test-courtbit-postgres.mjs /path/to/pglite/dist/index.js
```

The optional SQL test uses `@electric-sql/pglite@0.3.14`, never Supabase. Omitting the module path uses an installed package. No runtime dependency was added.

Padelgod typecheck passes. Full app typecheck reports an unrelated existing missing-`id` error in `tmp/verify-official-leaderboard.ts`; the app typecheck with only the scratch `tmp/` directory excluded passes.

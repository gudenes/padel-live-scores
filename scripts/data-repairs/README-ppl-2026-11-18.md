# PPL static data repair + home card height

Prepared and validated locally; not applied to production. The repair is an explicit manual operation, not a migration automatically executed by merging this change.

Updated 19 November: added all four completed Las Vegas matches from the 18 November venue-local session, using a new official source capture. Las Vegas–New York: men 3–6, 3–6; women 6–7, 7–5, 10–6. Florida–Mexico: men 4–6, 3–6; women 6–2, 6–3 (home-side orientation). All 16 participant slots resolve to existing canonical players. The repair now contains 28 finals total and leaves 16 Las Vegas fixtures scheduled. Scores, winner, completion time and derived player/team participation update together. The unchanged filename identifies the original repair, not the freshness of this capture.

## Scope

- Official published event calendar captured on 18 November 2026: Las Vegas, 18–21 November, 20 confirmed group fixtures. First session 19 November 01:00 UTC / 18 November 22:00 Argentina. Four podium slots have no confirmed opponents and are not invented.
- Playa del Carmen: 24 completed matches, including four podium matches absent from the existing 20. Reuse existing match IDs; fill final scores, four canonical players, winner and actual completion timestamps. Recompute team/player participation records. Player history reads these ordinary match rows.
- Source: `https://propadelleague.com/tournaments/`, official event pages and the public match documents used by that site. Playa finals were captured on 18 November; Las Vegas finals and calendar were refreshed on 19 November. Source revisions are preserved in the JSON. Player IDs audited against the existing database; Javier Martinez uses the previously reviewed `scripts/ppl-player-map.json` decision.
- Las Vegas display label and calendar-date formatting in PPL only. Event dates are calendar days, not instants; match dates still use the user's timezone.
- Previously saved home height fix: expandable result groups size to their contents.

## Explicitly excluded

No changes to `padelgod`, workers, cron, live-source configuration, CourtBit, provider ID mappings, live-point/game tables, database functions/triggers, or integration environment flags. No live detection fix in this branch. The separate live adapter remains on `feat/ppl-live-adapter`.

Official league ranking points and `league_standings` are unchanged; their independent refresh is not part of this repair. No deletion, automatic rescraping, player creation, or invented unconfirmed lineups. This is a bounded data correction, not an automated integration.

## Offline preparation and local validation

```sh
node scripts/data-repairs/render-ppl-repair.mjs /path/to/review-ppl.sql
node scripts/data-repairs/test-ppl-repair.mjs /path/to/public-ppl-seed.json /path/to/local-after.json
node scripts/data-repairs/test-ppl-repair.mjs /path/to/local-after.json
npx vitest run src/lib/__tests__/ppl-hub.test.ts src/lib/__tests__/ppl-team.test.ts src/lib/__tests__/league-levels.test.ts
```

The renderer only writes a SQL file. It has no database client. SQL runs in one transaction with identity/conflict guards; rerunning does not create duplicates. Existing nonempty set scores must agree with the capture; a conflict aborts the transaction instead of overwriting a newer correction. Missing scores and 0–0 placeholders can still be filled. The test uses isolated PostgreSQL/WASM populated from a read-only export, not production, and verifies preserved identities, 28 finals, 16 scheduled, player links, unaffected events/ranking/player profiles, idempotence, score-conflict rollback and placeholder filling. To validate an export that already contains Vegas matches, run the test again using its output JSON as the seed. It is not a test of every production trigger/RLS policy.

The local app at `http://127.0.0.1:3020/es/ppl` uses a GET-only loopback data proxy at port 4020. The proxy overlays the actual SQL test output onto public reads, for both server and browser queries. It rejects all writes. This is a visual preview of the repaired dataset, not a production change. Local proxy, credentials and read-only seed export are outside the committed change.

Before any eventual application, review the rendered SQL and refresh the source/canonical audit if circumstances changed. Las Vegas fixtures that have since started/finished are not reset to scheduled. Applying this data repair and deploying the web changes are separate actions requiring the user's go-ahead after reviewing the local preview.

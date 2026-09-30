# Seven selected beta markets — implementation requirements

Reviewed 29 September 2026. Selection source: Market Queue column L (`goahead`), IDs 23, 24, 25, 26, 29, 30, 37.

## Current implementation

- Four reusable market families are connected to Ops → Play → Markets with database drafts, revision checks, five-minute reviewed previews and atomic publishing.
- The scope and publishing migrations (`20260929170000`, `20260929190000`) are applied to the shared database. Seven selected configurations are saved as drafts; none was published.
- Four Rotterdam previews have projection prices but currently lack a confirmed future next-match start. Three long-term previews require a sourced opening estimate. No placeholder prices were inserted.
- Questions and rules are frozen in English and Spanish. The feed displays the frozen copy and the settlement worker persists its evidence.
- Database protections cover concurrent capacity, semantic duplicates, immutable market definitions, early starts and idempotent publishing. Existing whitelist enforcement is unchanged.

A scheduled semifinal/final slot alone is not participation. A played match at the target round qualifies; an earlier confirmed loss is NO. Walkovers and cancellations without adequate participation evidence remain unresolved and ultimately refund. This precise interpretation must appear in the displayed rules.

Missing or conflicting data stays unresolved until a frozen review deadline, then refunds. It does not produce an automatic NO. The worker can retry unresolved markets, unlike the existing terminal `held` status.

## Definition mapping

| Sheet ID | Market | Resolver | Required frozen scope |
|---|---|---|---|
| 23 | Lebrón / Augsburger Rotterdam SF | tournament.pair_reaches_round_v1 | Rotterdam, men, pair IDs, SF |
| 24 | Josemaría / González Rotterdam final | tournament.pair_reaches_round_v1 | Rotterdam, women, pair IDs, F |
| 25 | Calvo / Fernández Rotterdam final | tournament.pair_reaches_round_v1 | Rotterdam, women, pair IDs, F |
| 26 | Other Rotterdam champion | tournament.other_pair_wins_v1 | Rotterdam, men, excluded pair IDs |
| 29 | Coello / Tapia two titles | season.pair_title_count_v1 | Germany, Milano, Mexico; two titles; all three events entered before NO |
| 30 | Lebrón / Augsburger autumn title | season.pair_title_count_v1 | Germany, Milano, Kuwait, Dubai, Mexico; one title; at least two starts before NO |
| 37 | Javi Leal top 12 | player.reaches_ranking_v1 | Official ranking snapshots, 1 Oct–30 Nov; threshold 12 |

Title wins can establish YES before the whole window ends. NO requires the window to end, every scoped final to have a known winner, and sufficient recorded participation. A pair's titles are never combined with substitute partners.

Ranking YES needs an official snapshot at rank 12 or better within the window. NO needs every Monday-labelled snapshot from 5 October through 30 November, inclusive. Missing weeks are retried until the review deadline, then refunded.

## Calendar review

The live database has both an outdated Kuwait P1 and Kuwait Major, plus two Dubai records. The current [FIP calendar](https://www.padelfip.com/es/calendario-premier-padel/?events-year=2026), checked 29 September, identifies Kuwait Major and EMAAR Dubai Premier Padel P1. The definition catalog pins those matching records, avoiding double counting. No tournament records were deleted or modified.

- Germany: 5–11 October, ID `9ba1b209-c4b2-4042-a614-e35513fd55a5`.
- Milano: 12–18 October, ID `53a86546-7a07-4b15-9534-56bea2e42dce`.
- Kuwait Major: 26–31 October, ID `38ec2aca-38e2-42a6-8353-ece5f7a8a561`.
- Dubai: 8–15 November, ID `9f50b503-24e1-4f75-b742-3f21679a24da`.
- Mexico Major: 23–29 November, ID `c858f931-48a5-4ab5-89a8-931c8be0b4f1`.

Frozen scope still needs a creation-time check that ingestion is writing results to those canonical IDs.

## Remaining work before opening

1. The updated worker, consumer app and Ops were deployed on 29 September 2026. `PLAY_EDITORIAL_PUBLISH_ENABLED=true` was set after the new worker passed health checks and its settlement loop reported zero errors. Review the saved drafts in the production admin.
2. Obtain confirmed future Rotterdam match times and fresh projections; preview again to reject already-determined outcomes.
3. Enter defensible opening probabilities and sources for the three long-term markets.
4. Review the seven saved previews, then publish within five minutes. Publication rechecks evidence, prices, deadlines and capacity.
5. Complete the authenticated browser check. The browser tool rejected the existing error-page tab due to its URL protocol; no browser workaround was used.

The long-term closing time is 1 October 2026 00:00 UTC; the result window ends 30 November 23:59:59 UTC; the review deadline is 8 December 00:00 UTC. Rotterdam requires a current per-pair closing time and a separately frozen review deadline. Explain postponed-event treatment in the final rules rather than extending trading after publication.

## Capacity and access

At inspection the database had zero open markets; limits were 15 open, 20 new per day, and eight per tournament per day. Seven selected markets fit now, unlike the earlier 18-market proposal. Recheck these limits atomically at creation and leave headroom for match markets. No capacity increase is currently necessary.

The existing market feed uses `requirePlayAccess`: both the feature flag and the user's whitelist entry are required. Existing production/private-IP access tests passed; that is not a substitute for an end-to-end test of the new publisher.

## Validation

The isolated PostgreSQL publishing suite passed 13 assertions, including a real two-connection race for the final capacity slot. The isolated lifecycle suite passed draft → preview → publish → trade → early lock → payout and retry → refund, plus public-role rejection. Service, route authorization, resolver and frozen-copy tests pass. Ops and worker type checks pass. No real-user trades or payouts were performed during these checks.

## Production rollout — 29 September 2026

- Worker: `b49d9125-4578-40f7-97ab-1686842ef6d6`. Release retains production ingestion changes from `b388cd19e9dc81d16fc7ae2a24c460dc21993af6` and adds the editorial/atomic settlement changes.
- Web: `24e52060-1f12-443a-9b95-769a1cd2d3c6`.
- Ops: `9d49b57f-fe5a-42a3-8604-6f1c065a2c7b`. The first admin build failed because Turbopack could not resolve Node-emitted `.js` paths from the worker registry. Direct source imports of the same resolver implementations fixed it; tests and type checking passed again.
- Health checks passed. Unauthenticated editorial reads/writes return 401. Public market, trade and shop requests without Play access return 404. No whitelist entries were added or removed.
- All seven selections remained drafts when checked after the user's template activation. Enabling a template does not publish its drafts. Three long-term drafts still require sourced opening estimates; four Rotterdam drafts require fresh valid start times and projections.
- Source archive, manifest and rollback deployment IDs are saved under `.local/releases/editorial-149810ccf8fce4ee/`. The deployment bundle is separate from the dirty working tree and has the newer worker base; future releases must retain that base.

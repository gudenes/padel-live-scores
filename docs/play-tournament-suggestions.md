# Tournament market suggestions

The Markets page starts with a compact card grid. The manual authoring form and saved drafts remain in a collapsed section below it.

For each current or upcoming Premier tournament, the suggestion service proposes at most two champion picks and two progression picks per draw. Champion picks use the highest championship probabilities; the final and semifinal picks use different pairs with probabilities closest to 50%, within 15–85%. Suggestions require real pair IDs from tournament projections. Missing projections produce an explicit empty state, never invented entrants or prices.

Cards show the question, opening YES probability, closing time in UTC, recommendation reason, and Ready / Waiting / Published status. The operator selects Review & approve, sees a freshly saved preview with exact settlement rules, then chooses Approve & publish. No draft is written on page load. Publishing uses the existing five-minute preview token, fingerprint revalidation, operator authorization, same-origin check, atomic capacity limits and duplicate protection. Existing champion markets, including the legacy outright or opposite question, appear as already covered.

A new versioned champion resolver (`tournament.pair_champion_v1`) uses the same final evidence requirements as the existing “another pair wins” contract, with the result reversed. Both players are matched regardless of order. A retirement with a confirmed winner counts. Missing, ambiguous or unplayed final evidence stays pending until the frozen refund deadline. This initial contract settles after the final, rather than paying NO immediately on an earlier elimination.

## Rollout

1. Merge the feature onto current `main` and verify the automatic Padel God deployment contains the new resolver. Follow `scripts/session-check.sh` first; never upload the worker manually.
2. From a clean checkout of the merged commit, run `scripts/deploy.sh admin --dry-run` and deploy the admin, then repeat for `web`. Deploy one service at a time. This installs the suggestion UI/API and champion labels in all five locales.
3. Apply `supabase/migrations/20261004110000_play_champion_editorial.sql`. It adds a disabled editorial champion template and creates no markets.
4. Enable `editorial.champion.v1` after confirming the matching worker is running. Existing editorial publishing remains governed by `PLAY_EDITORIAL_PUBLISH_ENABLED`.
5. Load Germany, review the returned cards and approve the desired markets individually. Existing round templates remain reusable without the champion activation.

No live settings, markets, or positions were changed while implementing this feature. A read-only check on 4 October 2026 found no Germany tournament projections; suggestions will become available when that upstream model data exists and the view is refreshed. Match times, fresh model evidence, season coverage, template activation, and publication capacity must still pass the usual checks.

## Verification

- Operator route tests: unauthorized access, malformed event IDs, non-cached reads, unavailable data.
- Suggestion tests: balanced shortlist, deterministic order, invalid/eliminated pairs, missing projections, duplicate and complementary contracts.
- UI tests: no writes on load, explicit reviewed approval, expired previews, changed evidence, already-published cards.
- Champion resolver tests: exact/reversed pairs, alternate winners, retirement, unresolved or conflicting finals and deadline refunds.
- Embedded PostgreSQL lifecycle: draft → preview → publish → trade → early lock → payout → idempotent retry → refund for round and champion contracts. The champion migration starts disabled.
- Browser preview uses the actual component with clearly labelled illustrative data and mock publication. It does not access or write live markets.

Validation completed: admin production build passed; worker TypeScript passed; 29 admin/API/UI tests, 21 resolver tests, 23 consumer tests and both embedded PostgreSQL lifecycle scenarios passed. Four existing route helpers were made private to satisfy Next.js 16 route export checks; their behavior is unchanged. Desktop and 390px-wide browser layouts were inspected.

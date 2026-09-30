# Editorial market cards — 29 September 2026

Implemented ranking and pair card variants using the existing card controls, arena artwork and player image records. The title-count goal shows only exact-pair final wins in the configured tournaments and category. Failed queries and duplicate finals leave progress unknown. Existing match cards retain their original layout.

## Validation

- 40 focused tests passed: market presentation, editorial enrichment, API-to-client parsing, rendered components, purchase/detail callbacks and portrait failure fallbacks.
- Application TypeScript check passed.
- Unauthenticated market API remains hidden (404).
- Browser reviewed the real components rendered with clearly labelled example data. Improved portrait size and removed the portrait tiles after the first comparison.
- Approved pair image and implementation compared together. App header/navigation were intentionally excluded from the component harness. The current ranking comes from the player record; no fabricated points gap is shown. Opening estimates appear separately from trading prices, with their source in details.
- Preview lives under output/editorial-cards, served on loopback only, outside public production assets.

Final result: blocked for full production visual sign-off. Component preview reviewed; authenticated live-market mobile interaction and complete app layout still require verification. No production deployment performed.

## Longer trading windows

No deadline or payout changes were made. Current prices move with orders, not automatically with ranking updates or news. Extending locks alone risks stale prices, particularly during the two-person beta.

Recommended follow-up: explicit updated forecasts, a pause while each relevant result/ranking update is being ingested, and closing open markets as soon as their outcome becomes known. Repricing must preserve purchased shares and audit the market-maker subsidy. Later entrants receive fewer shares per Guaca when the outcome becomes more likely; existing positions keep the one-Guaca-per-winning-share settlement rule. Do not apply a retrospective payout haircut.

## Approved layout implementation follow-up

The approved large Javi portrait and combined pair composition are connected to MarketFeed through MarketCard. The details panel uses the same reusable hero and estimate source. Editorial markets with a bound match do not display opposing match identities or head-to-head statistics as their subject.

Read-only verification against the existing open ranking market passed using the actual MARKET_SELECT, enrichment and client parser. Its large portrait and ranking target were present. No market data was changed. Full authenticated mobile visual sign-off remains outstanding; no deployment was performed.

## Production deployment

Deployment 8fb3bb10-97c4-4083-be6e-e5b4f6084126 succeeded. Production health is 200; unauthenticated markets/shop/me remain 404 and access returns allowed=false. Six access-control tests passed. Release contains only the approved card files over the previous web release; no worker/admin deployment, deadline changes or database writes. Authenticated mobile visual check remains a follow-up.

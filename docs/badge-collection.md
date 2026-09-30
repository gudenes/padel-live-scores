# Collectible badges

Nine active badges appear in profile and `/[locale]/achievements`. Each is a real button opening the shared native dialog, with localized explanation, current progress, next threshold and earned state. Retired earned badges remain in Legacy. No XP display is added.

## Rules

- First Pick: 1 settled market with a nonzero investment.
- King of Predict: 25 profitable settled markets.
- On Fire: best run of 5 profitable settlements; losses and break-even results reset the run. Voids are skipped.
- Tournament Brain: 10 profitable markets in one tournament, including match markets belonging to that tournament.
- Scout: original followed-player thresholds 1 / 5 / 15.
- Match Tracker: original saved-match thresholds 1 / 10 / 50.
- Match Critic: original rating thresholds 1 / 10 / 50.
- Founding Member: original account-created-before-15-May-2026 condition.
- Ambassador: original referral-registration thresholds 1 / 5 / 15 / 50.

A profitable market returns more Guacas than its total cost basis. A market counts once, regardless of trade count or buying both sides. Only confirmed, revision-matched `market_payouts` count. Void, open and unpaid results are excluded. Match markets inherit their tournament from `matches`. First-settlement notices preserve ordering across corrections, with `settled_at` as the fallback for older rows. Earned badges are permanent; current progress uses corrected results. Simulation tables are not queried.

Progress is calculated on request. Awards use the existing check-unlocks flow when opening the collection or completing existing badge-triggering actions; there is no new background award worker. Failed queries return an error rather than a fabricated zero. Concurrent awards use the existing unique constraint, and failed inserts never emit an unlock toast.

No new schema or database migration is required. Development and production share Supabase: testing valid awards can persist them on the current account even before UI deployment. No synthetic result rows were inserted.

## Assets and translations

Wordless source PNGs are in `public/play/badges/collection-v2`. Match Tracker now depicts an enclosed glass padel court. Next Image serves sized images. Scout and Founding Member retain opaque charcoal source backgrounds and use lighten blending on the dark UI. Keep source images for future editing; prompt provenance is in the asset README.

Names, descriptions and interface copy are in `badgeCollection` in EN/ES/PT/FR/IT message files. Artwork is shared across languages. Retired badges also have translated explanations.

The avatar shop's King sticker still has its existing 25-win purchase requirement; this change does not replace the shop's local inventory/wallet flow or award paid items automatically.

## Validation

- Prediction counting and existing gamification tests: 22 passing.
- Scoped lint: passing.
- Browser: Spanish collection, King progress 2/25, Match Tracker progress 35/50, Legacy preservation, profile entry.
- Repository typecheck has existing errors in Play activity, node:sqlite declarations and push-copy tests; no errors in badge changes.

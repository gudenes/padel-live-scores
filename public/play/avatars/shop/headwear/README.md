# Separate headwear assets

Generated 2026-09-28 with ImageGen from the face-06 wardrobe reference.
- backwards-cap.png: cream backwards cap, orange strap, no logos.
- bandana.png: orange open-top tied sports bandana with cream stitching, no logos.

Original transparent PNGs retained in Codex generated_images, results exec-3809a463-3876-4c37-b999-19d2151a0322 and exec-a0a62a39-e6a1-442b-b11d-e7fa30d8caeb. Project copies trimmed of transparent padding with alpha preserved.

ShopItem.headwear supplies placement on the 1024 x 1536 wardrobe canvas. The bandana rear loop is clipped in the worn rendering so it cannot cross the face. Product thumbnails show the complete accessory. Same Figure renderer supplies shop, local profile and header portrait.

## Fit revision
Bandana v2 uses generated result exec-c63e5d9d-6479-4be8-891b-bf19c4659a35 (front fabric only, smaller knot, no rear loop), trimmed with alpha preserved. Retains v1 for provenance. The backwards cap keeps its original alpha asset; the worn rendering cuts out the interior opening, hides crown hair, and lowers/tilts the placement. Two regeneration attempts were rejected for baked/incorrect backgrounds and were not installed. Prices and ownership IDs remain unchanged.

## Backwards cap v3
Replaced the product-angle cream cap with a straight-on charcoal/lime low-profile sprite. Source: exec-b1ea35c5-5024-4d1a-aa75-768073a65065. True alpha opening removes the need for the previous hand-fitted opening clip. Original assets retained; price/ownership unchanged. Checked on the current custom avatar in the local wardrobe. Bandana unchanged.

## Backwards cap fit review (2026-09-29)
The v4–v7 SVGs retain an ImageGen fabric texture with a vector silhouette and transparent adjustment opening. Source texture: exec-baedcf29-6380-4f91-bf24-ae250b0bf3ff; worn-angle reference: exec-692f4136-6cb1-4c30-9c6b-8707ad7a9257 (kept outside public assets). No user face is included in the published cap asset.

Independent screenshot review on the Ace preset: baseline 4/10; iteration1 curved cap 7/10; iteration2 cleaned fringe / temple fit 7.5/10; iteration3 visible strap 7.5/10. Iteration4 lifts charcoal fabric contrast, retaining fit. Photo-avatar validation remains outstanding because the active saved avatar became Ace during the session; no photo selection was changed by either reviewer or implementer. No purchases were made.

Iteration4 independent result: **8/10 on Ace**. Crown separates from dark hair; opening and backwards silhouette are legible; rim follows forehead. Minor remaining right-temple hard edge / left-brim highlight. Stopped after four revisions at requested threshold. Custom-photo fit not revalidated. Scoped ESLint passed; avatar-shop unit tests 9/9 passed.

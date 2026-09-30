# Avatar shop local preview

Route: `/es/avatar-shop` (development only). Entry points are the profile and avatar fitting lab.

## Catalogue

Six equipment slots: racket, shoes, shorts, shirt, wristband and hat. Each has five choices: Starter (free), Club (350), Cobalt (500), Sunset (650), Champion (800 Guacas). Two additional stickers: Mr. Dejadas (650) and King of Predict (800).

Sunset/Mr. Dejadas require 10 correct predictions; Champion/King of Predict require 25. These are example rules, adjustable in the catalogue. Reaching a milestone only unlocks purchasing; the item must still be paid for.

## Preview boundaries

Purchases, ownership, selected avatar and equipment are saved in browser localStorage (`pn:avatar-shop:preview:v1`). The starting 8,500 Guacas are a test balance, independent of the real wallet. Preview controls simulate milestones. Equipment is saved within this preview, not the production profile. No production wallet, inventory, achievement or admin changes are included.

Production integration needs server-owned catalogue/eligibility, inventory and atomic wallet debit + purchase with idempotency. A client-provided achievement count or localStorage balance must never authorize a real purchase.

## Art preservation

Original PNG artwork is retained in `public/play/avatars/` (starter), `swap-lab/` (Club) and `shop/` (Cobalt, Sunset, Champion, stickers and court). Three supported registered avatars: face-06/Nacho, face-02/Rayo, face-08/Dash. Images are composited at runtime using existing slot clipping, so combinations do not flatten or overwrite the source artwork. Future animation still requires a rig or separated body parts; these are retained source references, not an animation-ready rig.

The approved concept and mobile implementation capture are retained alongside this file. The catalogue defines prices, milestone examples, slot geometry and artwork mapping in one place: `src/lib/avatar-shop.ts`.

## Verification

Five unit tests cover prices/catalogue counts, purchase debit/idempotency, milestone + funds checks, ownership enforcement and persistence sanitization. Targeted lint passes. Browser checks cover confirmed purchase, reload persistence, milestone eligibility, cancellation without debit, sticker preview and smaller viewport controls. Repo-wide TypeScript still reports existing errors in activity/local SQLite and push-copy tests; none in the new shop files.

## Standalone product imagery

Product cards, category thumbnails and confirmation now use five dedicated 3×2 product atlases in `public/play/avatars/shop/products/`. They show equipment without characters; the main figure still uses registered character layers. Starter hat intentionally says “No hat”. Artwork was created with built-in image_gen; exact generation and background-refinement prompts are retained in `product-prompts.json`. The final assets use a dark opaque background after the initial transparent request returned a checkerboard. No raster editing was used to extract products.

Verified the revised cards/categories and the Blue Visor confirmation in the browser; cancelled without a purchase. Targeted lint passes. Screenshot: `product-only-preview.png`.

## Profile entry points and original shoe branding

Local profile now has Wardrobe (opens owned items), Shop (catalogue) and Edit face (existing creator). A saved local shop outfit is previewed on the profile; this remains a browser-only demonstration separate from real wallet/production identity. The court background is removed. Product and try-on shoes now use a small triangular Nachos-inspired patch, replacing swooshes. Five versioned product atlases and five shoe-overlay source images are retained under `products/*-nachos.png` and `shoes/*-nachos.png`; original source artwork is preserved. Figure overlays intentionally use only the registered shoe region, leaving each avatar face and other gear intact. Built-in image_gen prompts: `nachos-shoes-prompts.json`. Champion required one additional refinement to erase remaining curved marks; visually checked the final result.

Before production: consolidate face editing and shop identity, account-scope saved inventory, connect server-owned purchases and eligibility, and translate the complete shop. Current changes are a local UX preview, not a production rollout.

## Unified editor

Profile now has a single Edit player action. Old wardrobe query links remain valid but show the full catalogue. Owned and purchasable items share one rail. Removed customer-facing test labels, reset/milestone controls and wardrobe/shop tabs at the user's request; the underlying wallet remains local simulated data and is not production money. Ten existing characters are selectable in a modal, with a direct photo-creation entry using the existing consent/camera/upload component. Photo avatars are validated before persistence and shown whole; incompatible gear purchase/equip is disabled, while stickers remain supported. Seven additional stock characters reuse the shared garment template; per-character fitting polish is still needed before production.

## Identity and image presentation

Editor header reads the canonical saved `profile.display_name` from AuthProvider, with a neutral fallback while loading. Profile entry uses a shopping bag shortcut labelled My style/Mi estilo with an accessible customization label. The Guaca balance has no separate background plate. Existing raster backgrounds are blended into a uniform dark editor surface; source files are unchanged (this is rendering cleanup, not alpha extraction). The shared coin icon clips stray outer-edge pixels to its circular silhouette. Selected category styling keeps the product art visible instead of washing it out against lime.

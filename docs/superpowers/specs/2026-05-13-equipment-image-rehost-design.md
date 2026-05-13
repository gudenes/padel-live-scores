# Equipment image rehost + file upload — design

**Date:** 2026-05-13
**Status:** approved, ready for plan

## Problem

`padel_brands.logo_url` and `padel_rackets.image_url` are free-text fields that point at brand CDNs. Over time those URLs rot:

- `tacticalpadel-gcc.com` returns 409 on every path (Shopify subdomain retired) — kills Bergamini's + Garrido's "Plays with" card. The current Tactical domain (`tacticalpadel.com`) is also password-locked.
- `cdn.shopify.com`, `noxsport.com`, `tennisnuts.com` each have 1 row returning 404.
- 5 of 37 total URLs are dead today. The remaining 32 are 200 but only because nobody has changed those product URLs yet.

The architectural precedent for this exact problem already exists for player avatars: `src/lib/avatar-rehost.ts` + `/api/admin/migrate-avatars` + the `avatars` Supabase Storage bucket. Equipment images should follow the same pattern.

## Scope

**In:**

1. Server-side URL rehost on write — ops pastes any external URL, server downloads and stores on Supabase Storage, row holds the Supabase URL.
2. One-off batch migration of the 32 still-working external URLs.
3. File-upload affordance in the ops `BrandsTab` so brands without a working CDN URL (Tactical today) can still be repaired.
4. `onError` fallback at the two `<img>` render sites — broken images degrade to text/placeholder instead of the browser broken-image icon.
5. One-time manual fixup of the 5 dead rows after the upload affordance ships.

**Out:**

- Auto-discovery of replacement URLs from brand websites. Brand sites rebrand, paywall, and password-lock too often; not worth building.
- A general media-management UI. We're not building an asset library — just unblocking the rot for this one feature.
- Migrating the `avatars` bucket. The player-avatar pattern already works; we're copying it, not refactoring it.

## Architecture

### Storage layout

New Supabase Storage bucket: **`equipment`**. Public, 2 MB file size limit, `image/webp|jpeg|png|gif|svg+xml` allowed.

Key paths:

- `brand-{brandId}.{ext}` for `padel_brands.logo_url`
- `racket-{racketId}.{ext}` for `padel_rackets.image_url`

Rationale for a new bucket vs. reusing `avatars`: keeps blast radius narrow (a botched migration only affects equipment), and the URL itself makes the asset type obvious in DB / logs. Same access pattern, no new RLS.

### Rehost helper — `src/lib/equipment-image-rehost.ts`

Mirrors `avatar-rehost.ts` almost exactly. Single function:

```ts
type EquipmentKind = 'brand' | 'racket'

export async function rehostEquipmentImageToSupabase(
  supabase: SupabaseClient,
  kind: EquipmentKind,
  entityId: string,
  sourceUrl: string | null | undefined,
): Promise<RehostResult>
```

Behavior — copied from the avatar version:

- Short-circuit `skipped-no-source` if `sourceUrl` is falsy.
- Short-circuit `skipped-already-hosted` if `sourceUrl` already points at our Supabase Storage host (`.supabase.co/storage/`).
- Re-read the current row's `logo_url`/`image_url` before downloading — short-circuit again if the row is already Supabase-hosted.
- `fetch` the source; on non-2xx, return `download-failed` with status text. Errors are returned via the result object, never thrown.
- Pick extension from `Content-Type` (`png`, `webp`, `gif`, `jpg`, `svg`); fall back to `jpg`.
- Upload to `equipment/{kind}-{entityId}.{ext}` with `upsert: true`.
- UPDATE `padel_brands.logo_url` or `padel_rackets.image_url` to the new public URL.

Also exports `ensureEquipmentBucket(supabase)` — same shape as `ensureAvatarsBucket`, called once by the batch migration endpoint.

### Ops API — server-side rehost on write

[src/app/api/ops/brands/route.ts](src/app/api/ops/brands/route.ts) and [src/app/api/ops/rackets/route.ts](src/app/api/ops/rackets/route.ts) both accept a free-text URL in `logo_url`/`image_url`. After today's change:

- **POST** (create): insert the row first to get an `id`, then if `logo_url`/`image_url` is set AND is not already a Supabase URL, call the rehost helper. The helper updates the row to the new URL. Failure of the rehost does NOT fail the create — we log the failure and return the row with the original URL so ops can retry.
- **PATCH** (update): if the incoming `updates` includes a `logo_url`/`image_url` that's not already Supabase-hosted, run the rehost helper after the UPDATE. Same failure semantics.

Ops UX is unchanged. Pasting a working external URL becomes a Supabase-hosted URL transparently.

### Ops file upload — new endpoint + UI

**New route:** `POST /api/ops/upload-equipment-image`

- Auth: same `checkOpsAuth()` as the rest of `/api/ops`.
- Accepts `multipart/form-data` with fields `kind` (`brand`|`racket`), `entityId` (uuid), and `file`.
- Validates: MIME ∈ allowed list, size ≤ 2 MB. Rejects with 400 otherwise.
- Uploads to `equipment/{kind}-{entityId}.{ext}` with `upsert: true`.
- Returns `{ url }`.
- Does **not** UPDATE the DB row — that happens via the existing PATCH from the form. Keeps the route narrow and the form flow consistent.

**UI in [src/app/ops/BrandsTab.tsx](src/app/ops/BrandsTab.tsx):**

For both brand `logo_url` and racket `image_url` inputs, add a small "Upload file" button next to the URL textbox. On click, opens a file picker; on selection, POSTs to `/api/ops/upload-equipment-image` with the entity id (or, on create flow, after the row is created); on success, fills the URL field with the returned URL. The existing save flow then PATCHes the row.

The URL input stays — that's still the primary path for brands that publish working hot-link URLs.

### Batch migration — `/api/admin/migrate-equipment-images`

Mirrors `/api/admin/migrate-avatars`:

- Auth: `Authorization: Bearer $CRON_SECRET`.
- Calls `ensureEquipmentBucket`.
- Fetches all `padel_brands` rows where `logo_url` is set and does NOT contain `.supabase.co/storage/`. Calls `rehostEquipmentImageToSupabase('brand', …)` in batches of 20.
- Same for `padel_rackets.image_url` with `kind='racket'`.
- Returns `{ migrated, skipped, failed[] }`.

The endpoint is idempotent — re-running it skips already-hosted rows and only retries previously-failed ones (it'll just hit the same `download-failed` again for genuinely dead URLs, which is fine).

`?kind=brand|racket` and `?limit=N` for partial runs / smoke tests.

### Rendering fallback

[src/app/[locale]/player/[id]/page.tsx:1066-1075](src/app/[locale]/player/[id]/page.tsx:1066) (brand logo) and [:1122-1138](src/app/[locale]/player/[id]/page.tsx:1122) (racket image):

- Add `useState` `brandLogoFailed` / `racketImageFailed`, defaulting to `false`.
- On `<img onError>`, set the corresponding flag to `true`.
- Render fallback when the flag is set OR the URL is null:
  - **Brand logo** → existing `<span>{brandName}</span>` orange-uppercase text branch.
  - **Racket image** → existing placeholder SVG branch.

This means the page never shows a broken-image icon again, regardless of whether the URL eventually rots. The branches already exist; we just gate on a failure state in addition to URL nullness.

### Rollout

1. Land rehost helper + ops API wiring + `<img onError>` fallback. (One PR.)
2. Land file-upload endpoint + BrandsTab UI. (Second PR — depends on bucket existing.)
3. Run `/api/admin/migrate-equipment-images` once in prod. The 32 working URLs become Supabase URLs; the 5 dead ones fail but the DB is untouched.
4. Ops opens `/ops` → Brands & Equipment, uploads files for the 5 dead-URL rows.
5. Done. Future ops edits flow through server-side rehost automatically.

## Decisions made / rationale

- **New bucket vs. reuse `avatars`.** New `equipment` bucket. Narrower blast radius if migration goes sideways; URL self-describes the asset type.
- **Failures in rehost don't fail the write.** Same call as `avatar-rehost.ts`. We never want a broken upstream image to block an otherwise-valid ops edit.
- **Auto-discovery of replacement URLs is out.** Brand websites churn too much; manual upload is the right escape hatch.
- **File-upload writes through the bucket, not the row.** Keeps the existing PATCH form flow as the single source of writes to `padel_brands`/`padel_rackets`. Less duplicated validation.
- **SVG is allowed.** Some brand logos are SVG today (Tactical's old URL was). Bucket allows `image/svg+xml`.

## Open questions

None. All five pieces have proven precedent in `avatar-rehost.ts` / `/api/admin/migrate-avatars` / `ensureAvatarsBucket`.

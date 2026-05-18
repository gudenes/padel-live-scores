# Tournament cover images — design spec

**Date:** 2026-05-18
**Status:** Approved (brainstorm), ready for plan
**Author:** Claude + Gu

## Goal

Let ops upload a single promotional image per tournament and surface it as a hero/background on three places: home Featured Tournament card, Events list cards, and Tournament detail page. Tournaments without a cover keep today's design unchanged — zero visual regression.

## Motivation

The current Featured Tournament card and Events list cards render only a flag, name, dates, and a level pill. For big upcoming events (Italy Major, Madrid P1, finals), that's visually flat — the brand of the event doesn't come through. A press-kit-style cover image on these surfaces makes upcoming tournaments more inviting and helps users distinguish marquee events from routine ones.

Scope is intentionally small: one image per tournament instance, ops-managed, no scheduling, no gallery.

## Surfaces

Three places render the cover when `tournaments.cover_image_url` is non-null. All three use the same "cinematic" treatment: image fills the container, dark gradient bottom-up, existing copy sits on top.

| Surface | Component | Container shape |
|---|---|---|
| Home Featured | [`TournamentSpotlightHero`](src/components/TournamentSpotlightHero.tsx) | 4:5 portrait card, cover fills the card |
| Events list | `BigTournamentCard` inside [`TournamentsView`](src/components/home/TournamentsView.tsx) | 16:9 row card |
| Tournament detail | top of [`/tournaments/[id]`](src/app/[locale]/(app)/tournaments/) | 16:9 hero banner above the existing tabs |

When `cover_image_url` is null, each component falls back to today's design (no markup change for unaffected tournaments).

## Data model

One new column on `tournaments`:

```sql
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
```

- Nullable. Default `NULL`.
- Stores the public Supabase Storage URL of the uploaded image.
- Sibling to the existing `logo_url` (which stays as-is — used for the small badge/identity).
- No RLS changes — `tournaments` is publicly readable.

## Storage

New Supabase Storage bucket `tournament-covers`:

- **Public read** (so `next/image` and `<img>` can load it without signed URLs)
- **Service-key write only** (uploads happen server-side from the ops endpoint)
- Object key: `{tournament_id}.{ext}` where `ext` is the original file extension (`jpg` / `png` / `webp`)
- `upsert: true` on upload — replaces the previous file at the same path, so we don't accumulate stale objects

One migration creates the bucket. Mirror the pattern used by the `avatars` bucket.

## API

### `PATCH /api/ops/tournaments/[id]/cover`

Multipart form-data, single field `file` (image).

**Validation:**
- MIME type must be `image/jpeg`, `image/png`, or `image/webp` (checked from the parsed `File.type` after `formData.get('file')`)
- Buffer size ≤ 5 MB after `await file.arrayBuffer()` — return 413 if exceeded
- No dimension validation server-side; we trust the operator to follow the guidance shown in the UI
- Set `export const runtime = 'nodejs'` on the route so `formData` and the Supabase service-key client work — this matches the existing `/api/ops/brands` setup

**Flow:**
1. Read `ops_token` cookie (existing pattern from `/api/ops/brands`); 401 if missing or mismatched
2. Look up tournament by id; 404 if not found
3. Compute object key `{id}.{ext}` from the file extension
4. `supabase.storage.from('tournament-covers').upload(key, buffer, { upsert: true, contentType })`
5. Build public URL via `supabase.storage.from('tournament-covers').getPublicUrl(key)`
6. `UPDATE tournaments SET cover_image_url = $1 WHERE id = $2`
7. Return `{ ok: true, cover_image_url }`

### `DELETE /api/ops/tournaments/[id]/cover`

- Same auth gate
- `UPDATE tournaments SET cover_image_url = NULL WHERE id = $1`
- Does NOT delete the Storage object. Keeping the object cheap; lets us un-clear by re-pointing if needed. A bucket-level lifecycle policy can clean up later if it ever matters.
- Returns `{ ok: true }`

## Ops UI

New tab **"Tournament covers"** in the ops dashboard, added to [`OpsClient.tsx`](src/app/ops/OpsClient.tsx).

**Layout:**
- Top: filter chips `Upcoming` (default) | `Ongoing` | `All` — most editing happens on upcoming events
- Search box for tournament name (debounced, client-side filter over the loaded list)
- Table rows:
  - Column 1: small thumbnail (~60×34, 16:9) of current cover, or "no cover" placeholder
  - Column 2: tournament name, dates, level pill
  - Column 3: action buttons — **Upload** (or **Replace** if cover already set) and **Remove** (disabled when no cover)

**Upload flow:**
1. Operator clicks Upload → native file picker (`accept="image/jpeg,image/png,image/webp"`)
2. After file pick, show inline preview + confirmation:
   > Recommended: 1600×900 (16:9), at least 1200 wide. JPG or WebP. The image is cropped from the center, so keep the focal point centered.
3. On confirm, POST multipart to `PATCH /api/ops/tournaments/[id]/cover`
4. On success, optimistic-update the thumbnail in the table
5. On failure, show inline error (size too big, wrong MIME type, network)

**Remove flow:**
1. Click Remove → confirm dialog ("Remove the cover image for {name}?")
2. On confirm, `DELETE /api/ops/tournaments/[id]/cover`
3. On success, thumbnail returns to placeholder

Reuse the table style from `TournamentExplorerTab` so the feel is consistent.

## Frontend rendering

### TournamentSpotlightHero (home Featured card)

- Wrap the existing card in a `relative` container with `aspect-[4/5]`
- Behind everything: `next/image` with `fill` + `object-cover` pointing at `tournament.cover_image_url`
- Add an absolutely-positioned `::after`-style gradient layer: `linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.15) 30%, rgba(0,0,0,0.85) 100%)`
- The existing children (pills, title, champions row, countdown grid, CTA) all get `position: relative; z-index: 2` so they sit above the gradient
- The home page query at `src/app/[locale]/(app)/home/page.tsx` already needs to include `cover_image_url` in its tournament select
- **Fallback:** if `cover_image_url` is null, render exactly today's markup (no image, no gradient layer)

### BigTournamentCard (Events list)

- Same pattern at smaller scale: 16:9 card, `next/image fill object-cover`, gradient overlay (this time more left-heavy: `linear-gradient(90deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 50%, rgba(0,0,0,0.2) 100%)`), copy on top
- Days-counter badge moves to **top-right** (matches the mockup; old position needs to be vacated so the title has room over the gradient). The fallback variant (no cover) keeps the badge wherever it sits today — only the with-cover branch repositions it.
- `TournamentsView` already selects `logo_url` — extend the select to include `cover_image_url`
- Fallback: when null, render today's card markup

### Tournament detail page

- New top section above the existing tabs: 16:9 banner with `next/image fill object-cover`
- Bottom-anchored title + dates + level pill on a dark gradient
- When `cover_image_url` is null, hide the banner entirely (no empty space) — tabs sit where they do today

### Image config

- `next.config.ts` already allows `jwqaesjjoghzobngxejn.supabase.co` (verified in CLAUDE.md). No remote-patterns change needed.
- Use `sizes` prop on `next/image` to hint the responsive variants: e.g., `sizes="(max-width: 480px) 100vw, 480px"` for the cards, `sizes="(max-width: 480px) 100vw, 600px"` for the home featured.
- No `priority` flag — these are below the fold often, let Next decide.

## Type changes

Add `cover_image_url: string | null` to:
- The `Tournament` type in `src/components/home/shared.tsx`
- The local `Tournament` type in `src/components/TournamentSpotlightHero.tsx`
- The tournament select in `src/app/[locale]/(app)/home/page.tsx`
- The tournament select in `src/components/home/TournamentsView.tsx`
- The tournament select on the detail page

## Migrations

Two migrations, in order. Filenames get the standard timestamp prefix from `npx supabase migration new <name>`:

1. `add_cover_image_url_to_tournaments` — the `ALTER TABLE`
2. `create_tournament_covers_bucket` — `INSERT INTO storage.buckets (id, name, public) VALUES ('tournament-covers', 'tournament-covers', true) ON CONFLICT DO NOTHING;` plus a storage RLS policy granting service-key write and anon read (mirror existing avatars policies)

## Testing

- **Migration:** apply locally, verify column exists, verify bucket exists and is public
- **API:**
  - PATCH with valid JPG → 200, file in bucket, `cover_image_url` set
  - PATCH with PDF → 400 (MIME rejected)
  - PATCH with 6MB file → 413 (size rejected)
  - PATCH without `ops_token` → 401
  - DELETE → `cover_image_url` becomes null; Storage object remains
- **UI:** manual ops walkthrough for upload, replace, remove
- **Frontend rendering:** seed a test tournament with a cover URL, verify it renders correctly on all three surfaces; clear the URL, verify fallback unchanged
- **No automated visual tests** — `useInViewOnce` / image rendering is hard to assert and not load-bearing for correctness

## Out of scope (YAGNI)

- Multi-image gallery per tournament
- Scheduled cover changes ("show this from date X to Y")
- Client-side image cropper or auto-cropping
- Server-side image resizing / WebP conversion (next/image handles responsive variants)
- Moderation or approval workflow — this is an internal ops tool
- Caching / CDN concerns beyond what Supabase Storage + Vercel image optimization already provide
- Tournament detail page redesign — only the new hero banner is added; everything else stays
- Migrating existing `logo_url` to anything else

## Open questions

None that block implementation. Decision points already settled:
- Per-tournament instance (Italy Major 2026 and 2027 each get their own cover): yes
- File upload, not URL paste: yes
- Cinematic treatment (Variant 2 from mockup): yes
- Three surfaces (home, events, detail): yes
- No match-page header background: out of scope

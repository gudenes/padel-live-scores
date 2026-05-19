# Tournament cover images — design spec

**Date:** 2026-05-18 (revised 2026-05-19)
**Status:** Approved (revised after user review), ready for plan
**Author:** Claude + Gu

## Revision note (2026-05-19)

The detail-page surface was originally specced as a static 16:9 hero banner sitting *above* the existing sticky header. After implementing v1 and reviewing it together, the user asked for a **modern collapsing-header pattern** instead — the cover lives *inside* the existing header, and a single sticky bar shrinks from 280 px to 62 px as the user scrolls. The two card surfaces (home Featured, events list) keep their already-shipped designs unchanged.

The identity block (flag / title / level pill / FOLLOW) inside the expanded hero went through three variations and landed on **V1 "Broadcast"**: kicker pill above the title, big title dominant, single tight metadata row with a small flag.

Reference mockup: [`mockups/tournament-cover-collapsing-header.html`](../../../mockups/tournament-cover-collapsing-header.html).

## Goal

Let ops upload a single promotional image per tournament and surface it as a hero/background on three places: home Featured Tournament card, Events list cards, and Tournament detail page. Tournaments without a cover keep today's design unchanged — zero visual regression.

## Motivation

The current Featured Tournament card and Events list cards render only a flag, name, dates, and a level pill. For big upcoming events (Italy Major, Madrid P1, finals), that's visually flat — the brand of the event doesn't come through. A press-kit-style cover image on these surfaces makes upcoming tournaments more inviting and helps users distinguish marquee events from routine ones.

Scope is intentionally small: one image per tournament instance, ops-managed, no scheduling, no gallery.

## Surfaces

Three places render the cover when `tournaments.cover_image_url` is non-null. All three use the same "cinematic" treatment: image fills the container, dark gradient bottom-up, existing copy sits on top.

| Surface | Component | Container shape | Status |
|---|---|---|---|
| Home Featured | [`TournamentSpotlightHero`](src/components/TournamentSpotlightHero.tsx) | 4:5 portrait card, cover fills the card | shipped on branch |
| Events list | `BigTournamentCard` inside [`TournamentsView`](src/components/home/TournamentsView.tsx) | 16:9 row card, days badge top-right when cover set | shipped on branch |
| Tournament detail | top of [`/tournaments/[id]`](src/app/[locale]/(app)/tournaments/) | **Collapsing sticky header** (see below) — replaces the existing 3-row sticky header | revised, pending |

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

### Tournament detail page — collapsing header (revised)

Replaces the v1 static 16:9 banner. Designed around iOS-native large-title behavior. Reference: [`mockups/tournament-cover-collapsing-header.html`](../../../mockups/tournament-cover-collapsing-header.html).

#### Structure

Two stacked elements at the top of the scroll container, plus the existing tabs row:

```
<main /* scroll container */>
  <Navbar sticky top:0 z-25 height:62  />     # always present
  <HeroExpanded margin-top:-62 z-5 height:280 /># overlaps the navbar at scroll=0,
                                                # scrolls away naturally
  <TabsBar sticky top:62 />                    # latches under collapsed bar
  <BodyContent />                              # everything below tabs
</main>
```

Key decisions (locked with user 2026-05-19):

- **Expanded height**: 280 px (matches today's 16:9 ratio at 500 px width)
- **Collapsed height**: 62 px (matches today's sticky Row 1 height — no breaking change to other vertical rhythms)
- **Cover at collapse**: persists as a dim background (`brightness(0.35) saturate(0.7)` + `rgba(10,10,10,0.55)` overlay) — brand presence without overpowering
- **Tabs**: stay sticky at `top: 62 px` (already sticky today, just relocate target)
- **FOLLOW button**: lives inline in the identity stack when expanded, cross-fades to the compact navbar's right side when collapsed (mirrors player-page pattern from `player/[id]/page.tsx:710`)
- **Compact title**: full tournament name (e.g. "Italy Major") at 18 px, fades in alongside the compact FOLLOW
- **Motion**: honors `prefers-reduced-motion` — snaps between expanded and collapsed without interpolation

#### Navbar (sticky, 62 px, always at top)

Three layers, z-indexed:

1. **`<img>` background** (`object-fit: cover`, `object-position: center`, `filter: brightness(0.35) saturate(0.7)`, `opacity: 0 → 1` interpolated with scroll, z=0)
2. **Dark overlay** (`background: rgba(10,10,10,0.55)`, `opacity: 0 → 1` interpolated, z=1)
3. **Chrome row** (`display: flex; align-items: center; gap: 10px; padding: 12px 16px; height: 62`, z=2):
   - Back arrow (always visible)
   - Compact title `"Italy Major"` (18 px, weight 800, color #fff, opacity `0 → 1` over scroll-progress 0.55 → 0.95)
   - M/W gender toggle (always visible, exact spec from `page.tsx:706`)
   - FOLLOW button (`FollowButton variant="follow"`, opacity `0 → 1` over scroll-progress 0.55 → 0.95, `pointer-events: none` until opacity > 0.5)

When `cover_image_url` is null, layers 1 and 2 are absent — navbar is flat `var(--bg-elev)` (`#0A0A0A`). All chrome behavior identical.

#### Hero expanded (280 px, scrolls away naturally)

`margin-top: -62px` pulls it up to overlap the navbar at scroll=0. No JS height manipulation — it scrolls naturally and the navbar's opacity-fade-in takes over.

Layers:

1. **`<img>` cover** (full bleed, `object-fit: cover`, z=0)
2. **Gradient overlay** (`linear-gradient(180deg, rgba(10,10,10,0.40) 0%, rgba(10,10,10,0.15) 30%, rgba(10,10,10,0.92) 100%)`, z=1, pointer-events: none)
3. **Identity block** at `bottom: 0` (V1 Broadcast layout — see below), z=3

#### Identity block — V1 "Broadcast"

Locked layout, mirrors mockup. Flex row, `align-items: flex-end`, `gap: 14`:

```
+------------------------------+   +------------+
| [MAJOR]   <- kicker pill     |   | + FOLLOW   |
| Italy Major   <- 26px title  |   | (inline,    |
| 🇮🇹 venue · dates · prize  |   |  outer-right|
+------------------------------+   +------------+
```

**Kicker pill** (level indicator above title):
- `font-size: 10px; font-weight: 800; padding: 4px 12px; letter-spacing: 0.7px; text-transform: uppercase`
- `background: var(--green-neon)` (`#BCE83B`)
- `color: #0A0A0A`
- `clip-path: var(--cp-badge)` (existing CHUNKY badge clip-path)

**Title**:
- `font-size: 26px; font-weight: 900; line-height: 1.05; letter-spacing: -0.5px; color: #fff`
- `text-shadow: 0 2px 8px rgba(0,0,0,0.45)` for legibility against varied cover content
- `margin-top: 6px` from kicker
- Wraps on long names (no truncation needed at this size)

**Metadata row** (`v-onerow` in the mockup):
- `display: flex; align-items: center; gap: 8px; margin-top: 8px`
- Flag: 16×11, `border: 1px solid rgba(255,255,255,0.3)` (no separate wrapper — inline with text)
- Text: `font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.88); text-shadow: 0 1px 4px rgba(0,0,0,0.4)`
- Content: `{venue} · {dates} · {prize}` joined by `·` separators
- Single line; truncate with `text-overflow: ellipsis` if it overflows on narrow screens

**FOLLOW button** (`FollowButton type="tournament" targetId={id} variant="follow"`):
- Outer-right flex item, `align-self: flex-start; margin-top: 6px` so it sits next to the kicker pill vertically
- Cross-fades with the compact-navbar FOLLOW: `opacity: 1 → 0` over scroll-progress 0.30 → 0.70

#### Tabs row

Already exists in the page (`page.tsx:837`). Two changes:

1. Move it out of the existing sticky parent (currently nested inside the same `position: sticky` div as Row 1 + Row 2).
2. Wrap it in its own sticky element: `position: sticky; top: 62px; z-index: 19; background: var(--bg-elev);`

When the user scrolls past the hero, tabs latch directly under the collapsed navbar with no gap.

#### Scroll listener

Single `scroll` handler on the scroll container. Computes one progress value `p = clamp(scrollTop / 218, 0, 1)` where 218 = (expanded - collapsed) = 280 - 62. Drives:

- Navbar bg `opacity = p`
- Navbar overlay `opacity = p`
- Compact title `opacity = clamp((p - 0.55) / 0.4, 0, 1)`
- Compact FOLLOW `opacity = clamp((p - 0.55) / 0.4, 0, 1)` + pointer-events toggle at 0.5
- Inline FOLLOW (in hero) `opacity = clamp((0.7 - p) / 0.4, 0, 1)` + pointer-events toggle at 0.5

Wrapped in `requestAnimationFrame` for smoothness. `prefers-reduced-motion` snaps to `p=0` or `p=1` based on whether scroll has passed half-way.

#### Old standalone hero (delete)

The 49-line standalone 16:9 banner shipped in Task 8 of the original plan (committed at `08dae528`) is deleted entirely. Its only consumer was the detail page; nothing else imports it.

#### Fallback (no `cover_image_url`)

Hero expanded still renders the 280 px container with the same gradient over a flat `var(--bg-elev)` background — no image. Identity block renders identically. Navbar bg/overlay layers are absent. Collapse animation still happens — UX feels consistent regardless of cover presence.

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
- **Frontend rendering:**
  - Home Featured + events list cards: already verified end-to-end on the branch (4 surfaces × upload + remove round-trip, 2026-05-19 session).
  - Detail page collapsing header: scroll the page in dev and verify (a) navbar bg/overlay fade in over 0–218 px scroll, (b) compact title + FOLLOW fade in over 0.55–0.95 of progress, (c) inline FOLLOW fades out over 0.30–0.70 of progress, (d) tabs latch at top: 62 px on full collapse, (e) hero scrolls away without leaving body-content visible above the navbar, (f) `prefers-reduced-motion` snaps without animation.
  - Fallback path: clear the cover URL, verify the collapsing behavior still happens cleanly with a flat-color navbar.
- **No automated visual tests** — image rendering and scroll-driven motion are hard to assert and not load-bearing for correctness

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

None that block implementation. Decision points (revised 2026-05-19):

- Per-tournament instance (Italy Major 2026 and 2027 each get their own cover): yes
- File upload, not URL paste: yes
- Cinematic treatment (Variant 2 from original mockup): yes for home + events list cards (shipped)
- **Detail page**: collapsing-header pattern (not the original static 16:9 banner) — superseded
- Three surfaces (home, events, detail): yes
- No match-page header background: out of scope
- Identity block on the expanded hero: V1 "Broadcast" — kicker pill above big title, single-row metadata with small flag, FOLLOW outer-right
- Banner heights: 280 expanded → 62 collapsed
- Cover persists faintly at full collapse
- Tabs stay sticky at top: 62 px when collapsed

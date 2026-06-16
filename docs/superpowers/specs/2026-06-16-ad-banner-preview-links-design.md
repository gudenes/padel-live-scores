# Ad Banner Preview Links — Design

**Date:** 2026-06-16
**Status:** Approved (brainstorm)
**Branch:** `feat/ad-banner-preview-links`

## Problem

Dev and production share one Supabase project, so a banner's `active` flag is
global: flipping it `true` to preview the creative shows it to every real
production visitor; leaving it `false` hides it everywhere. There is no way to
let a stakeholder eyeball a not-yet-live banner in context before it goes live.

The existing `?geo=XX` override forces a country and bypasses the consent gate,
but it can only surface banners that are already `active=true` — it can't reveal
a draft.

## Goal

A **shareable preview link** on the live site that surfaces one specific banner
— regardless of its `active` flag — to anyone who opens it, on the same routes
where ads normally appear. Stakeholders open the link, see the creative in
context, and sign off before the operator flips it live. No schema change.

## Non-Goals (YAGNI)

- No `draft`/`preview` status column on `ad_banners`.
- No signed or expiring tokens — the banner `id` is already an unguessable UUID,
  and these are internal sign-off links, not public secrets.
- No native-app preview — web sign-off only.
- No "exit preview" button — closing the browser tab clears the preview.

## Design

### The link

```
https://padelnachos.com/matches?ad_preview=<bannerId>
```

The UUID in `ad_preview` is the secret. Reaching `/matches` lands the reviewer
directly on an ad-eligible route so the banner appears immediately.

### 1. Admin: "Copy preview link" action

In `apps/ops/src/app/(app)/ads/_components/AdsTab.tsx`, add a **Copy preview
link** action to each banner row's Actions cell (alongside Edit / Delete). It
builds `<publicSiteBase>/matches?ad_preview=<banner.id>` and writes it to the
clipboard, with a transient "Copied" confirmation.

- The public site base URL comes from a config value (e.g.
  `NEXT_PUBLIC_PUBLIC_SITE_URL`), defaulting to `https://padelnachos.com` if
  unset. Do not hardcode the host in the component body.
- The action is available regardless of the banner's `active` state (the whole
  point is previewing inactive banners), and works on a saved banner that has an
  `image_url` (no creative ⇒ nothing to preview; either disable the action or
  let it copy anyway — disabling when `image_url` is empty is cleaner).

### 2. Public: `useAdPreview()` hook

New hook in `src/hooks/useAdPreview.ts`, mirroring `useGeoCountry`'s
`useSyncExternalStore` pattern so the server snapshot is "no preview" (returns
`null`) and there is no hydration mismatch.

Behavior:
- On the client, read `?ad_preview=<id>` from `window.location.search`.
- On first read with a non-empty id, persist the id to **`sessionStorage`**
  (key `ad_preview`). This survives in-app navigation between match/player pages
  (which drops the query string) and is cleared automatically when the tab
  closes — matching the "tab close clears it" non-goal.
- Subsequent reads (after navigation) fall back to the `sessionStorage` value.
- Returns the preview banner id (`string`) or `null`.

This mirrors the existing `?geo=` persistence in `StickyAdBanner`, except it
uses `sessionStorage` (session-scoped) rather than a 24h cookie, because a
preview should not outlive the review session.

### 3. Public: `/api/ads/preview` endpoint

New route `src/app/api/ads/preview/route.ts`:

```
GET /api/ads/preview?id=<bannerId>
→ { banner: AdBanner | null }
```

- Selects the single banner by `id` from `ad_banners` with the **same column
  set** as `/api/ads/active`, but with **no `active` filter** (this is the only
  reason it can't reuse the cached active endpoint, which hard-filters
  `active=true`).
- Returns `{ banner: null }` when the id is unknown or on any error — graceful
  empty, never a hard error to the caller.
- Not publicly cacheable in the aggressive way `/api/ads/active` is (it is keyed
  by a specific id and used rarely); a short/no cache is fine.

### 4. Public: render override in `StickyAdBanner`

In `src/components/ads/StickyAdBanner.tsx`:

- Call `useAdPreview()`. When it returns a non-null id, fetch that banner via the
  new endpoint (a small `useEffect` or a thin `usePreviewBanner(id)` hook).
- **Preview branch:** when a preview banner is loaded, use it directly instead of
  `pickBanner(active.banners, country)`. Compute visibility as
  `isAdRoute(pathname)` **only** — bypassing both the country filter (preview
  ignores `country_codes`) and the consent / native gate (`hasDecided ||
  testingGeo || isNative`). The reviewer always sees it on ad routes.
- **Default branch:** when there is no preview id, behavior is byte-for-byte
  identical to today (`pickBanner` + consent gate). The preview path is purely
  additive.
- `pickBanner` is **not** modified.

### 5. No metric pollution + clarity badge

A `preview?: boolean` flag flows `StickyAdBanner → AdSlot → SponsorCard`.

In `src/components/ads/SponsorCard.tsx` when `preview` is true:
- **Skip** `trackImpression` (the `useEffect`) and `trackClick` (the `onClick`),
  so sign-off traffic never writes to `ad_impressions` / `ad_clicks`.
- Keep the click-through `<a href={banner.click_url}>` live so reviewers can
  verify the destination URL (just untracked).
- Replace the small **"Ad"** disclosure tag with a **"PREVIEW"** badge so nobody
  mistakes the preview for a live ad. (Visually distinct, e.g. a different
  background colour; same corner placement.)

`AdSlot.tsx` gains a `preview` prop it passes straight through to `SponsorCard`.

## Data Flow

```
Operator (admin /ads)
  └─ "Copy preview link" → https://padelnachos.com/matches?ad_preview=<id>
        │ (shares link)
        ▼
Reviewer (padelnachos.com/matches?ad_preview=<id>)
  └─ StickyAdBanner
       ├─ useAdPreview() → id (persisted to sessionStorage)
       ├─ GET /api/ads/preview?id=<id> → { banner }   (no active filter)
       ├─ visible = isAdRoute(pathname)   (country + consent bypassed)
       └─ AdSlot preview → SponsorCard preview
             ├─ render creative + "PREVIEW" badge
             ├─ click_url live (untracked)
             └─ NO impression / click tracking
```

## Error Handling

- Unknown / malformed `ad_preview` id ⇒ endpoint returns `{ banner: null }` ⇒
  no banner renders (same as "no ad"). No error surfaced.
- Endpoint/network failure ⇒ caught, treated as `{ banner: null }`.
- Preview id present but reviewer not on an ad route ⇒ nothing renders (expected;
  the link points at `/matches`).

## Testing

- **`/api/ads/preview` route:** returns an `active=false` banner by id; returns
  `{ banner: null }` for an unknown id.
- **`StickyAdBanner` preview branch:** with a preview id, the previewed banner is
  shown even when `pickBanner` would return a different (or no) banner; country
  filtering and the consent gate are bypassed; on a non-ad route nothing renders.
- **`SponsorCard` preview mode:** impression/click tracking is suppressed; the
  "PREVIEW" badge renders instead of "Ad"; the `href` is still present.
- `pickBanner` tests are untouched (logic unchanged).

## Files Touched

| File | Change |
|---|---|
| `apps/ops/src/app/(app)/ads/_components/AdsTab.tsx` | "Copy preview link" row action |
| `src/hooks/useAdPreview.ts` | **new** — read `?ad_preview` + sessionStorage |
| `src/app/api/ads/preview/route.ts` | **new** — fetch one banner by id, no active filter |
| `src/components/ads/StickyAdBanner.tsx` | preview branch (fetch + override + bypass gates) |
| `src/components/ads/AdSlot.tsx` | pass-through `preview` prop |
| `src/components/ads/SponsorCard.tsx` | suppress tracking + "PREVIEW" badge in preview mode |

No database migration. No change to `/api/ads/active`, `pickBanner`, or the
impression/click endpoints.

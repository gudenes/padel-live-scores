# Ops-Managed Ad Banners + Network Config — Design

**Date:** 2026-06-03
**Status:** Approved (design)
**Builds on:** [2026-06-01 sponsor ad slots](2026-06-01-sponsor-ad-slots-design.md)

## Goal

Manage sponsor ad banners from the ops dashboard (admin.padelnachos.com, the `apps/ops/` app) with **no code deploy**: upload a banner creative, set its destination link, target it to a country, and toggle it on/off. Also store **AdSense/AdMob** settings in the ops UI for later wiring. This replaces today's code-config sponsor registry (`src/lib/sponsors.ts`).

## Scope

**In scope**
- DB-backed ad banners (per-country + a global default), managed in ops.
- Banner image upload to Supabase Storage from ops.
- A global AdSense/AdMob **config** (publisher/app/unit IDs + enable toggles) — **stored only**, surfaced in ops.
- Live runtime resolution on the public site (banner shown updates without a deploy).
- Migration off the `src/lib/sponsors.ts` array (seed the current AceProGrip ES banner).

**Out of scope (deferred to a later spec)**
- Actual AdSense (web) / AdMob (native) **rendering**: ad-network scripts, GDPR/consent wiring for networks, the Capacitor AdMob plugin, native rebuild. The `NetworkAdSlot` seam stays a stub; the stored config is what a future spec consumes.
- Banner rotation, weighted serving, and date scheduling (a single active banner per country + global default; `weight` column reserved).

## Decisions (from brainstorming)

- **Targeting:** one active banner per country per slot, plus an optional **global default** for countries without a specific banner. Mirrors the `partners` "one active per country" model.
- **Scheduling:** `active` on/off only (no start/end dates yet).
- **Network config:** **global** (one set of IDs), capturing both web (AdSense) and native (AdMob) fields with enable toggles.
- **Placement:** a **dedicated "Ads" item in the ops rail** (not on the Brands & Equipment page).

## Data model

Two new tables. The existing `ad_clicks` / `ad_impressions` tracking tables are unchanged (their `sponsor_id` column now stores the banner `id`).

### `ad_banners`
```sql
CREATE TABLE ad_banners (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,                     -- e.g. 'AceProGrip'
  country_code TEXT CHECK (country_code ~ '^[A-Z]{2}$'),  -- NULL = global default
  slot        TEXT NOT NULL DEFAULT 'sticky-bottom',
  image_url   TEXT NOT NULL,                     -- Supabase Storage public URL
  click_url   TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  weight      INTEGER NOT NULL DEFAULT 1,        -- reserved (rotation, later)
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- One active banner per (slot, country). NULL country collapses to a single
-- 'GLOBAL' default per slot via COALESCE so the partial index still applies.
CREATE UNIQUE INDEX ad_banners_active_slot_country_uniq
  ON ad_banners (slot, COALESCE(country_code, 'GLOBAL'))
  WHERE active;

CREATE INDEX idx_ad_banners_active ON ad_banners (slot) WHERE active;

ALTER TABLE ad_banners ENABLE ROW LEVEL SECURITY;  -- service-key only; no anon policies
```

### `ad_network_config` (singleton)
```sql
CREATE TABLE ad_network_config (
  key                 TEXT PRIMARY KEY DEFAULT 'default' CHECK (key = 'default'),
  web_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  adsense_publisher_id TEXT,
  adsense_slot_id     TEXT,
  native_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  admob_ios_app_id    TEXT,
  admob_android_app_id TEXT,
  admob_banner_unit_id TEXT,
  updated_at          TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE ad_network_config ENABLE ROW LEVEL SECURITY;  -- service-key only
INSERT INTO ad_network_config (key) VALUES ('default') ON CONFLICT DO NOTHING;
```

### Seed (in the migration)
Insert the current placeholder so nothing disappears when the code config is removed:
```sql
INSERT INTO ad_banners (name, country_code, slot, image_url, click_url, active)
VALUES ('AceProGrip', 'ES', 'sticky-bottom',
        '/sponsors/aceprogrip-banner.svg', 'https://www.aceprogrip.es/', TRUE);
```
(The `/sponsors/...svg` path stays valid until a real creative is uploaded, at which point `image_url` becomes a Supabase Storage URL.)

## Runtime resolution (public site, live)

- **`GET /api/ads/active?slot=sticky-bottom`** (main app, server route, service key) → returns *all active banners for the slot* plus the network config:
  ```json
  { "banners": [{ "id": "...", "name": "AceProGrip", "country_code": "ES",
                  "image_url": "...", "click_url": "..." }],
    "network": { "web_enabled": false, "native_enabled": false, ... } }
  ```
  Set `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` — one cached response serves every visitor; ops edits go live within ~a minute. No country in the query, so the response is country-agnostic and cache-friendly.

- **`pickBanner(banners, country)`** — pure, unit-tested client helper in `src/lib/ad-banner-resolver.ts`:
  1. active banner whose `country_code === country` → use it
  2. else active banner whose `country_code === null` (global default) → use it
  3. else `null` (caller falls back to `NetworkAdSlot`)

- **`AdSlot` / `StickyAdBanner`** fetch `/api/ads/active` (via a small `useActiveBanner(slot)` hook with SWR-style caching), resolve with `pickBanner(..., useGeoCountry())`, then render `SponsorCard` (image + click-through + existing impression/click tracking, keyed by banner `id`) or `NetworkAdSlot`. The `?geo=` test override, route gating (matches/match/player), and consent gate all stay.

## Ops UI — dedicated "Ads" rail page

New page `apps/ops/src/app/(app)/ads/page.tsx` + `_components/AdsTab.tsx`, modeled on `BrandsTab.tsx`, added to the ops Rail.

- **Ad Banners** (`Panel` + `DataTable`): rows show name, country (or "Global"), active, a thumbnail of `image_url`, Edit. Add/Edit form: `name`, `country` dropdown (ISO list + "Global default"), `click_url`, `active` toggle, and a **banner image upload** button (disabled until the row is saved, like brands). On image upload success, set `image_url` and show "uploaded — Save to persist". Saving a banner active for a country that already has one surfaces the unique-constraint error as a friendly message ("a banner is already active for ES — deactivate it first").
- **Network Ads (AdSense / AdMob)** (`Panel`): the `ad_network_config` fields — Web: `web_enabled`, `adsense_publisher_id`, `adsense_slot_id`; Native: `native_enabled`, `admob_ios_app_id`, `admob_android_app_id`, `admob_banner_unit_id` — with a Save button. A note states rendering is not wired yet.

## APIs & auth

Two auth worlds already exist; we follow them:

**apps/ops** (Auth.js session + `isOperator`, like `upload-equipment-image`):
- `GET/POST/PATCH/DELETE /api/internal/ad-banners` — list/create/update/delete banners. PATCH shape `{ id, updates }` (mirrors brands).
- `GET/PATCH /api/internal/ad-network-config` — read/update the singleton.
- `POST /api/internal/upload-ad-banner-image` — multipart (`bannerId`, `file`); validates MIME (PNG/JPEG/WebP/SVG) + ≤2 MB; uploads to the **`ad-banners`** Storage bucket as `banner-{bannerId}.{ext}` (`upsert: true`); returns the public URL. (New bucket created via the Supabase dashboard/migration.)

**main app** (public site):
- `GET /api/ads/active` — public read (service key), active rows only, cached.
- Existing `POST /api/ads/click` + `/api/ads/impression` unchanged except `sponsorId` now carries the banner `id`.

## Migration off the code config

- `src/lib/sponsors.ts`: remove `SPONSORS` + `getActiveSponsor`. Keep a small `AdBanner`/`AdNetworkConfig` TypeScript type (moved to `src/lib/ad-banner-resolver.ts` alongside `pickBanner`). `AdSlotId` stays.
- `src/components/ads/SponsorCard.tsx`: take a `banner` object (`{ id, name, image_url, click_url }`) instead of the config `Sponsor`. Tracking calls use `banner.id` as `sponsorId`. Visual styling unchanged (still the 320×50 sticky variant).
- `AdSlot.tsx`: resolves via the fetched banners + `pickBanner` instead of `getActiveSponsor`.

## Error handling

- `/api/ads/active`: on DB error, return `{ banners: [], network: null }` with 200 so the site degrades to "no ad" rather than erroring; log server-side.
- Upload: reject bad MIME/oversize with 400; surface the message in the ops form.
- Banner CRUD: unique-constraint violations return a 409 with a human message the ops form displays.
- Client: a failed `/api/ads/active` fetch → render nothing (no banner), never block the page.

## Testing

- **Unit:** `pickBanner` — country match, global fallback, none; ignores inactive.
- **API:** `/api/ads/active` returns only active rows and the network config; ops CRUD + upload reject unauthenticated requests.
- **Local verification (per "test locally"):** in ops, create a banner (country ES), upload an image, mark active → load the public site with `?geo=ES` and see it; toggle off → it disappears; set a global-default banner and load with `?geo=PT` → see the default. Confirm a click writes an `ad_clicks` row with the banner `id`.

## File map

| Purpose | Path | Action |
|---|---|---|
| DB schema + seed | `supabase/migrations/2026060300_ops_ad_banners.sql` | create |
| Resolver + types | `src/lib/ad-banner-resolver.ts` (+ `__tests__`) | create |
| Public read route | `src/app/api/ads/active/route.ts` | create |
| Active-banner hook | `src/hooks/useActiveBanner.ts` | create |
| Ops page | `apps/ops/src/app/(app)/ads/page.tsx` | create |
| Ops component | `apps/ops/src/app/(app)/ads/_components/AdsTab.tsx` | create |
| Ops banners API | `apps/ops/src/app/api/internal/ad-banners/route.ts` | create |
| Ops config API | `apps/ops/src/app/api/internal/ad-network-config/route.ts` | create |
| Ops upload API | `apps/ops/src/app/api/internal/upload-ad-banner-image/route.ts` | create |
| Rail entry | ops Rail config (`apps/ops/src/components/shell/Rail.tsx` or equivalent) | modify |
| Sponsor config removal | `src/lib/sponsors.ts` | modify/remove |
| Card refactor | `src/components/ads/SponsorCard.tsx`, `AdSlot.tsx`, `StickyAdBanner.tsx` | modify |

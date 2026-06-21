# Ad Banner Performance Columns — Design

**Date:** 2026-06-21
**Status:** Approved (brainstorm), pending implementation plan

## Problem

Direct-sold sponsor banners (`ad_banners`) already track engagement: impressions land in
`ad_impressions` (daily aggregate per `slot, sponsor_id, date`) and clicks land in `ad_clicks`
(one row per click). Both are written by the public app via `/api/ads/impression` and
`/api/ads/click`, keyed by `sponsor_id = ad_banners.id` (the banner UUID, as text).

The data is being collected, but **there is no surface to read it** — an operator has to run SQL
in the Supabase dashboard. We want the numbers visible where banners are managed: the ops Ads tab.

## Scope (decided)

- **Metrics:** impressions, clicks, CTR per banner. No daily trend, no country/locale breakdown.
- **Placement:** inline columns on the existing banners table in `AdsTab.tsx` (not a separate
  section or tab).
- **Window:** all-time totals.
- **Freshness:** live on page load; no caching.

Explicitly out of scope (YAGNI): time-window filters, sparklines/charts, per-country or
per-locale breakdowns, CSV export, a dedicated analytics tab.

## Approach

A DB **view** does the aggregation, the existing ops list endpoint reads it and merges, the
table renders three new columns.

Alternatives considered and rejected:
- **Aggregate in JS** — would over-fetch every `ad_clicks` row to the ops server. Rejected.
- **Separate stats endpoint** — an extra round-trip for no benefit; the table already fetches
  the banner list on load. Rejected.

## Design

### 1. Data layer — new migration

A read-only view keyed by banner id, zero-filled, pre-aggregated per source table so the join
never fans out:

```sql
-- supabase/migrations/<ts>_ad_banner_stats_view.sql
create or replace view ad_banner_stats as
select b.id as banner_id,
       coalesce(i.impressions, 0) as impressions,
       coalesce(c.clicks, 0)      as clicks
from ad_banners b
left join (
  select sponsor_id, sum(count) as impressions
  from ad_impressions group by sponsor_id
) i on i.sponsor_id = b.id::text
left join (
  select sponsor_id, count(*) as clicks
  from ad_clicks group by sponsor_id
) c on c.sponsor_id = b.id::text;
```

Read via the service client, consistent with the rest of the ops endpoint. `ad_impressions` /
`ad_clicks` have RLS enabled with no anon policies; the service role bypasses RLS, so the view
read succeeds server-side. (Set `security_invoker = true` is unnecessary here since access is
always via the service role; default view semantics are fine.)

Migration is applied via the pg driver + `DATABASE_URL` (per repo convention), **not**
`supabase db push`.

### 2. API — extend the existing ops list endpoint

`GET /api/internal/ad-banners` (`apps/ops/src/app/api/internal/ad-banners/route.ts`) currently
returns the banner rows. Extend it to fetch banners and `ad_banner_stats` in parallel
(`Promise.all`) and merge `impressions` + `clicks` onto each returned banner by id. Banners with
no stats row default to `0`/`0`.

`POST`, `PATCH`, `DELETE` are untouched. The response shape gains two numeric fields per banner:

```ts
{ ...banner, impressions: number, clicks: number }
```

CTR is **not** stored or returned — it is derived in the UI (clicks ÷ impressions).

### 3. Frontend — three columns in the banners DataTable

In `AdsTab.tsx`, add three compact, right-aligned columns before the **Actions** column:

| Column | Source | Format |
|---|---|---|
| Impressions | `banner.impressions` | thousands separators (`Intl.NumberFormat`) |
| Clicks | `banner.clicks` | thousands separators |
| CTR | `clicks / impressions` | percentage, 1 decimal; `—` when impressions = 0 |

Reuses the existing design-system DataTable — no new components. A small pure helper formats the
numbers and CTR.

### 4. Freshness & testing

- **Freshness:** numbers reflect the DB at page-load time. No client or CDN caching (single
  operator, low volume).
- **Testing:** unit-test the pure format/CTR helper (including the impressions = 0 → `—` case and
  rounding). Manually verify the three columns render against the seeded `AceProGrip` row.

## Files touched

- `supabase/migrations/<ts>_ad_banner_stats_view.sql` — new
- `apps/ops/src/app/api/internal/ad-banners/route.ts` — extend `GET` only
- `apps/ops/src/app/(app)/ads/_components/AdsTab.tsx` — add columns
- a small format helper + its unit test (location to be decided in the plan)

## Success criteria

- The ops Ads tab banners table shows Impressions, Clicks, and CTR per banner, all-time.
- Numbers match a direct SQL count against `ad_impressions` / `ad_clicks`.
- CTR shows `—` (not `NaN`/`Infinity`) for a banner with zero impressions.
- No change to public-app behavior or to banner CRUD.

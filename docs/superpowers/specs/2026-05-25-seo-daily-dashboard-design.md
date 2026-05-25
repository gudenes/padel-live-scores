# SEO Daily Dashboard — Design

**Date:** 2026-05-25
**Owner:** Gustavo
**Status:** Spec — pending review before implementation plan
**Repo path:** lives in `apps/ops/` (deployed at admin.padelnachos.com)

## Problem

Google Search Console for `padelnachos.com` shows ~362 web search clicks over the last ~7 weeks, peaking near 30/day in early May and dropping to 1–10/day since. 4,006 pages report "not indexed" against 10,593 indexed. The operator (Gustavo) wants a way to measure SEO trajectory *daily* — opening GSC manually is friction, and the questions Gustavo cares about (per-locale split, what to fix next on the sitemap) are not the questions GSC's default UI answers in one glance.

A specific symptom triggered this work: `/es/home` shows as "not indexed" in GSC despite the HTML head being correct (self-canonical, full hreflang block for all 5 locales, `<html lang="es">`). Diagnosis found the root cause: `/es/*`, `/pt/*`, `/it/*`, `/fr/*` URLs are absent from the static, tournament, match, and player sitemaps — only the daily and news sitemaps include locale variants. That fix is handled by a separate task (see "Companion work" below) and is **not** part of this spec; the dashboard is what tells us whether the fix worked.

## Goals

1. Single dashboard page that answers "did SEO get better today?" in one glance.
2. Per-locale slicing (en/es/pt/it/fr) so the impact of the sitemap fix is measurable.
3. Daily morning email digest so the operator doesn't have to open the dashboard to know whether to look.
4. Sitemap investigation surface that converts performance data into concrete improvement candidates.

## Non-goals

- No Bing Webmaster, no GA4, no Ahrefs/Semrush in MVP.
- No MCP server installation — the dashboard uses a direct GSC API client. (MCP can be added later for ad-hoc Claude Code queries; it's not coupled to this work.)
- No "fix it for me" buttons. The Opportunities view is diagnostic — every action is human-decided.
- No per-page-type slicing on the headline KPI (only per-locale).
- No threshold alerting beyond the daily digest.

## Companion work (out of scope, separate task)

A separate task already spawned: **"Add locale URLs + hreflang to all sitemaps."** Extends `src/lib/sitemap-xml.ts` `buildUrlSet()` to emit `<xhtml:link rel="alternate" hreflang="...">` children, then updates `sitemap-static.xml`, `sitemap-tournaments.xml`, `sitemap-matches.xml`, `sitemap-players.xml` to emit every URL × 5 locales. Not blocking this spec; the dashboard works regardless of whether that ships first. The dashboard exists in part *to measure* whether that fix moves the needle.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│              Google Search Console (data: day-3 to day-2)        │
└──────────────────────────────────┬──────────────────────────────┘
                                   │ Search Analytics API
                                   │ (service-account JWT auth)
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│   apps/ops cron endpoints (Vercel)                               │
│   - POST /api/internal/seo-snapshot   (09:00 UTC daily)          │
│   - POST /api/internal/sitemap-crawl  (09:15 UTC daily)          │
│   - POST /api/internal/seo-digest     (09:30 UTC daily)          │
└──────────────────────────────────┬──────────────────────────────┘
                                   │ UPSERT
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│   Supabase (shared with main app)                                │
│   - seo_snapshots          (day × locale × metrics)              │
│   - seo_top_queries        (day × top-20 queries)                │
│   - seo_top_pages          (day × top-200 pages)                 │
│   - sitemap_url_snapshot   (day × every sitemap URL)             │
│   - seo_digest_sends       (audit: which emails went out)        │
└──────────────────────────────────┬──────────────────────────────┘
                       ┌───────────┴────────────┐
                       ▼                        ▼
       ┌──────────────────────────┐   ┌──────────────────────────┐
       │ /system/seo               │   │ Resend morning digest    │
       │ /system/seo/opportunities │   │ (gustavo@padellabs.tech) │
       └──────────────────────────┘   └──────────────────────────┘
```

Two independent crons, each one job: ingest runs at 09:00, sitemap crawl at 09:15, digest reads whatever's latest at 09:30. Decoupling means a GSC hiccup doesn't double-send or delay the email — operator sees yesterday's number rather than nothing.

## Storage schema

Five tables in the shared Supabase project. Migration goes in `supabase/migrations/`. Total annual footprint < 80k rows; no retention needed.

```sql
-- One row per (day, locale). 'total' is a synthetic row for the headline KPI.
create table seo_snapshots (
  day          date    not null,
  locale       text    not null check (locale in ('total','en','es','pt','it','fr')),
  clicks       integer not null default 0,
  impressions  integer not null default 0,
  avg_position numeric(5,2),                  -- nullable: GSC may omit if no data
  ctr          numeric(6,4),                  -- clicks/impressions, stored for convenience
  fetched_at   timestamptz not null default now(),
  primary key (day, locale)
);
create index on seo_snapshots (locale, day desc);

-- Top 20 queries per day, ranked by clicks. Position lets us track WoW movement.
create table seo_top_queries (
  day         date    not null,
  query       text    not null,
  clicks      integer not null,
  impressions integer not null,
  position    numeric(5,2),
  rank        smallint not null,              -- 1..20 within the day
  primary key (day, query)
);
create index on seo_top_queries (day desc, rank);

-- Top 200 pages per day by impressions. Tagged with locale + page-type
-- on ingest so the UI can group without re-parsing URLs.
create table seo_top_pages (
  day         date    not null,
  url         text    not null,
  locale      text    not null,           -- en/es/pt/it/fr, parsed from URL
  page_type   text    not null,           -- home/matches/match/player/tournament/news/other
  clicks      integer not null,
  impressions integer not null,
  position    numeric(5,2),
  rank        smallint not null,          -- 1..200 within the day
  primary key (day, url)
);
create index on seo_top_pages (day desc, locale, impressions desc);

-- Daily snapshot of what URLs are in our sitemap index. Ground truth for
-- "is this URL submitted?" reconciliation.
create table sitemap_url_snapshot (
  day        date    not null,
  url        text    not null,
  locale     text    not null,
  page_type  text    not null,
  primary key (day, url)
);
create index on sitemap_url_snapshot (day desc, locale);

-- Audit log: did the digest go out, who got it, did Resend error.
create table seo_digest_sends (
  digest_date date    not null,
  recipient   text    not null,
  sent_at     timestamptz not null default now(),
  status      text    not null check (status in ('sent','failed','skipped_no_data')),
  error       text,
  primary key (digest_date, recipient)
);
```

Design decisions:

- **`day` is the GSC data date**, not the ingest date. The 09:00 UTC cron on May 27 pulls data dated May 24 — that row has `day = '2026-05-24'`. Makes "last 7 days" queries trivial.
- **`locale = 'total'` is a synthetic sixth row** holding unfiltered site-wide numbers. Keeps the headline a single indexed lookup.
- **Idempotent UPSERTs**: `INSERT ... ON CONFLICT (day, …) DO UPDATE`. Re-runs and manual backfills never duplicate.
- **No `indexed_count` column in MVP**: URL Inspection API is 2k/day rate-limited and not practical to sample meaningfully. Defer.
- **RLS**: server-only access via service-role key. No anon policies needed.

## Ingest job — `/api/internal/seo-snapshot`

```
File:    apps/ops/src/app/api/internal/seo-snapshot/route.ts
Trigger: Vercel cron, daily 09:00 UTC
Auth:    Bearer ${CRON_SECRET} (same pattern as existing apps/ops internal routes)
```

**Flow per run:**

1. Compute `targetDay = today − 3` (GSC settles by day-3; day-2 still shifts). Allow `?day=YYYY-MM-DD` query param for backfill (auth-gated).
2. **Pull 1 — page totals.** GSC Search Analytics query:
   ```
   { startDate: targetDay, endDate: targetDay,
     dimensions: ['page', 'date'],
     rowLimit: 25000 }
   ```
   For each row, parse `page` to extract locale (`/es/...` → es, `/pt/...` → pt, `/it/...` → it, `/fr/...` → fr, default → en). Aggregate client-side into 6 buckets (total + 5 locales). One HTTP call covers all locale slices.
3. **Pull 2 — top queries.** GSC query with `dimensions: ['query']`, `rowLimit: 20`. No locale split here.
4. **Pull 3 — top pages.** GSC query with `dimensions: ['page']`, `rowLimit: 200`. Used by the Opportunities view.
5. **UPSERT** into `seo_snapshots` (6 rows), `seo_top_queries` (≤ 20 rows), `seo_top_pages` (≤ 200 rows).
6. Return `{ ok: true, day, locales_written, queries_written, pages_written }`. Log to Sentry on non-2xx.

**Why pull page-level then bucket client-side, rather than 5 filtered API calls:** 1 request vs 6, simpler retry, accurate English count (English is unprefixed — awkward as a GSC filter). 25k row limit is comfortably above ~1k unique URLs/day.

**GSC client:** thin wrapper, no SDK. Service-account JWT auth via `google-auth-library`. Token cached in-memory per Lambda invocation.

**Locale parser (shared helper):** `parseLocaleFromUrl(url: string): { locale, page_type }`. Used by both `seo_top_pages` ingest and `sitemap_url_snapshot` ingest so classification stays consistent.

```typescript
// pseudo:
function parseLocaleFromUrl(url: string) {
  const path = new URL(url).pathname;
  const m = path.match(/^\/(es|pt|it|fr)(\/|$)/);
  const locale = m ? m[1] : 'en';
  const rest = m ? path.slice(m[0].length - 1) : path;
  // rest now starts with / and has no locale prefix
  let page_type = 'other';
  if (rest === '/' || rest === '/home') page_type = 'home';
  else if (/^\/matches(\/|$)/.test(rest)) page_type = 'matches';
  else if (/^\/match\//.test(rest)) page_type = 'match';
  else if (/^\/player\//.test(rest)) page_type = 'player';
  else if (/^\/tournaments\//.test(rest)) page_type = 'tournament';
  else if (/^\/news(\/|$)/.test(rest)) page_type = 'news';
  return { locale, page_type };
}
```

**Error handling:**

| Condition | Behavior |
|---|---|
| GSC 429 (rate limit) | Exponential backoff, max 3 retries |
| GSC 403 | Log error, fail loud — service account likely got removed |
| Network/timeout | Cron fires again tomorrow; next day's run can also backfill day-4 to self-heal |
| Day already ingested | UPSERT overwrites — fine |

## Sitemap crawl job — `/api/internal/sitemap-crawl`

```
File:    apps/ops/src/app/api/internal/sitemap-crawl/route.ts
Trigger: Vercel cron, daily 09:15 UTC
Auth:    Bearer ${CRON_SECRET}
```

Fetches `https://padelnachos.com/sitemap.xml`, recursively fetches each child sitemap, extracts every `<loc>`, tags with locale + page_type via the shared parser, UPSERTs into `sitemap_url_snapshot`. Expected ~10–50k URLs depending on tournament/match counts. Wraps in a single transaction so partial failures don't leave the snapshot in a half-written state.

## Dashboard UI — `/system/seo`

Server component, fetches last 90 days of `seo_snapshots` + yesterday's `seo_top_queries` via Supabase server client. No client-side state.

```
┌─ /system/seo ─────────────────────────────────────────────────┐
│  SEO Health · last ingest: 2026-05-25 09:02 UTC (Sun)         │
│                                                                │
│  ╔══════════════════════════════════════════════════════════╗ │
│  ║  CLICKS · last 7 days                                    ║ │
│  ║   1,247    ▲ 18.3%  vs prior 7d (1,054)                 ║ │
│  ║   ▁▂▂▃▅▆▆▅▇█▇▆▅▄▃▃▄▅▆▇▇▆▅▄▂▃▄▆▇▆▅▄▃▂▂▃▄▅▆▇█▆▅...        ║ │
│  ║   90 days                                                ║ │
│  ╚══════════════════════════════════════════════════════════╝ │
│                                                                │
│  BY LOCALE · last 7 days                                       │
│  Locale  Clicks  Prior 7d  Δ        Impress.  Pos.            │
│  en      892     720       +23.9%   41,203    18.4            │
│  es      201     215        −6.5%   12,847    22.1            │
│  pt      94      72        +30.6%    5,418    19.7            │
│  it      38      31        +22.6%    2,109    24.3            │
│  fr      22      16        +37.5%    1,287    26.8            │
│                                                                │
│  TOP QUERIES · yesterday                                       │
│  #   Query                    Clicks  Impr.   Pos.            │
│  1   padel nachos              47      312    1.4             │
│  2   premier padel live        31    1,892    8.2             │
│  3   resultados padel hoy      24    2,403   12.1             │
│  … (20 rows)                                                   │
└────────────────────────────────────────────────────────────────┘
```

**Components:**

- **Headline tile** — reads `locale='total'` rows for `[today−9 … today−3]` vs `[today−16 … today−10]`. Inline SVG sparkline (90 data points). No charting library.
- **Locale table** — 5 rows, same compute filtered by locale. Negative delta gets red `▼`, positive green `▲`. Avg position is the 7-day mean weighted by impressions.
- **Top queries** — direct render of yesterday's 20 rows.
- **No interactivity in MVP** — no filters, no date picker, no drilling. Add them if you find yourself wanting them.

**Empty / error states:**

| Condition | UI |
|---|---|
| No snapshots ever ingested | Banner with curl command to backfill |
| Last ingest > 36h old | Red banner "Ingest stale — check Vercel cron logs"; still renders stale data |
| Supabase error | Server-component throws; ops error boundary catches; "Failed to load SEO data — see Sentry" |

**Navigation:** new link under existing `/system/` sub-nav (siblings: `data-quality`, `padelgod-health`, `integration-health`, `architecture`, `shadow-mode`, **new: `seo`**).

## Opportunities view — `/system/seo/opportunities`

A separate sub-route (not a client-side tab), with a small navigation chip on the main `/system/seo` page linking to it ("Overview · Opportunities"). Joining GSC performance against the sitemap snapshot. Three panels, each with an "Action" line so the operator doesn't have to remember what to do with each list.

```
┌─ LOCALE COVERAGE GAPS · last 30 days ───────────────────────┐
│ English pages winning impressions while their localized      │
│ counterparts get ≤5% of that traffic.                        │
│                                                               │
│ EN URL                  Impr.  ES   PT   IT   FR             │
│ /tournaments/2026...    4,210   12    0    0    0  ▶         │
│ /player/agustin-tapia   2,891   84   31    0    0  ▶         │
│ /matches/2026-05-24     1,203    0    0    0    0  ▶         │
│ Action: confirm locale variants are in sitemap + check       │
│ hreflang in HTML head for each row.                          │
└───────────────────────────────────────────────────────────────┘

┌─ SITEMAP RECONCILIATION · last 30 days ─────────────────────┐
│ IN GSC, NOT IN SITEMAP                                       │
│ Pages getting impressions but missing from sitemap.xml.      │
│ Top 25 by impressions.                                       │
│ Action: add to sitemap (or noindex if intentional).          │
│                                                               │
│ IN SITEMAP, ZERO IMPRESSIONS (30d)                           │
│ URLs submitted but Google's never seen a query against.      │
│ Summary count by page type + CSV download.                   │
│ Action: triage long-tail; remove dead URLs from sitemap.     │
└───────────────────────────────────────────────────────────────┘

┌─ RANK IMPROVEMENT CANDIDATES · last 7 days ─────────────────┐
│ Pages ranking 11–30 with >100 impressions. Best ROI on       │
│ title/description rewrites since they're close to page 1.    │
│                                                               │
│ URL                        Impr.  Position  CTR              │
│ /player/coello-tapia       2,103   12.4     1.1%             │
│ /tournaments/p1-rome-2026  1,847   14.2     0.9%             │
│ … (top 20)                                                   │
│ Action: rewrite title + meta description, redeploy, watch    │
│ position over next 14 days.                                  │
└───────────────────────────────────────────────────────────────┘
```

**Query patterns:**

- **Locale gaps**: for each English URL in `seo_top_pages` (last 30d), check if the locale variants (`/es/<rest>`, `/pt/<rest>`, etc.) exist with ≤5% of the English impression count. Build the locale-variant URL by inserting the locale prefix; look up in the 30d window.
- **In GSC, not in sitemap**: pages in `seo_top_pages` (last 30d) whose `url` does NOT appear in `sitemap_url_snapshot` for the latest snapshot day. SQL pattern: `LEFT JOIN ... WHERE sitemap.url IS NULL`. Top 25 by impressions.
- **In sitemap, zero impressions**: URLs in latest `sitemap_url_snapshot` whose `url` does NOT appear in `seo_top_pages` over the last 30 days. Count by `page_type` for the summary; CSV download endpoint returns the full list (can be tens of thousands of rows).
- **Rank candidates**: `seo_top_pages` filtered by `position between 11 and 30 and impressions > 100`. Sorted by impressions descending.

## Email digest — `/api/internal/seo-digest`

```
File:    apps/ops/src/app/api/internal/seo-digest/route.ts
Trigger: Vercel cron, daily 09:30 UTC (30 min after ingest)
Auth:    Bearer ${CRON_SECRET}
Sender:  Resend
Recipient: gustavo@padellabs.tech (via SEO_DIGEST_RECIPIENTS env var)
```

**Subject line (dynamic):**

- Healthy: `SEO · clicks ↑18% · 1,247 last 7d`
- Decline: `SEO · clicks ↓12% · 891 last 7d`
- Stale: `SEO · ingest failed (no fresh data for Xh)`

The delta in the subject means the inbox itself is glanceable — don't need to open the email to know the headline.

**Body (HTML, ~600px wide, mobile-friendly):**

```
SEO daily · 2026-05-25

Clicks · last 7 days
     1,247          ▲ 18.3%
                    vs 1,054 prior 7d

By locale
─────────────────────────
en   892    +23.9%  (was 720)
es   201     −6.5%  (was 215)
pt    94    +30.6%  (was 72)
it    38    +22.6%  (was 31)
fr    22    +37.5%  (was 16)

Worth a look
─────────────────────────
• Spanish clicks are down 6.5% week-on-week
  while overall is up. Check /es/* coverage
  in the dashboard.
• 14 new locale-gap pages flagged today.

[ Open dashboard → ]

─── small print ────
Data through 2026-05-22 (GSC has 2–3d lag).
Snapshot taken 2026-05-25 09:02 UTC.
```

**"Worth a look" rules** — adaptive bullets, fire only when their condition is met:

| Condition | Bullet |
|---|---|
| Any locale moved >10% opposite to total | "X is down N% week-on-week while overall is up" |
| ≥5 new locale-gap pages vs yesterday | "N new locale-gap pages flagged today" |
| `sitemap_url_snapshot` size changed >20% in a day | "Sitemap shrank/grew by N URLs today — check the deploy" |
| No rules fire | "Nothing flagged today — all metrics within normal bands" |

**Templating:** plain HTML string in TypeScript (no React Email, no MJML). ~80 lines. Same pattern as the existing welcome email at `src/lib/email/welcome.ts`.

**Failure modes:**

| Condition | Behavior |
|---|---|
| Today's snapshot missing | Send degraded email with stale-data subject; **don't go silent** |
| Resend error | Log to Sentry, write `status='failed'` to `seo_digest_sends`, don't retry within tick |
| Already sent today (`status='sent'` row exists) | No-op; protects against double-send |

## Setup checklist (operator, one-time, ~30 min)

1. **Google Cloud Console**
   - Reuse or create GCP project
   - Enable "Google Search Console API"
   - Create service account; download JSON key
   - Note `client_email` (looks like `padel-seo@<project>.iam.gserviceaccount.com`)

2. **Google Search Console**
   - Confirmed property type: **URL prefix property** (`https://padelnachos.com/`)
   - Settings → Users and permissions → Add user → paste service account email as **Owner** (Restricted is not enough for Search Analytics API)
   - *Optional later:* also add a **domain property** (`padelnachos.com`, no protocol) for future-proof subdomain aggregation. Not blocking MVP.

3. **Vercel `padel-ops` project env vars**
   ```
   GSC_SERVICE_ACCOUNT_JSON   (paste full JSON, single line)
   GSC_SITE_URL               https://padelnachos.com/
   SEO_DIGEST_RECIPIENTS      gustavo@padellabs.tech
   RESEND_API_KEY             (already set, confirm)
   CRON_SECRET                (already set, confirm)
   ```

4. **Supabase migration** — single file under `supabase/migrations/` creating the five tables.

5. **`apps/ops/vercel.json`** — extend with three crons:
   ```json
   {
     "crons": [
       { "path": "/api/internal/seo-snapshot",  "schedule": "0 9 * * *"  },
       { "path": "/api/internal/sitemap-crawl", "schedule": "15 9 * * *" },
       { "path": "/api/internal/seo-digest",    "schedule": "30 9 * * *" }
     ]
   }
   ```

6. **Verify GSC access** — once env vars are set:
   ```bash
   # From a shell with the JSON key loaded:
   curl -H "Authorization: Bearer $TOKEN" \
     "https://searchconsole.googleapis.com/webmasters/v3/sites"
   ```
   The response should list `https://padelnachos.com/`. Empty response = re-grant as Owner.

## Rollout sequence

| Day | Work | Verify by |
|---|---|---|
| 1 | Migration + GSC client + `/api/internal/seo-snapshot` route | Manual curl returns `{ ok: true, locales_written: 6 }`; rows visible in `seo_snapshots` |
| 2 | Dashboard page (`/system/seo`) — headline, sparkline, locale table, top queries | Page renders real numbers (or empty-state if migration just landed) |
| 3 | `/api/internal/sitemap-crawl` + `seo_top_pages` + Opportunities tab | Opportunities tab populated with ≥1 row in each panel |
| 4 | Email digest endpoint + Resend template + `seo_digest_sends` audit | Manual trigger sends real email to gustavo@padellabs.tech |
| 4.5 | Enable Vercel crons; observe two full daily runs before walking away | `seo_digest_sends.status='sent'` rows for two consecutive days |

**Backfill (one-time after Day 1)** — populates the sparkline so first dashboard view isn't a single dot. GSC keeps ~16 months of history.

```bash
for d in $(seq 90 -1 3); do
  curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
    ".../api/internal/seo-snapshot?day=$(date -v-${d}d +%Y-%m-%d)"
  sleep 2
done
```

Takes ~3 minutes.

## Effort estimate

~4.5 days of implementation work.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Service account loses GSC access silently (someone removes it) | 403 from GSC → fail loud in cron, surfaces in Vercel cron failure email + Sentry |
| GSC API rate limits during backfill | 2-second sleep between backfill calls keeps us well under 1,200/min |
| Resend deliverability to Gmail/etc. | Existing welcome-email flow already lives at the same Resend account; same deliverability profile |
| Daily digest gets ignored after the novelty wears off | Subject-line headline + "Worth a look" bullets are designed for inbox-only consumption — opening rate doesn't matter if the subject conveys state |
| Opportunities lists are too noisy on day 1 (only 1 day of data) | Locale-gap and reconciliation panels require 30 days of history; show "gathering data — N/30 days collected" state until then |

## Open questions (none blocking)

None. All decisions resolved during brainstorming:
- GSC property type confirmed (URL prefix → `https://padelnachos.com/`)
- Recipient set (gustavo@padellabs.tech)
- Scope locked (Approach A + Opportunities; no MCP, no GA4, no Bing)

# SEO Daily Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a daily SEO health dashboard at admin.padelnachos.com/system/seo that pulls Google Search Console data into Supabase nightly, surfaces locale-sliced KPIs + sitemap-improvement opportunities, and emails a morning digest to gustavo@padellabs.tech via Resend.

**Architecture:** Three Vercel crons in `apps/ops` (09:00/09:15/09:30 UTC) write to 5 new tables in the shared Supabase Postgres. Server-component dashboard reads via existing `pgPool()`. GSC auth via OAuth 2.0 refresh token (sidesteps `iam.managed.disableServiceAccountKeyCreation` org policy).

**Tech Stack:** Next.js 16 (App Router) in `apps/ops`, Vitest, `pg` directly (not Supabase JS), `google-auth-library` for OAuth, `resend` (already a dep), plain HTML email template.

**Spec:** [`docs/superpowers/specs/2026-05-25-seo-daily-dashboard-design.md`](../specs/2026-05-25-seo-daily-dashboard-design.md). Read the spec first if you haven't — it explains *why* of every decision below.

---

## File map

```
supabase/migrations/
  20260526_seo_dashboard.sql              # NEW: 5 tables

apps/ops/
  package.json                            # MODIFY: add google-auth-library
  vercel.json                             # MODIFY: register 3 crons
  src/
    lib/
      seo/
        url-classifier.ts                 # NEW: parseLocaleFromUrl()
        gsc-client.ts                     # NEW: OAuth + Search Analytics wrapper
        seo-queries.ts                    # NEW: Supabase reads for dashboard
        seo-compute.ts                    # NEW: 7d delta / WoW math (pure)
        digest-rules.ts                   # NEW: "Worth a look" rule engine (pure)
        digest-template.ts                # NEW: HTML email body
        sitemap-parser.ts                 # NEW: parse sitemap XML
    app/
      api/
        internal/
          seo-snapshot/route.ts           # NEW: daily GSC ingest cron
          sitemap-crawl/route.ts          # NEW: daily sitemap snapshot cron
          seo-digest/route.ts             # NEW: daily Resend digest cron
      (app)/
        system/
          seo/
            page.tsx                      # NEW: overview dashboard
            opportunities/page.tsx        # NEW: opportunities sub-page
            _components/
              HeadlineTile.tsx            # NEW
              Sparkline.tsx               # NEW
              LocaleTable.tsx             # NEW
              TopQueriesTable.tsx         # NEW
              StaleBanner.tsx             # NEW
              LocaleGapsPanel.tsx         # NEW
              ReconciliationPanel.tsx     # NEW
              RankCandidatesPanel.tsx     # NEW
    components/Sidebar.tsx                # MODIFY: add /system/seo nav entry
  scripts/
    mint-gsc-refresh-token.ts             # NEW: one-time OAuth flow
  tests/
    seo-url-classifier.test.ts            # NEW
    seo-compute.test.ts                   # NEW
    seo-digest-rules.test.ts              # NEW
    seo-snapshot-route.test.ts            # NEW
    seo-sitemap-parser.test.ts            # NEW
    seo-digest-route.test.ts              # NEW
```

---

## Phase 1 — Foundation (schema + pure helpers)

### Task 1: Supabase migration — 5 tables

**Files:**
- Create: `supabase/migrations/20260526_seo_dashboard.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260526_seo_dashboard.sql
-- SEO daily dashboard tables. All server-only (no RLS policies for anon).
-- See docs/superpowers/specs/2026-05-25-seo-daily-dashboard-design.md.

create table public.seo_snapshots (
  day          date    not null,
  locale       text    not null check (locale in ('total','en','es','pt','it','fr')),
  clicks       integer not null default 0,
  impressions  integer not null default 0,
  avg_position numeric(5,2),
  ctr          numeric(6,4),
  fetched_at   timestamptz not null default now(),
  primary key (day, locale)
);
create index seo_snapshots_locale_day_idx
  on public.seo_snapshots (locale, day desc);

create table public.seo_top_queries (
  day         date    not null,
  query       text    not null,
  clicks      integer not null,
  impressions integer not null,
  position    numeric(5,2),
  rank        smallint not null,
  primary key (day, query)
);
create index seo_top_queries_day_rank_idx
  on public.seo_top_queries (day desc, rank);

create table public.seo_top_pages (
  day         date    not null,
  url         text    not null,
  locale      text    not null,
  page_type   text    not null,
  clicks      integer not null,
  impressions integer not null,
  position    numeric(5,2),
  rank        smallint not null,
  primary key (day, url)
);
create index seo_top_pages_day_locale_impr_idx
  on public.seo_top_pages (day desc, locale, impressions desc);

create table public.sitemap_url_snapshot (
  day        date    not null,
  url        text    not null,
  locale     text    not null,
  page_type  text    not null,
  primary key (day, url)
);
create index sitemap_url_snapshot_day_locale_idx
  on public.sitemap_url_snapshot (day desc, locale);

create table public.seo_digest_sends (
  digest_date date    not null,
  recipient   text    not null,
  sent_at     timestamptz not null default now(),
  status      text    not null check (status in ('sent','failed','skipped_no_data')),
  error       text,
  primary key (digest_date, recipient)
);

-- RLS: deny anon by default (service-role key bypasses). The dashboard
-- reads via pgPool which uses the DATABASE_URL connection that bypasses RLS.
alter table public.seo_snapshots         enable row level security;
alter table public.seo_top_queries       enable row level security;
alter table public.seo_top_pages         enable row level security;
alter table public.sitemap_url_snapshot  enable row level security;
alter table public.seo_digest_sends      enable row level security;
```

- [ ] **Step 2: Apply the migration locally**

If Supabase CLI is configured:
```bash
supabase db push
```
Otherwise paste the SQL into the Supabase SQL Editor in the dashboard.

Expected: 5 tables visible in the public schema, 4 indexes created, no errors.

- [ ] **Step 3: Verify schema**

```bash
psql "$DATABASE_URL" -c "\dt public.seo_*"
psql "$DATABASE_URL" -c "\dt public.sitemap_url_snapshot"
```
Expected: all 5 tables listed.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260526_seo_dashboard.sql
git commit -m "feat(seo): add daily dashboard schema (5 tables)"
```

---

### Task 2: `parseLocaleFromUrl` pure helper

**Files:**
- Create: `apps/ops/src/lib/seo/url-classifier.ts`
- Test: `apps/ops/tests/seo-url-classifier.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/ops/tests/seo-url-classifier.test.ts
import { describe, it, expect } from 'vitest'
import { parseLocaleFromUrl } from '../src/lib/seo/url-classifier'

describe('parseLocaleFromUrl', () => {
  it('classifies English root as home/en', () => {
    expect(parseLocaleFromUrl('https://padelnachos.com/')).toEqual({ locale: 'en', page_type: 'home' })
  })

  it('classifies /home as home/en', () => {
    expect(parseLocaleFromUrl('https://padelnachos.com/home')).toEqual({ locale: 'en', page_type: 'home' })
  })

  it('classifies /es/home as home/es', () => {
    expect(parseLocaleFromUrl('https://padelnachos.com/es/home')).toEqual({ locale: 'es', page_type: 'home' })
  })

  it('classifies /pt/matches/2026-05-24 as matches/pt', () => {
    expect(parseLocaleFromUrl('https://padelnachos.com/pt/matches/2026-05-24'))
      .toEqual({ locale: 'pt', page_type: 'matches' })
  })

  it('classifies /match/abc-123 as match/en', () => {
    expect(parseLocaleFromUrl('https://padelnachos.com/match/abc-123'))
      .toEqual({ locale: 'en', page_type: 'match' })
  })

  it('classifies /it/player/coello as player/it', () => {
    expect(parseLocaleFromUrl('https://padelnachos.com/it/player/coello'))
      .toEqual({ locale: 'it', page_type: 'player' })
  })

  it('classifies /tournaments/p1-rome-2026 as tournament/en', () => {
    expect(parseLocaleFromUrl('https://padelnachos.com/tournaments/p1-rome-2026'))
      .toEqual({ locale: 'en', page_type: 'tournament' })
  })

  it('classifies /fr/news/some-slug as news/fr', () => {
    expect(parseLocaleFromUrl('https://padelnachos.com/fr/news/some-slug'))
      .toEqual({ locale: 'fr', page_type: 'news' })
  })

  it('classifies unrecognised path as other/en', () => {
    expect(parseLocaleFromUrl('https://padelnachos.com/about'))
      .toEqual({ locale: 'en', page_type: 'other' })
  })

  it('strips query string before classifying', () => {
    expect(parseLocaleFromUrl('https://padelnachos.com/es/home?utm=x'))
      .toEqual({ locale: 'es', page_type: 'home' })
  })

  it('rejects "en" as a prefix (English is unprefixed)', () => {
    // /en/home should NOT exist on the site; if it appears, treat as other/en
    expect(parseLocaleFromUrl('https://padelnachos.com/en/home'))
      .toEqual({ locale: 'en', page_type: 'other' })
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd apps/ops && npx vitest run tests/seo-url-classifier.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// apps/ops/src/lib/seo/url-classifier.ts
// Shared helper: parse a padelnachos.com URL into locale + page_type.
// Used by GSC ingest (seo_top_pages) and sitemap crawl (sitemap_url_snapshot)
// so both classifications are byte-identical and joinable.

export type Locale = 'en' | 'es' | 'pt' | 'it' | 'fr'
export type PageType = 'home' | 'matches' | 'match' | 'player' | 'tournament' | 'news' | 'other'

export interface UrlClassification {
  locale: Locale
  page_type: PageType
}

const LOCALE_PREFIX_RE = /^\/(es|pt|it|fr)(\/|$)/

export function parseLocaleFromUrl(url: string): UrlClassification {
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    return { locale: 'en', page_type: 'other' }
  }

  const m = path.match(LOCALE_PREFIX_RE)
  const locale: Locale = m ? (m[1] as Locale) : 'en'
  // rest starts with /, no locale prefix
  const rest = m ? path.slice(m[0].length - 1) : path

  let page_type: PageType = 'other'
  if (rest === '/' || rest === '/home') page_type = 'home'
  else if (/^\/matches(\/|$)/.test(rest)) page_type = 'matches'
  else if (/^\/match\//.test(rest)) page_type = 'match'
  else if (/^\/player\//.test(rest)) page_type = 'player'
  else if (/^\/tournaments\//.test(rest)) page_type = 'tournament'
  else if (/^\/news(\/|$)/.test(rest)) page_type = 'news'

  return { locale, page_type }
}
```

- [ ] **Step 4: Run test to confirm pass**

```bash
cd apps/ops && npx vitest run tests/seo-url-classifier.test.ts
```
Expected: PASS — 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/lib/seo/url-classifier.ts apps/ops/tests/seo-url-classifier.test.ts
git commit -m "feat(seo): add URL classifier (locale + page_type)"
```

---

### Task 3: `seo-compute` — 7d delta math (pure)

**Files:**
- Create: `apps/ops/src/lib/seo/seo-compute.ts`
- Test: `apps/ops/tests/seo-compute.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/ops/tests/seo-compute.test.ts
import { describe, it, expect } from 'vitest'
import { sumWindow, windowDelta, weightedAvgPosition } from '../src/lib/seo/seo-compute'
import type { SnapshotRow } from '../src/lib/seo/seo-compute'

const rows = (...vals: Array<[string, number, number, number | null]>): SnapshotRow[] =>
  vals.map(([day, clicks, impressions, avg_position]) => ({
    day, locale: 'total', clicks, impressions, avg_position, ctr: null,
  }))

describe('sumWindow', () => {
  it('sums clicks and impressions across rows', () => {
    const r = rows(
      ['2026-05-20', 100, 1000, 10],
      ['2026-05-21', 150, 1500, 9],
    )
    expect(sumWindow(r)).toEqual({ clicks: 250, impressions: 2500 })
  })

  it('returns zeros for empty', () => {
    expect(sumWindow([])).toEqual({ clicks: 0, impressions: 0 })
  })
})

describe('windowDelta', () => {
  it('computes positive delta', () => {
    expect(windowDelta(120, 100)).toEqual({ deltaPct: 20, direction: 'up' })
  })

  it('computes negative delta', () => {
    expect(windowDelta(80, 100)).toEqual({ deltaPct: -20, direction: 'down' })
  })

  it('handles zero prior (treat as +∞ → cap at 999)', () => {
    expect(windowDelta(50, 0)).toEqual({ deltaPct: 999, direction: 'up' })
  })

  it('handles zero both ways', () => {
    expect(windowDelta(0, 0)).toEqual({ deltaPct: 0, direction: 'flat' })
  })

  it('marks ±2% as flat', () => {
    expect(windowDelta(101, 100)).toEqual({ deltaPct: 1, direction: 'flat' })
    expect(windowDelta(99, 100)).toEqual({ deltaPct: -1, direction: 'flat' })
  })
})

describe('weightedAvgPosition', () => {
  it('weights by impressions', () => {
    // 10 impr at pos 5 + 90 impr at pos 15 = avg ((10*5)+(90*15))/100 = 14
    const r = [
      { day: 'd1', locale: 'en', clicks: 1, impressions: 10, avg_position: 5,  ctr: null },
      { day: 'd2', locale: 'en', clicks: 1, impressions: 90, avg_position: 15, ctr: null },
    ]
    expect(weightedAvgPosition(r)).toBe(14)
  })

  it('returns null when no impressions', () => {
    expect(weightedAvgPosition([])).toBeNull()
  })

  it('skips rows with null position', () => {
    const r = [
      { day: 'd1', locale: 'en', clicks: 1, impressions: 100, avg_position: null, ctr: null },
      { day: 'd2', locale: 'en', clicks: 1, impressions: 50,  avg_position: 10,   ctr: null },
    ]
    expect(weightedAvgPosition(r)).toBe(10)
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd apps/ops && npx vitest run tests/seo-compute.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// apps/ops/src/lib/seo/seo-compute.ts
// Pure functions for KPI math. Kept separate from Supabase reads so the
// dashboard's headline tile + locale table + email digest can all
// share the same compute path.

export interface SnapshotRow {
  day: string
  locale: string
  clicks: number
  impressions: number
  avg_position: number | null
  ctr: number | null
}

export function sumWindow(rows: SnapshotRow[]): { clicks: number; impressions: number } {
  let clicks = 0
  let impressions = 0
  for (const r of rows) {
    clicks += r.clicks
    impressions += r.impressions
  }
  return { clicks, impressions }
}

export interface WindowDelta {
  deltaPct: number          // rounded to integer; positive = up
  direction: 'up' | 'down' | 'flat'
}

export function windowDelta(current: number, prior: number): WindowDelta {
  if (prior === 0 && current === 0) return { deltaPct: 0, direction: 'flat' }
  if (prior === 0) return { deltaPct: 999, direction: 'up' }
  const raw = ((current - prior) / prior) * 100
  const deltaPct = Math.round(raw)
  const direction: 'up' | 'down' | 'flat' =
    Math.abs(deltaPct) <= 2 ? 'flat' : deltaPct > 0 ? 'up' : 'down'
  return { deltaPct, direction }
}

export function weightedAvgPosition(rows: SnapshotRow[]): number | null {
  let weighted = 0
  let totalImpr = 0
  for (const r of rows) {
    if (r.avg_position == null) continue
    weighted += r.avg_position * r.impressions
    totalImpr += r.impressions
  }
  if (totalImpr === 0) return null
  return Math.round((weighted / totalImpr) * 100) / 100
}
```

- [ ] **Step 4: Run test to confirm pass**

```bash
cd apps/ops && npx vitest run tests/seo-compute.test.ts
```
Expected: PASS — 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/lib/seo/seo-compute.ts apps/ops/tests/seo-compute.test.ts
git commit -m "feat(seo): add KPI compute helpers (sum/delta/weighted-pos)"
```

---

### Task 4: GSC client (OAuth + Search Analytics wrapper)

**Files:**
- Modify: `apps/ops/package.json` — add `google-auth-library`
- Create: `apps/ops/src/lib/seo/gsc-client.ts`

This task has limited unit-test surface because the body is HTTP calls — we test it via the route integration tests (Task 7). The wrapper itself should be small enough to read at a glance.

- [ ] **Step 1: Install the SDK**

```bash
cd apps/ops && npm install google-auth-library
```

- [ ] **Step 2: Implement the client**

```typescript
// apps/ops/src/lib/seo/gsc-client.ts
// Thin wrapper around Google Search Console's Search Analytics API.
// Auth: OAuth 2.0 refresh-token flow via google-auth-library's
// UserRefreshClient. The refresh token is minted once via
// apps/ops/scripts/mint-gsc-refresh-token.ts and stored in Vercel env.
// We use OAuth (not service-account JSON) because the GCP org policy
// iam.managed.disableServiceAccountKeyCreation blocks key creation.

import { UserRefreshClient } from 'google-auth-library'

const SEARCH_ANALYTICS_URL = (siteUrl: string) =>
  `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`

const LIST_SITES_URL = 'https://searchconsole.googleapis.com/webmasters/v3/sites'

export interface GscQueryInput {
  startDate: string  // YYYY-MM-DD
  endDate: string    // YYYY-MM-DD
  dimensions: Array<'page' | 'query' | 'date' | 'country' | 'device'>
  rowLimit?: number
}

export interface GscRow {
  keys: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

interface GscClientConfig {
  clientId: string
  clientSecret: string
  refreshToken: string
  siteUrl: string
}

export class GscClient {
  private auth: UserRefreshClient
  private siteUrl: string

  constructor(cfg: GscClientConfig) {
    this.auth = new UserRefreshClient(cfg.clientId, cfg.clientSecret, cfg.refreshToken)
    this.siteUrl = cfg.siteUrl
  }

  static fromEnv(): GscClient {
    const clientId = process.env.GSC_OAUTH_CLIENT_ID
    const clientSecret = process.env.GSC_OAUTH_CLIENT_SECRET
    const refreshToken = process.env.GSC_OAUTH_REFRESH_TOKEN
    const siteUrl = process.env.GSC_SITE_URL
    if (!clientId || !clientSecret || !refreshToken || !siteUrl) {
      throw new Error('GSC env vars missing: need GSC_OAUTH_CLIENT_ID, GSC_OAUTH_CLIENT_SECRET, GSC_OAUTH_REFRESH_TOKEN, GSC_SITE_URL')
    }
    return new GscClient({ clientId, clientSecret, refreshToken, siteUrl })
  }

  async listSites(): Promise<{ siteUrl: string; permissionLevel: string }[]> {
    const { token } = await this.auth.getAccessToken()
    const res = await fetch(LIST_SITES_URL, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`GSC listSites failed: ${res.status} ${await res.text()}`)
    const data = await res.json() as { siteEntry?: { siteUrl: string; permissionLevel: string }[] }
    return data.siteEntry ?? []
  }

  async query(input: GscQueryInput): Promise<GscRow[]> {
    const { token } = await this.auth.getAccessToken()
    const res = await fetch(SEARCH_ANALYTICS_URL(this.siteUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`GSC query failed: ${res.status} ${body}`)
    }
    const data = await res.json() as { rows?: GscRow[] }
    return data.rows ?? []
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/ops/package.json apps/ops/package-lock.json apps/ops/src/lib/seo/gsc-client.ts
git commit -m "feat(seo): add GSC OAuth client wrapper"
```

---

### Task 5: One-time OAuth refresh-token mint script

**Files:**
- Create: `apps/ops/scripts/mint-gsc-refresh-token.ts`

This is operator tooling, run once locally — minimal testing. The script opens a loopback HTTP server, prompts the user to authenticate in a browser, captures the OAuth callback, and exchanges the code for a refresh token.

- [ ] **Step 1: Implement the script**

```typescript
// apps/ops/scripts/mint-gsc-refresh-token.ts
// One-time helper to mint a GSC OAuth refresh token.
// Run: npx tsx apps/ops/scripts/mint-gsc-refresh-token.ts
//
// Requires GSC_OAUTH_CLIENT_ID and GSC_OAUTH_CLIENT_SECRET in env or
// passed as CLI args. Opens the user's browser, captures the redirect
// callback on http://127.0.0.1:8765/, exchanges the auth code, prints
// the refresh token to stdout. Paste it into Vercel as
// GSC_OAUTH_REFRESH_TOKEN.

import http from 'node:http'
import { exec } from 'node:child_process'
import { OAuth2Client } from 'google-auth-library'

const PORT = 8765
const REDIRECT_URI = `http://127.0.0.1:${PORT}/`
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'

async function main() {
  const clientId = process.env.GSC_OAUTH_CLIENT_ID ?? process.argv[2]
  const clientSecret = process.env.GSC_OAUTH_CLIENT_SECRET ?? process.argv[3]
  if (!clientId || !clientSecret) {
    console.error('Usage: GSC_OAUTH_CLIENT_ID=... GSC_OAUTH_CLIENT_SECRET=... npx tsx apps/ops/scripts/mint-gsc-refresh-token.ts')
    console.error('Or pass them as CLI args: npx tsx ... <client_id> <client_secret>')
    process.exit(1)
  }

  const oauth = new OAuth2Client({ clientId, clientSecret, redirectUri: REDIRECT_URI })
  const authUrl = oauth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPE,
  })

  console.log('\nOpening browser to:\n  ' + authUrl + '\n')

  // Cross-platform "open URL in default browser"
  const openCmd = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32'  ? 'start' : 'xdg-open'
  exec(`${openCmd} "${authUrl}"`)

  const refreshToken = await new Promise<string>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url ?? '/', REDIRECT_URI)
      const code = u.searchParams.get('code')
      const error = u.searchParams.get('error')
      if (error) {
        res.writeHead(400, { 'content-type': 'text/plain' })
        res.end('OAuth error: ' + error)
        server.close()
        return reject(new Error(error))
      }
      if (!code) {
        res.writeHead(400, { 'content-type': 'text/plain' })
        res.end('Missing code parameter')
        return
      }
      try {
        const { tokens } = await oauth.getToken(code)
        if (!tokens.refresh_token) {
          throw new Error('No refresh_token in response. Did you grant `offline` access and is the OAuth app in Testing mode?')
        }
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<h1>Done</h1><p>Refresh token printed to terminal. You can close this tab.</p>')
        server.close()
        resolve(tokens.refresh_token)
      } catch (e) {
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end('Exchange failed: ' + String(e))
        server.close()
        reject(e)
      }
    })
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`Waiting for OAuth callback on ${REDIRECT_URI} …`)
    })
  })

  console.log('\n=== GSC_OAUTH_REFRESH_TOKEN ===')
  console.log(refreshToken)
  console.log('================================')
  console.log('\nPaste the value above into Vercel env vars for the padel-ops project.')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 2: Run a smoke test against your local env**

Make sure `GSC_OAUTH_CLIENT_ID` and `GSC_OAUTH_CLIENT_SECRET` are exported in your shell (from the OAuth client you created earlier), then:

```bash
cd /Users/GuDenes/Projects/padel-live-scores
npx tsx apps/ops/scripts/mint-gsc-refresh-token.ts
```

Expected: browser opens, you sign in as the Google account that owns the GSC property, accept the consent screen (`webmasters.readonly`), the script prints `GSC_OAUTH_REFRESH_TOKEN=…` to your terminal.

**Save that refresh token somewhere safe — it's a credential.** It doesn't expire as long as the OAuth app stays in "Testing" mode (don't publish it).

- [ ] **Step 3: Commit**

```bash
git add apps/ops/scripts/mint-gsc-refresh-token.ts
git commit -m "feat(seo): add one-time refresh-token mint script"
```

---

## Phase 2 — Ingest

### Task 6: `/api/internal/seo-snapshot` route + tests

**Files:**
- Create: `apps/ops/src/app/api/internal/seo-snapshot/route.ts`
- Test: `apps/ops/tests/seo-snapshot-route.test.ts`

This is the meat of ingest. The route does 3 GSC pulls, classifies pages, aggregates into 6 locale buckets, and UPSERTs three tables. Idempotent on `(day, ...)`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/ops/tests/seo-snapshot-route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { queryMock, gscQueryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  gscQueryMock: vi.fn(),
}))

vi.mock('../src/lib/db', () => ({
  pgPool: () => ({ query: queryMock }),
}))

vi.mock('../src/lib/seo/gsc-client', () => ({
  GscClient: {
    fromEnv: () => ({ query: gscQueryMock }),
  },
}))

import { POST } from '../src/app/api/internal/seo-snapshot/route'

function makeRequest(headers: Record<string, string> = { authorization: 'Bearer test-secret' }, search = '') {
  return new Request(`http://localhost/api/internal/seo-snapshot${search}`, {
    method: 'POST',
    headers,
  })
}

describe('POST /api/internal/seo-snapshot', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret'
    queryMock.mockReset()
    gscQueryMock.mockReset()
  })

  it('401 when missing bearer', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(401)
  })

  it('401 when wrong bearer', async () => {
    const res = await POST(makeRequest({ authorization: 'Bearer wrong' }))
    expect(res.status).toBe(401)
  })

  it('ingests 6 locale rows + top queries + top pages, returns counts', async () => {
    // Pull 1: page-level totals — 4 rows across 3 locales
    gscQueryMock.mockResolvedValueOnce([
      { keys: ['https://padelnachos.com/home',           '2026-05-22'], clicks: 100, impressions: 1000, ctr: 0.1, position: 5 },
      { keys: ['https://padelnachos.com/es/home',        '2026-05-22'], clicks: 50,  impressions: 500,  ctr: 0.1, position: 10 },
      { keys: ['https://padelnachos.com/pt/matches/2026','2026-05-22'], clicks: 20,  impressions: 200,  ctr: 0.1, position: 15 },
      { keys: ['https://padelnachos.com/match/abc',      '2026-05-22'], clicks: 5,   impressions: 50,   ctr: 0.1, position: 20 },
    ])
    // Pull 2: top queries — 2 rows
    gscQueryMock.mockResolvedValueOnce([
      { keys: ['padel nachos'],       clicks: 47, impressions: 312,  ctr: 0.15, position: 1.4 },
      { keys: ['premier padel live'], clicks: 31, impressions: 1892, ctr: 0.02, position: 8.2 },
    ])
    // Pull 3: top pages — 2 rows
    gscQueryMock.mockResolvedValueOnce([
      { keys: ['https://padelnachos.com/home'],     clicks: 100, impressions: 1000, ctr: 0.1, position: 5 },
      { keys: ['https://padelnachos.com/es/home'],  clicks: 50,  impressions: 500,  ctr: 0.1, position: 10 },
    ])
    queryMock.mockResolvedValue({ rows: [] })

    const res = await POST(makeRequest({ authorization: 'Bearer test-secret' }, '?day=2026-05-22'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      ok: true,
      day: '2026-05-22',
      locales_written: 6,
      queries_written: 2,
      pages_written: 2,
    })

    // Should have issued at least: 6 upserts to seo_snapshots, 2 to seo_top_queries, 2 to seo_top_pages.
    const upsertCalls = queryMock.mock.calls.map(c => c[0] as string)
    expect(upsertCalls.filter(s => s.includes('seo_snapshots')).length).toBeGreaterThanOrEqual(6)
    expect(upsertCalls.filter(s => s.includes('seo_top_queries')).length).toBeGreaterThanOrEqual(2)
    expect(upsertCalls.filter(s => s.includes('seo_top_pages')).length).toBeGreaterThanOrEqual(2)
  })

  it('supports probe=true to call listSites instead of ingest', async () => {
    const listMock = vi.fn().mockResolvedValue([
      { siteUrl: 'https://padelnachos.com/', permissionLevel: 'siteOwner' },
    ])
    const fromEnv = vi.fn(() => ({ listSites: listMock, query: gscQueryMock }))
    // Re-mock for this test
    vi.doMock('../src/lib/seo/gsc-client', () => ({ GscClient: { fromEnv } }))

    const res = await POST(makeRequest({ authorization: 'Bearer test-secret' }, '?probe=true'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.sites?.[0]?.siteUrl).toBe('https://padelnachos.com/')
  })

  it('defaults targetDay to today − 3 when no ?day is given', async () => {
    gscQueryMock.mockResolvedValue([])
    queryMock.mockResolvedValue({ rows: [] })

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    const expected = new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10)
    expect(body.day).toBe(expected)
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd apps/ops && npx vitest run tests/seo-snapshot-route.test.ts
```
Expected: FAIL — route not implemented.

- [ ] **Step 3: Implement the route**

```typescript
// apps/ops/src/app/api/internal/seo-snapshot/route.ts
// Daily GSC ingest. Vercel cron 09:00 UTC. Pulls data for today-3 (GSC
// settles by day-3), aggregates into 6 locale buckets, UPSERTs.
// See docs/superpowers/specs/2026-05-25-seo-daily-dashboard-design.md.

import { NextResponse } from 'next/server'
import { pgPool } from '@/lib/db'
import { GscClient } from '@/lib/seo/gsc-client'
import { parseLocaleFromUrl, type Locale } from '@/lib/seo/url-classifier'

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
}

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
  if (!process.env.CRON_SECRET || auth !== expected) return unauthorized()

  const url = new URL(req.url)
  const probe = url.searchParams.get('probe') === 'true'
  const targetDay = url.searchParams.get('day') ?? isoDaysAgo(3)

  let gsc
  try {
    gsc = GscClient.fromEnv()
  } catch (e) {
    return NextResponse.json({ error: 'gsc_config', message: String(e) }, { status: 500 })
  }

  if (probe) {
    try {
      const sites = await gsc.listSites()
      return NextResponse.json({ ok: true, sites })
    } catch (e) {
      return NextResponse.json({ error: 'gsc_probe_failed', message: String(e) }, { status: 502 })
    }
  }

  // Pull 1: page-level totals to derive locale buckets
  const pageTotals = await gsc.query({
    startDate: targetDay,
    endDate: targetDay,
    dimensions: ['page', 'date'],
    rowLimit: 25_000,
  })

  // Aggregate into 6 buckets: total + 5 locales
  const buckets = new Map<string, {
    clicks: number; impressions: number; posSum: number; posWeight: number
  }>()
  const initBucket = () => ({ clicks: 0, impressions: 0, posSum: 0, posWeight: 0 })
  for (const locale of ['total', 'en', 'es', 'pt', 'it', 'fr'] as const) {
    buckets.set(locale, initBucket())
  }

  for (const row of pageTotals) {
    const pageUrl = row.keys[0]
    const { locale } = parseLocaleFromUrl(pageUrl)
    const targets = [buckets.get(locale)!, buckets.get('total')!]
    for (const b of targets) {
      b.clicks += row.clicks
      b.impressions += row.impressions
      if (row.position && row.impressions) {
        b.posSum += row.position * row.impressions
        b.posWeight += row.impressions
      }
    }
  }

  // Pull 2: top queries
  const topQueries = await gsc.query({
    startDate: targetDay,
    endDate: targetDay,
    dimensions: ['query'],
    rowLimit: 20,
  })

  // Pull 3: top pages
  const topPages = await gsc.query({
    startDate: targetDay,
    endDate: targetDay,
    dimensions: ['page'],
    rowLimit: 200,
  })

  const pool = pgPool()

  // UPSERT seo_snapshots — one query per locale
  for (const [locale, b] of buckets.entries()) {
    const avg_position = b.posWeight > 0 ? Math.round((b.posSum / b.posWeight) * 100) / 100 : null
    const ctr = b.impressions > 0 ? Math.round((b.clicks / b.impressions) * 10000) / 10000 : null
    await pool.query(
      `insert into public.seo_snapshots (day, locale, clicks, impressions, avg_position, ctr, fetched_at)
       values ($1, $2, $3, $4, $5, $6, now())
       on conflict (day, locale) do update set
         clicks = excluded.clicks,
         impressions = excluded.impressions,
         avg_position = excluded.avg_position,
         ctr = excluded.ctr,
         fetched_at = excluded.fetched_at`,
      [targetDay, locale, b.clicks, b.impressions, avg_position, ctr],
    )
  }

  // UPSERT seo_top_queries
  for (let i = 0; i < topQueries.length; i++) {
    const q = topQueries[i]
    await pool.query(
      `insert into public.seo_top_queries (day, query, clicks, impressions, position, rank)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (day, query) do update set
         clicks = excluded.clicks,
         impressions = excluded.impressions,
         position = excluded.position,
         rank = excluded.rank`,
      [targetDay, q.keys[0], q.clicks, q.impressions, q.position ?? null, i + 1],
    )
  }

  // UPSERT seo_top_pages
  for (let i = 0; i < topPages.length; i++) {
    const p = topPages[i]
    const pageUrl = p.keys[0]
    const { locale, page_type } = parseLocaleFromUrl(pageUrl)
    await pool.query(
      `insert into public.seo_top_pages (day, url, locale, page_type, clicks, impressions, position, rank)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (day, url) do update set
         locale = excluded.locale,
         page_type = excluded.page_type,
         clicks = excluded.clicks,
         impressions = excluded.impressions,
         position = excluded.position,
         rank = excluded.rank`,
      [targetDay, pageUrl, locale, page_type, p.clicks, p.impressions, p.position ?? null, i + 1],
    )
  }

  return NextResponse.json({
    ok: true,
    day: targetDay,
    locales_written: buckets.size,
    queries_written: topQueries.length,
    pages_written: topPages.length,
  })
}
```

- [ ] **Step 4: Run test to confirm pass**

```bash
cd apps/ops && npx vitest run tests/seo-snapshot-route.test.ts
```
Expected: PASS — 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/app/api/internal/seo-snapshot/route.ts apps/ops/tests/seo-snapshot-route.test.ts
git commit -m "feat(seo): add daily GSC snapshot ingest cron"
```

---

### Task 7: Live verification of ingest

This task isn't writing code — it's verifying the ingest works end-to-end against real GSC data. Do this before moving to the UI so we have real data to render.

- [ ] **Step 1: Set local env vars**

Create `apps/ops/.env.local` (or add to it) with the OAuth + site values you gathered during brainstorming:

```
GSC_OAUTH_CLIENT_ID=<from OAuth client>
GSC_OAUTH_CLIENT_SECRET=<from OAuth client>
GSC_OAUTH_REFRESH_TOKEN=<from mint script>
GSC_SITE_URL=https://padelnachos.com/
CRON_SECRET=<existing value, must match what your dev server uses>
```

- [ ] **Step 2: Boot apps/ops dev server**

```bash
cd apps/ops && npm run dev
```
Expected: listening on port 3004.

- [ ] **Step 3: Probe**

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3004/api/internal/seo-snapshot?probe=true"
```
Expected JSON: `{ "ok": true, "sites": [{ "siteUrl": "https://padelnachos.com/", "permissionLevel": "siteOwner" }] }`.

If empty `sites`: OAuth scope is wrong or the test user wasn't added correctly. Re-run the mint script.

- [ ] **Step 4: Real ingest for one day**

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3004/api/internal/seo-snapshot?day=$(date -v-3d +%Y-%m-%d 2>/dev/null || date -d '3 days ago' +%Y-%m-%d)"
```
Expected JSON: `{ "ok": true, "day": "<3 days ago>", "locales_written": 6, "queries_written": <N>, "pages_written": <N> }` with non-zero N.

- [ ] **Step 5: Verify in Supabase**

```bash
psql "$DATABASE_URL" -c "select day, locale, clicks, impressions from public.seo_snapshots order by day desc, locale;"
```
Expected: 6 rows for the target day.

- [ ] **Step 6: Backfill 90 days**

```bash
for d in $(seq 90 -1 3); do
  iso=$(date -v-${d}d +%Y-%m-%d 2>/dev/null || date -d "${d} days ago" +%Y-%m-%d)
  curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
    "http://localhost:3004/api/internal/seo-snapshot?day=${iso}"
  echo ""
  sleep 2
done
```
Expected: ~88 successful UPSERTs (each prints a JSON line). Total time: ~4 minutes. After this, `seo_snapshots` has ~528 rows (88 days × 6 locales).

- [ ] **Step 7: No commit (no code changes in this task)**

---

## Phase 3 — Dashboard UI

### Task 8: `seo-queries` — Supabase reads for the dashboard

**Files:**
- Create: `apps/ops/src/lib/seo/seo-queries.ts`

No tests at this layer — these are thin SQL wrappers. We test them indirectly via the page integration tests.

- [ ] **Step 1: Implement**

```typescript
// apps/ops/src/lib/seo/seo-queries.ts
// Supabase reads for the SEO dashboard. Thin wrappers around pgPool.
// Pages compose these into the rendered output via Server Components.

import { pgPool } from '@/lib/db'
import type { SnapshotRow } from './seo-compute'

export async function getRecentSnapshots(daysBack: number): Promise<SnapshotRow[]> {
  const cutoff = new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10)
  const { rows } = await pgPool().query<SnapshotRow>(
    `select day::text as day, locale, clicks, impressions, avg_position, ctr
       from public.seo_snapshots
      where day >= $1
      order by day asc, locale asc`,
    [cutoff],
  )
  return rows
}

export async function getLatestIngestDay(): Promise<{ day: string; fetched_at: string } | null> {
  const { rows } = await pgPool().query<{ day: string; fetched_at: string }>(
    `select day::text as day, fetched_at::text as fetched_at
       from public.seo_snapshots
      where locale = 'total'
      order by day desc
      limit 1`,
  )
  return rows[0] ?? null
}

export interface TopQuery {
  rank: number
  query: string
  clicks: number
  impressions: number
  position: number | null
}

export async function getTopQueries(day: string, limit = 20): Promise<TopQuery[]> {
  const { rows } = await pgPool().query<TopQuery>(
    `select rank, query, clicks, impressions, position::float as position
       from public.seo_top_queries
      where day = $1
      order by rank
      limit $2`,
    [day, limit],
  )
  return rows
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/ops/src/lib/seo/seo-queries.ts
git commit -m "feat(seo): add dashboard query helpers"
```

---

### Task 9: Dashboard components

**Files:**
- Create: `apps/ops/src/app/(app)/system/seo/_components/HeadlineTile.tsx`
- Create: `apps/ops/src/app/(app)/system/seo/_components/Sparkline.tsx`
- Create: `apps/ops/src/app/(app)/system/seo/_components/LocaleTable.tsx`
- Create: `apps/ops/src/app/(app)/system/seo/_components/TopQueriesTable.tsx`
- Create: `apps/ops/src/app/(app)/system/seo/_components/StaleBanner.tsx`

All are presentational server components (or pure functions emitting JSX). No client state.

- [ ] **Step 1: Sparkline (inline SVG)**

```typescript
// apps/ops/src/app/(app)/system/seo/_components/Sparkline.tsx
interface Props {
  data: number[]
  width?: number
  height?: number
}

export function Sparkline({ data, width = 200, height = 40 }: Props) {
  if (data.length === 0) {
    return <svg width={width} height={height} aria-label="empty sparkline" />
  }
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const step = data.length > 1 ? width / (data.length - 1) : 0
  const points = data.map((v, i) => {
    const x = i * step
    const y = height - ((v - min) / range) * height
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg width={width} height={height} aria-label="clicks last 90 days">
      <polyline
        fill="none"
        stroke="var(--accent, #4ade80)"
        strokeWidth="1.5"
        points={points}
      />
    </svg>
  )
}
```

- [ ] **Step 2: HeadlineTile**

```typescript
// apps/ops/src/app/(app)/system/seo/_components/HeadlineTile.tsx
import { Sparkline } from './Sparkline'
import type { WindowDelta } from '@/lib/seo/seo-compute'

interface Props {
  currentClicks: number
  priorClicks: number
  delta: WindowDelta
  sparklineData: number[]
}

const arrow = (d: WindowDelta) =>
  d.direction === 'up' ? '▲' : d.direction === 'down' ? '▼' : '—'

const arrowColor = (d: WindowDelta) =>
  d.direction === 'up' ? '#4ade80' : d.direction === 'down' ? '#f87171' : '#9ca3af'

export function HeadlineTile({ currentClicks, priorClicks, delta, sparklineData }: Props) {
  return (
    <section style={{
      padding: '1.5rem',
      borderRadius: 12,
      background: 'var(--bg-elev-1, #1f2937)',
      marginBottom: '1.5rem',
    }}>
      <div style={{ fontSize: '0.85rem', textTransform: 'uppercase', opacity: 0.6, marginBottom: '0.5rem' }}>
        Clicks · last 7 days
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem' }}>
        <div style={{ fontSize: '2.5rem', fontWeight: 600 }}>{currentClicks.toLocaleString()}</div>
        <div style={{ color: arrowColor(delta), fontWeight: 500 }}>
          {arrow(delta)} {Math.abs(delta.deltaPct)}%
        </div>
        <div style={{ opacity: 0.6, fontSize: '0.85rem' }}>
          vs {priorClicks.toLocaleString()} prior 7d
        </div>
      </div>
      <div style={{ marginTop: '0.75rem' }}>
        <Sparkline data={sparklineData} />
        <div style={{ fontSize: '0.7rem', opacity: 0.5 }}>90 days</div>
      </div>
    </section>
  )
}
```

- [ ] **Step 3: LocaleTable**

```typescript
// apps/ops/src/app/(app)/system/seo/_components/LocaleTable.tsx
import type { WindowDelta } from '@/lib/seo/seo-compute'

export interface LocaleRow {
  locale: 'en' | 'es' | 'pt' | 'it' | 'fr'
  clicks: number
  priorClicks: number
  delta: WindowDelta
  impressions: number
  avgPosition: number | null
}

const arrow = (d: WindowDelta) =>
  d.direction === 'up' ? '▲' : d.direction === 'down' ? '▼' : '—'
const arrowColor = (d: WindowDelta) =>
  d.direction === 'up' ? '#4ade80' : d.direction === 'down' ? '#f87171' : '#9ca3af'

export function LocaleTable({ rows }: { rows: LocaleRow[] }) {
  return (
    <section style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ fontSize: '0.85rem', textTransform: 'uppercase', opacity: 0.6, marginBottom: '0.5rem' }}>
        By locale · last 7 days
      </h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', opacity: 0.6, fontSize: '0.8rem' }}>
            <th style={{ padding: '0.5rem' }}>Locale</th>
            <th style={{ padding: '0.5rem', textAlign: 'right' }}>Clicks</th>
            <th style={{ padding: '0.5rem', textAlign: 'right' }}>Prior 7d</th>
            <th style={{ padding: '0.5rem', textAlign: 'right' }}>Δ</th>
            <th style={{ padding: '0.5rem', textAlign: 'right' }}>Impressions</th>
            <th style={{ padding: '0.5rem', textAlign: 'right' }}>Position</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.locale} style={{ borderTop: '1px solid var(--border, #374151)' }}>
              <td style={{ padding: '0.5rem' }}>{r.locale}</td>
              <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.clicks.toLocaleString()}</td>
              <td style={{ padding: '0.5rem', textAlign: 'right', opacity: 0.6 }}>{r.priorClicks.toLocaleString()}</td>
              <td style={{ padding: '0.5rem', textAlign: 'right', color: arrowColor(r.delta) }}>
                {arrow(r.delta)} {Math.abs(r.delta.deltaPct)}%
              </td>
              <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.impressions.toLocaleString()}</td>
              <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                {r.avgPosition?.toFixed(1) ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
```

- [ ] **Step 4: TopQueriesTable**

```typescript
// apps/ops/src/app/(app)/system/seo/_components/TopQueriesTable.tsx
import type { TopQuery } from '@/lib/seo/seo-queries'

export function TopQueriesTable({ queries }: { queries: TopQuery[] }) {
  return (
    <section>
      <h3 style={{ fontSize: '0.85rem', textTransform: 'uppercase', opacity: 0.6, marginBottom: '0.5rem' }}>
        Top queries · yesterday
      </h3>
      {queries.length === 0 ? (
        <p style={{ opacity: 0.6 }}>No queries available for the latest snapshot.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', opacity: 0.6, fontSize: '0.8rem' }}>
              <th style={{ padding: '0.5rem' }}>#</th>
              <th style={{ padding: '0.5rem' }}>Query</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>Clicks</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>Impressions</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>Position</th>
            </tr>
          </thead>
          <tbody>
            {queries.map(q => (
              <tr key={q.query} style={{ borderTop: '1px solid var(--border, #374151)' }}>
                <td style={{ padding: '0.5rem', opacity: 0.5 }}>{q.rank}</td>
                <td style={{ padding: '0.5rem' }}>{q.query}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{q.clicks.toLocaleString()}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{q.impressions.toLocaleString()}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{q.position?.toFixed(1) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
```

- [ ] **Step 5: StaleBanner**

```typescript
// apps/ops/src/app/(app)/system/seo/_components/StaleBanner.tsx
interface Props {
  hoursSinceIngest: number | null
}

export function StaleBanner({ hoursSinceIngest }: Props) {
  if (hoursSinceIngest === null) {
    return (
      <div style={{
        padding: '0.75rem 1rem',
        background: '#1e3a8a',
        borderRadius: 6,
        marginBottom: '1rem',
      }}>
        <strong>No snapshots yet.</strong> Run the snapshot endpoint manually:
        <pre style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
{`curl -X POST -H "Authorization: Bearer $CRON_SECRET" \\
  https://admin.padelnachos.com/api/internal/seo-snapshot`}
        </pre>
      </div>
    )
  }
  if (hoursSinceIngest > 36) {
    return (
      <div style={{
        padding: '0.75rem 1rem',
        background: '#7f1d1d',
        borderRadius: 6,
        marginBottom: '1rem',
      }}>
        <strong>Ingest stale.</strong> Last successful run was {Math.round(hoursSinceIngest)}h ago. Check Vercel cron logs.
      </div>
    )
  }
  return null
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/ops/src/app/\(app\)/system/seo/_components/
git commit -m "feat(seo): add dashboard presentational components"
```

---

### Task 10: Dashboard page assembly

**Files:**
- Create: `apps/ops/src/app/(app)/system/seo/page.tsx`

Server component. Reads from Supabase, computes deltas, renders. Includes both empty and stale states.

- [ ] **Step 1: Implement the page**

```typescript
// apps/ops/src/app/(app)/system/seo/page.tsx
// SEO overview dashboard. Reads seo_snapshots (last 90d) + seo_top_queries
// (last day) and renders headline, sparkline, locale table, top queries.

import Link from 'next/link'
import { getRecentSnapshots, getLatestIngestDay, getTopQueries } from '@/lib/seo/seo-queries'
import { sumWindow, windowDelta, weightedAvgPosition } from '@/lib/seo/seo-compute'
import type { SnapshotRow } from '@/lib/seo/seo-compute'
import { HeadlineTile } from './_components/HeadlineTile'
import { LocaleTable, type LocaleRow } from './_components/LocaleTable'
import { TopQueriesTable } from './_components/TopQueriesTable'
import { StaleBanner } from './_components/StaleBanner'

export const dynamic = 'force-dynamic'  // always read fresh from Postgres
export const metadata = { title: 'SEO · PadelNachos Admin' }

const LOCALES = ['en', 'es', 'pt', 'it', 'fr'] as const

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
}

function inRange(row: SnapshotRow, from: string, to: string): boolean {
  return row.day >= from && row.day <= to
}

export default async function Page() {
  const [snapshots, latestIngest] = await Promise.all([
    getRecentSnapshots(120),
    getLatestIngestDay(),
  ])

  const hoursSinceIngest = latestIngest
    ? (Date.now() - new Date(latestIngest.fetched_at).getTime()) / 3_600_000
    : null

  const topQueries = latestIngest ? await getTopQueries(latestIngest.day) : []

  // Window definitions
  const fromCurrent = isoDaysAgo(9)
  const toCurrent   = isoDaysAgo(3)
  const fromPrior   = isoDaysAgo(16)
  const toPrior     = isoDaysAgo(10)

  // Totals row
  const totalRows = snapshots.filter(r => r.locale === 'total')
  const curTotal   = sumWindow(totalRows.filter(r => inRange(r, fromCurrent, toCurrent)))
  const priorTotal = sumWindow(totalRows.filter(r => inRange(r, fromPrior, toPrior)))
  const headlineDelta = windowDelta(curTotal.clicks, priorTotal.clicks)

  // Sparkline: last 90 days of total clicks
  const sparklineData = totalRows
    .slice(-90)
    .map(r => r.clicks)

  // Per-locale rows
  const localeRows: LocaleRow[] = LOCALES.map(locale => {
    const localeAll = snapshots.filter(r => r.locale === locale)
    const cur   = sumWindow(localeAll.filter(r => inRange(r, fromCurrent, toCurrent)))
    const prior = sumWindow(localeAll.filter(r => inRange(r, fromPrior, toPrior)))
    return {
      locale,
      clicks: cur.clicks,
      priorClicks: prior.clicks,
      delta: windowDelta(cur.clicks, prior.clicks),
      impressions: cur.impressions,
      avgPosition: weightedAvgPosition(localeAll.filter(r => inRange(r, fromCurrent, toCurrent))),
    }
  })

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1080 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem' }}>SEO Health</h1>
          <p style={{ margin: '0.25rem 0 0', opacity: 0.6, fontSize: '0.85rem' }}>
            {latestIngest
              ? `Last ingest: ${latestIngest.day} (data) · fetched ${new Date(latestIngest.fetched_at).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC`
              : 'No data yet'}
          </p>
        </div>
        <nav style={{ display: 'flex', gap: '1rem' }}>
          <span style={{ borderBottom: '2px solid var(--accent, #4ade80)', paddingBottom: '0.25rem' }}>Overview</span>
          <Link href="/system/seo/opportunities" style={{ opacity: 0.6 }}>Opportunities →</Link>
        </nav>
      </header>

      <StaleBanner hoursSinceIngest={hoursSinceIngest} />

      <HeadlineTile
        currentClicks={curTotal.clicks}
        priorClicks={priorTotal.clicks}
        delta={headlineDelta}
        sparklineData={sparklineData}
      />

      <LocaleTable rows={localeRows} />

      <TopQueriesTable queries={topQueries} />
    </div>
  )
}
```

- [ ] **Step 2: Add sidebar nav entry**

Open `apps/ops/src/components/Sidebar.tsx`, find the `system/` section (line ~47-51), add a new entry. Final block should look like:

```typescript
{ href: '/system/integration-health', label: 'Integration Health' },
{ href: '/system/data-quality', label: 'Data Quality' },
{ href: '/system/padelgod-health', label: 'Padelgod Health' },
{ href: '/system/shadow-mode', label: 'Shadow Mode' },
{ href: '/system/architecture', label: 'Architecture' },
{ href: '/system/seo', label: 'SEO' },
```

- [ ] **Step 3: Manually verify in browser**

```bash
cd apps/ops && npm run dev
```

Open http://localhost:3004/system/seo. Expected:
- Headline tile with real clicks number + delta arrow
- Sparkline showing 90-day trend
- Locale table with 5 rows
- Top queries table (or empty-state if no queries for latest day)

If anything errors, check Next dev console — most likely cause is a typo in a column name in seo-queries.ts.

- [ ] **Step 4: Commit**

```bash
git add apps/ops/src/app/\(app\)/system/seo/page.tsx apps/ops/src/components/Sidebar.tsx
git commit -m "feat(seo): add overview dashboard page + sidebar nav"
```

---

## Phase 4 — Sitemap crawl + Opportunities

### Task 11: Sitemap parser

**Files:**
- Create: `apps/ops/src/lib/seo/sitemap-parser.ts`
- Test: `apps/ops/tests/seo-sitemap-parser.test.ts`

Parses both sitemap index XML (list of child sitemaps) and urlset XML (list of `<loc>` URLs). Pure function over a string; the HTTP fetching happens in the route.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/ops/tests/seo-sitemap-parser.test.ts
import { describe, it, expect } from 'vitest'
import { parseSitemapXml } from '../src/lib/seo/sitemap-parser'

describe('parseSitemapXml', () => {
  it('parses a sitemap index', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://padelnachos.com/sitemap-static.xml</loc></sitemap>
  <sitemap><loc>https://padelnachos.com/sitemap-matches.xml</loc></sitemap>
</sitemapindex>`
    const r = parseSitemapXml(xml)
    expect(r.kind).toBe('index')
    expect(r.urls).toEqual([
      'https://padelnachos.com/sitemap-static.xml',
      'https://padelnachos.com/sitemap-matches.xml',
    ])
  })

  it('parses a urlset', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://padelnachos.com/home</loc></url>
  <url><loc>https://padelnachos.com/matches</loc></url>
  <url><loc>https://padelnachos.com/es/home</loc></url>
</urlset>`
    const r = parseSitemapXml(xml)
    expect(r.kind).toBe('urlset')
    expect(r.urls).toEqual([
      'https://padelnachos.com/home',
      'https://padelnachos.com/matches',
      'https://padelnachos.com/es/home',
    ])
  })

  it('handles XML-escaped ampersands in URLs', () => {
    const xml = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://padelnachos.com/q?a=1&amp;b=2</loc></url>
    </urlset>`
    const r = parseSitemapXml(xml)
    expect(r.urls).toEqual(['https://padelnachos.com/q?a=1&b=2'])
  })

  it('returns empty on garbage', () => {
    const r = parseSitemapXml('<html>not a sitemap</html>')
    expect(r.urls).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to confirm fail**

```bash
cd apps/ops && npx vitest run tests/seo-sitemap-parser.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// apps/ops/src/lib/seo/sitemap-parser.ts
// Pure XML parsing for sitemap.xml. Avoids the xml2js / fast-xml-parser
// dep — our schema is fixed and the regex approach is fine for it.

export interface ParsedSitemap {
  kind: 'index' | 'urlset' | 'unknown'
  urls: string[]
}

function unescape(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

export function parseSitemapXml(xml: string): ParsedSitemap {
  const isIndex = /<sitemapindex[\s>]/i.test(xml)
  const isUrlset = /<urlset[\s>]/i.test(xml)
  if (!isIndex && !isUrlset) return { kind: 'unknown', urls: [] }

  const urls: string[] = []
  const re = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    urls.push(unescape(m[1].trim()))
  }
  return { kind: isIndex ? 'index' : 'urlset', urls }
}
```

- [ ] **Step 4: Run test to confirm pass**

```bash
cd apps/ops && npx vitest run tests/seo-sitemap-parser.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/lib/seo/sitemap-parser.ts apps/ops/tests/seo-sitemap-parser.test.ts
git commit -m "feat(seo): add sitemap XML parser"
```

---

### Task 12: `/api/internal/sitemap-crawl` route

**Files:**
- Create: `apps/ops/src/app/api/internal/sitemap-crawl/route.ts`

Fetches sitemap.xml, expands children, writes one row per URL into `sitemap_url_snapshot`. Single transaction to avoid half-written snapshots.

- [ ] **Step 1: Implement**

```typescript
// apps/ops/src/app/api/internal/sitemap-crawl/route.ts
// Daily snapshot of every URL in the production sitemap.xml. Cron 09:15 UTC.
// Used as the ground truth for Opportunities reconciliation.

import { NextResponse } from 'next/server'
import { pgPool } from '@/lib/db'
import { parseSitemapXml } from '@/lib/seo/sitemap-parser'
import { parseLocaleFromUrl } from '@/lib/seo/url-classifier'

const ROOT_SITEMAP = 'https://padelnachos.com/sitemap.xml'
const MAX_URLS = 100_000  // safety cap

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
  if (!process.env.CRON_SECRET || auth !== expected) return unauthorized()

  const today = new Date().toISOString().slice(0, 10)
  const visited = new Set<string>()
  const allUrls: string[] = []

  async function fetchSitemap(url: string): Promise<void> {
    if (visited.has(url) || allUrls.length >= MAX_URLS) return
    visited.add(url)
    const res = await fetch(url, { headers: { 'user-agent': 'padel-ops sitemap-crawl/1' } })
    if (!res.ok) {
      console.error('[sitemap-crawl] fetch failed', url, res.status)
      return
    }
    const xml = await res.text()
    const parsed = parseSitemapXml(xml)
    if (parsed.kind === 'index') {
      for (const child of parsed.urls) await fetchSitemap(child)
    } else if (parsed.kind === 'urlset') {
      for (const u of parsed.urls) {
        if (allUrls.length >= MAX_URLS) break
        allUrls.push(u)
      }
    }
  }

  await fetchSitemap(ROOT_SITEMAP)

  const pool = pgPool()
  // Single transaction: nuke today's rows, insert fresh. Avoids half-state
  // if the crawl is interrupted.
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('delete from public.sitemap_url_snapshot where day = $1', [today])
    for (const u of allUrls) {
      const { locale, page_type } = parseLocaleFromUrl(u)
      await client.query(
        `insert into public.sitemap_url_snapshot (day, url, locale, page_type)
         values ($1, $2, $3, $4)
         on conflict (day, url) do nothing`,
        [today, u, locale, page_type],
      )
    }
    await client.query('commit')
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }

  return NextResponse.json({ ok: true, day: today, urls_written: allUrls.length })
}
```

- [ ] **Step 2: Manual smoke test**

With dev server running:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3004/api/internal/sitemap-crawl
```
Expected: `{ "ok": true, "day": "<today>", "urls_written": N }` with N in thousands.

```bash
psql "$DATABASE_URL" -c "select page_type, count(*) from public.sitemap_url_snapshot where day = current_date group by page_type;"
```
Expected: counts grouped by `tournament`, `match`, `player`, `home`, `news`, etc.

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/app/api/internal/sitemap-crawl/route.ts
git commit -m "feat(seo): add daily sitemap snapshot cron"
```

---

### Task 13: Opportunities queries

**Files:**
- Modify: `apps/ops/src/lib/seo/seo-queries.ts` — append three new functions

- [ ] **Step 1: Append the queries**

Add these exports to `apps/ops/src/lib/seo/seo-queries.ts`:

```typescript
// === Opportunities queries ===

export interface LocaleGapRow {
  en_url: string
  en_impressions: number
  es_impressions: number
  pt_impressions: number
  it_impressions: number
  fr_impressions: number
}

/**
 * English pages with ≥100 impressions in the last 30d whose locale variants
 * (built by inserting `/es/`, `/pt/`, `/it/`, `/fr/` after the host) have
 * ≤5% of the English impression count.
 */
export async function getLocaleGaps(limit = 25): Promise<LocaleGapRow[]> {
  const { rows } = await pgPool().query<LocaleGapRow>(
    `
    with last_30d as (
      select url, locale, sum(impressions)::int as impressions
        from public.seo_top_pages
       where day >= current_date - interval '30 days'
       group by url, locale
    ),
    english as (
      select url as en_url, impressions as en_impressions
        from last_30d
       where locale = 'en'
         and impressions >= 100
    )
    select
      e.en_url,
      e.en_impressions,
      coalesce(es.impressions, 0)::int as es_impressions,
      coalesce(pt.impressions, 0)::int as pt_impressions,
      coalesce(it.impressions, 0)::int as it_impressions,
      coalesce(fr.impressions, 0)::int as fr_impressions
    from english e
    left join last_30d es on es.url = regexp_replace(e.en_url, '^(https?://[^/]+)(/.*)?$', '\\1/es\\2') and es.locale = 'es'
    left join last_30d pt on pt.url = regexp_replace(e.en_url, '^(https?://[^/]+)(/.*)?$', '\\1/pt\\2') and pt.locale = 'pt'
    left join last_30d it on it.url = regexp_replace(e.en_url, '^(https?://[^/]+)(/.*)?$', '\\1/it\\2') and it.locale = 'it'
    left join last_30d fr on fr.url = regexp_replace(e.en_url, '^(https?://[^/]+)(/.*)?$', '\\1/fr\\2') and fr.locale = 'fr'
    where (coalesce(es.impressions,0) + coalesce(pt.impressions,0) + coalesce(it.impressions,0) + coalesce(fr.impressions,0))
          <= e.en_impressions * 0.05
    order by e.en_impressions desc
    limit $1
    `,
    [limit],
  )
  return rows
}

export interface InGscNotInSitemapRow {
  url: string
  impressions: number
  position: number | null
}

/** Pages with impressions in last 30d that are NOT in the latest sitemap snapshot. */
export async function getInGscNotInSitemap(limit = 25): Promise<InGscNotInSitemapRow[]> {
  const { rows } = await pgPool().query<InGscNotInSitemapRow>(
    `
    with gsc_30d as (
      select url, sum(impressions)::int as impressions,
             avg(position) as position
        from public.seo_top_pages
       where day >= current_date - interval '30 days'
       group by url
    ),
    latest_sitemap_day as (
      select max(day) as day from public.sitemap_url_snapshot
    )
    select g.url, g.impressions, g.position::float as position
      from gsc_30d g
     where not exists (
       select 1 from public.sitemap_url_snapshot s, latest_sitemap_day l
        where s.day = l.day and s.url = g.url
     )
     order by g.impressions desc
     limit $1
    `,
    [limit],
  )
  return rows
}

export interface InSitemapZeroImpressionsSummary {
  page_type: string
  url_count: number
}

/** URLs in the latest sitemap snapshot with zero impressions in last 30d, grouped by page_type. */
export async function getInSitemapZeroImpressions(): Promise<InSitemapZeroImpressionsSummary[]> {
  const { rows } = await pgPool().query<InSitemapZeroImpressionsSummary>(
    `
    with latest_sitemap_day as (
      select max(day) as day from public.sitemap_url_snapshot
    ),
    sitemap_latest as (
      select s.url, s.page_type
        from public.sitemap_url_snapshot s, latest_sitemap_day l
       where s.day = l.day
    ),
    gsc_30d as (
      select distinct url from public.seo_top_pages
       where day >= current_date - interval '30 days'
    )
    select sl.page_type, count(*)::int as url_count
      from sitemap_latest sl
     where not exists (select 1 from gsc_30d g where g.url = sl.url)
     group by sl.page_type
     order by url_count desc
    `,
  )
  return rows
}

export interface RankCandidateRow {
  url: string
  impressions: number
  position: number
  ctr: number | null
}

/** Pages ranking position 11–30 with > 100 impressions in last 7d. */
export async function getRankCandidates(limit = 20): Promise<RankCandidateRow[]> {
  const { rows } = await pgPool().query<RankCandidateRow>(
    `
    select url,
           sum(impressions)::int as impressions,
           (sum(impressions * position) / nullif(sum(impressions), 0))::float as position,
           (sum(clicks)::float / nullif(sum(impressions), 0))::float as ctr
      from public.seo_top_pages
     where day >= current_date - interval '7 days'
     group by url
    having sum(impressions) > 100
       and (sum(impressions * position) / nullif(sum(impressions), 0)) between 11 and 30
     order by impressions desc
     limit $1
    `,
    [limit],
  )
  return rows
}
```

- [ ] **Step 2: Smoke test the queries**

```bash
psql "$DATABASE_URL" <<SQL
-- Should return rows even if mostly empty until we have 30 days of data
with last_30d as (
  select url, locale, sum(impressions)::int as impressions
    from public.seo_top_pages
   where day >= current_date - interval '30 days'
   group by url, locale
)
select count(*) from last_30d;
SQL
```

If the query errors, fix the SQL inline before committing. (Most common: regex syntax mismatch between Postgres and the JS regex literal.)

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/lib/seo/seo-queries.ts
git commit -m "feat(seo): add opportunities queries (locale gaps, reconciliation, rank candidates)"
```

---

### Task 14: Opportunities components + page

**Files:**
- Create: `apps/ops/src/app/(app)/system/seo/_components/LocaleGapsPanel.tsx`
- Create: `apps/ops/src/app/(app)/system/seo/_components/ReconciliationPanel.tsx`
- Create: `apps/ops/src/app/(app)/system/seo/_components/RankCandidatesPanel.tsx`
- Create: `apps/ops/src/app/(app)/system/seo/opportunities/page.tsx`

- [ ] **Step 1: LocaleGapsPanel**

```typescript
// apps/ops/src/app/(app)/system/seo/_components/LocaleGapsPanel.tsx
import type { LocaleGapRow } from '@/lib/seo/seo-queries'

export function LocaleGapsPanel({ rows }: { rows: LocaleGapRow[] }) {
  return (
    <section style={{ padding: '1.25rem', borderRadius: 12, background: 'var(--bg-elev-1, #1f2937)', marginBottom: '1.5rem' }}>
      <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Locale coverage gaps · last 30 days</h3>
      <p style={{ opacity: 0.6, fontSize: '0.85rem', marginTop: 0 }}>
        English pages winning impressions while their localized counterparts get ≤5% of that traffic.
      </p>
      {rows.length === 0 ? (
        <p style={{ opacity: 0.6 }}>No gaps to flag — either no traffic yet, or all locales are tracking close to English.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', opacity: 0.6 }}>
              <th style={{ padding: '0.5rem' }}>EN URL</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>Impr.</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>ES</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>PT</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>IT</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>FR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.en_url} style={{ borderTop: '1px solid var(--border, #374151)' }}>
                <td style={{ padding: '0.5rem', wordBreak: 'break-all' }}>
                  <a href={r.en_url} target="_blank" rel="noopener" style={{ color: 'inherit' }}>{r.en_url}</a>
                </td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.en_impressions.toLocaleString()}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.es_impressions}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.pt_impressions}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.it_impressions}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.fr_impressions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p style={{ opacity: 0.6, fontSize: '0.8rem', marginTop: '0.75rem' }}>
        <strong>Action:</strong> confirm locale variants are in the sitemap and check hreflang block in HTML head for each row.
      </p>
    </section>
  )
}
```

- [ ] **Step 2: ReconciliationPanel**

```typescript
// apps/ops/src/app/(app)/system/seo/_components/ReconciliationPanel.tsx
import type { InGscNotInSitemapRow, InSitemapZeroImpressionsSummary } from '@/lib/seo/seo-queries'

interface Props {
  inGscNotInSitemap: InGscNotInSitemapRow[]
  inSitemapZero: InSitemapZeroImpressionsSummary[]
}

export function ReconciliationPanel({ inGscNotInSitemap, inSitemapZero }: Props) {
  return (
    <section style={{ padding: '1.25rem', borderRadius: 12, background: 'var(--bg-elev-1, #1f2937)', marginBottom: '1.5rem' }}>
      <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Sitemap reconciliation · last 30 days</h3>

      <div style={{ marginBottom: '1.5rem' }}>
        <h4 style={{ fontSize: '0.85rem', textTransform: 'uppercase', opacity: 0.7 }}>In GSC, not in sitemap</h4>
        <p style={{ opacity: 0.6, fontSize: '0.85rem', marginTop: 0 }}>
          Pages getting impressions but missing from sitemap.xml. Likely candidates to add.
        </p>
        {inGscNotInSitemap.length === 0 ? (
          <p style={{ opacity: 0.6 }}>None — every page with impressions is in the sitemap. ✓</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <tbody>
              {inGscNotInSitemap.map(r => (
                <tr key={r.url} style={{ borderTop: '1px solid var(--border, #374151)' }}>
                  <td style={{ padding: '0.5rem', wordBreak: 'break-all' }}>
                    <a href={r.url} target="_blank" rel="noopener" style={{ color: 'inherit' }}>{r.url}</a>
                  </td>
                  <td style={{ padding: '0.5rem', textAlign: 'right' }}>impr: {r.impressions}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right' }}>pos: {r.position?.toFixed(1) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ opacity: 0.6, fontSize: '0.8rem', marginTop: '0.5rem' }}>
          <strong>Action:</strong> add to sitemap (or noindex if intentional).
        </p>
      </div>

      <div>
        <h4 style={{ fontSize: '0.85rem', textTransform: 'uppercase', opacity: 0.7 }}>In sitemap, zero impressions (30d)</h4>
        <p style={{ opacity: 0.6, fontSize: '0.85rem', marginTop: 0 }}>
          URLs submitted but Google's never seen a query against. Count by page type:
        </p>
        {inSitemapZero.length === 0 ? (
          <p style={{ opacity: 0.6 }}>None — every sitemap URL has received at least one impression.</p>
        ) : (
          <ul style={{ marginTop: '0.5rem', paddingLeft: '1.25rem' }}>
            {inSitemapZero.map(r => (
              <li key={r.page_type} style={{ marginBottom: '0.25rem' }}>
                <code>{r.page_type}</code>: {r.url_count.toLocaleString()} URLs
              </li>
            ))}
          </ul>
        )}
        <p style={{ opacity: 0.6, fontSize: '0.8rem', marginTop: '0.5rem' }}>
          <strong>Action:</strong> triage long-tail; remove dead URLs from sitemap. Full CSV is one psql query away (see plan).
        </p>
      </div>
    </section>
  )
}
```

- [ ] **Step 3: RankCandidatesPanel**

```typescript
// apps/ops/src/app/(app)/system/seo/_components/RankCandidatesPanel.tsx
import type { RankCandidateRow } from '@/lib/seo/seo-queries'

export function RankCandidatesPanel({ rows }: { rows: RankCandidateRow[] }) {
  return (
    <section style={{ padding: '1.25rem', borderRadius: 12, background: 'var(--bg-elev-1, #1f2937)', marginBottom: '1.5rem' }}>
      <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Rank improvement candidates · last 7 days</h3>
      <p style={{ opacity: 0.6, fontSize: '0.85rem', marginTop: 0 }}>
        Pages ranking 11–30 with &gt; 100 impressions. Best ROI on title/description rewrites since they're close to page 1.
      </p>
      {rows.length === 0 ? (
        <p style={{ opacity: 0.6 }}>No candidates yet — either no traffic on page 2 pages, or no 7d data.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', opacity: 0.6 }}>
              <th style={{ padding: '0.5rem' }}>URL</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>Impr.</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>Position</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>CTR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.url} style={{ borderTop: '1px solid var(--border, #374151)' }}>
                <td style={{ padding: '0.5rem', wordBreak: 'break-all' }}>
                  <a href={r.url} target="_blank" rel="noopener" style={{ color: 'inherit' }}>{r.url}</a>
                </td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.impressions.toLocaleString()}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.position.toFixed(1)}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.ctr ? (r.ctr * 100).toFixed(1) + '%' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p style={{ opacity: 0.6, fontSize: '0.8rem', marginTop: '0.75rem' }}>
        <strong>Action:</strong> rewrite title + meta description, redeploy, watch position over 14 days.
      </p>
    </section>
  )
}
```

- [ ] **Step 4: Opportunities page**

```typescript
// apps/ops/src/app/(app)/system/seo/opportunities/page.tsx
import Link from 'next/link'
import {
  getLocaleGaps,
  getInGscNotInSitemap,
  getInSitemapZeroImpressions,
  getRankCandidates,
} from '@/lib/seo/seo-queries'
import { LocaleGapsPanel } from '../_components/LocaleGapsPanel'
import { ReconciliationPanel } from '../_components/ReconciliationPanel'
import { RankCandidatesPanel } from '../_components/RankCandidatesPanel'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'SEO Opportunities · PadelNachos Admin' }

export default async function Page() {
  const [gaps, inGscNotInSitemap, inSitemapZero, candidates] = await Promise.all([
    getLocaleGaps(25),
    getInGscNotInSitemap(25),
    getInSitemapZeroImpressions(),
    getRankCandidates(20),
  ])

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1080 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>SEO Opportunities</h1>
        <nav style={{ display: 'flex', gap: '1rem' }}>
          <Link href="/system/seo" style={{ opacity: 0.6 }}>← Overview</Link>
          <span style={{ borderBottom: '2px solid var(--accent, #4ade80)', paddingBottom: '0.25rem' }}>Opportunities</span>
        </nav>
      </header>

      <LocaleGapsPanel rows={gaps} />
      <ReconciliationPanel inGscNotInSitemap={inGscNotInSitemap} inSitemapZero={inSitemapZero} />
      <RankCandidatesPanel rows={candidates} />
    </div>
  )
}
```

- [ ] **Step 5: Browser verify**

Open http://localhost:3004/system/seo/opportunities. Expected: three panels rendered with whatever data exists. Likely sparse since we only have a few days of data — that's fine, the "gathering data" empty states will show.

- [ ] **Step 6: Commit**

```bash
git add apps/ops/src/app/\(app\)/system/seo/_components/LocaleGapsPanel.tsx apps/ops/src/app/\(app\)/system/seo/_components/ReconciliationPanel.tsx apps/ops/src/app/\(app\)/system/seo/_components/RankCandidatesPanel.tsx apps/ops/src/app/\(app\)/system/seo/opportunities/page.tsx
git commit -m "feat(seo): add opportunities page + 3 insight panels"
```

---

## Phase 5 — Email digest

### Task 15: "Worth a look" rule engine

**Files:**
- Create: `apps/ops/src/lib/seo/digest-rules.ts`
- Test: `apps/ops/tests/seo-digest-rules.test.ts`

Pure functions — given a small data envelope, return an ordered list of bullets.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/ops/tests/seo-digest-rules.test.ts
import { describe, it, expect } from 'vitest'
import { computeBullets, type DigestSignals } from '../src/lib/seo/digest-rules'

const base: DigestSignals = {
  totalDirection: 'up',
  localeDeltas: { en: 20, es: 15, pt: 25, it: 10, fr: 5 },
  newLocaleGapCount: 0,
  sitemapSizeDeltaPct: 0,
}

describe('computeBullets', () => {
  it('returns the "all good" bullet when nothing fires', () => {
    expect(computeBullets(base)).toEqual([
      'Nothing flagged today — all metrics within normal bands.',
    ])
  })

  it('flags a locale moving opposite to total', () => {
    const r = computeBullets({ ...base, localeDeltas: { ...base.localeDeltas, es: -15 } })
    expect(r).toContainEqual(expect.stringContaining('es'))
    expect(r).toContainEqual(expect.stringContaining('down'))
  })

  it('flags ≥5 new locale-gap pages', () => {
    const r = computeBullets({ ...base, newLocaleGapCount: 14 })
    expect(r).toContainEqual(expect.stringContaining('14 new locale-gap pages'))
  })

  it('flags sitemap size shift >20%', () => {
    const r = computeBullets({ ...base, sitemapSizeDeltaPct: 35 })
    expect(r).toContainEqual(expect.stringContaining('Sitemap grew by 35%'))
  })

  it('flags sitemap shrink >20%', () => {
    const r = computeBullets({ ...base, sitemapSizeDeltaPct: -28 })
    expect(r).toContainEqual(expect.stringContaining('Sitemap shrank by 28%'))
  })

  it('multiple rules fire together (no "all good" bullet)', () => {
    const r = computeBullets({
      ...base,
      localeDeltas: { ...base.localeDeltas, es: -15 },
      newLocaleGapCount: 7,
    })
    expect(r.length).toBe(2)
    expect(r.some(x => x.includes('Nothing flagged'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to confirm fail**

```bash
cd apps/ops && npx vitest run tests/seo-digest-rules.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// apps/ops/src/lib/seo/digest-rules.ts
// Pure rule engine for the "Worth a look" bullets in the daily digest.
// Each rule returns either a string (fires) or null (no bullet today).

export interface DigestSignals {
  totalDirection: 'up' | 'down' | 'flat'
  localeDeltas: Record<'en' | 'es' | 'pt' | 'it' | 'fr', number>
  newLocaleGapCount: number      // # of new locale-gap rows vs yesterday
  sitemapSizeDeltaPct: number    // signed pct change in sitemap URL count
}

type Rule = (s: DigestSignals) => string | null

const ruleLocaleOpposite: Rule = (s) => {
  if (s.totalDirection === 'flat') return null
  const opposites: string[] = []
  for (const [locale, delta] of Object.entries(s.localeDeltas)) {
    const dir = delta > 2 ? 'up' : delta < -2 ? 'down' : 'flat'
    if (
      (s.totalDirection === 'up'   && dir === 'down') ||
      (s.totalDirection === 'down' && dir === 'up')
    ) {
      opposites.push(`${locale} is ${dir} ${Math.abs(delta)}% week-on-week while overall is ${s.totalDirection}`)
    }
  }
  return opposites.length > 0 ? opposites.join('; ') : null
}

const ruleNewLocaleGaps: Rule = (s) =>
  s.newLocaleGapCount >= 5
    ? `${s.newLocaleGapCount} new locale-gap pages flagged today`
    : null

const ruleSitemapShift: Rule = (s) => {
  if (Math.abs(s.sitemapSizeDeltaPct) <= 20) return null
  const verb = s.sitemapSizeDeltaPct > 0 ? 'grew' : 'shrank'
  return `Sitemap ${verb} by ${Math.abs(s.sitemapSizeDeltaPct)}% today — check the deploy`
}

const ALL_RULES: Rule[] = [ruleLocaleOpposite, ruleNewLocaleGaps, ruleSitemapShift]

export function computeBullets(s: DigestSignals): string[] {
  const fired = ALL_RULES.map(r => r(s)).filter((x): x is string => !!x)
  if (fired.length === 0) return ['Nothing flagged today — all metrics within normal bands.']
  return fired
}
```

- [ ] **Step 4: Run test to confirm pass**

```bash
cd apps/ops && npx vitest run tests/seo-digest-rules.test.ts
```
Expected: PASS — 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/lib/seo/digest-rules.ts apps/ops/tests/seo-digest-rules.test.ts
git commit -m "feat(seo): add digest 'Worth a look' rule engine"
```

---

### Task 16: Digest HTML template

**Files:**
- Create: `apps/ops/src/lib/seo/digest-template.ts`

Plain HTML string. No React Email, no MJML. Same pattern as the existing welcome email.

- [ ] **Step 1: Implement**

```typescript
// apps/ops/src/lib/seo/digest-template.ts
// Plain HTML morning digest. ~80 lines. Sent via Resend.

import type { WindowDelta } from './seo-compute'

export interface DigestData {
  digestDate: string                         // e.g. '2026-05-25'
  dataThroughDay: string                     // e.g. '2026-05-22'
  snapshotFetchedAt: string                  // ISO timestamp
  currentClicks: number
  priorClicks: number
  delta: WindowDelta
  localeRows: Array<{
    locale: string
    clicks: number
    priorClicks: number
    deltaPct: number
    direction: 'up' | 'down' | 'flat'
  }>
  bullets: string[]
  dashboardUrl: string
}

const arrow = (d: 'up' | 'down' | 'flat') => d === 'up' ? '▲' : d === 'down' ? '▼' : '—'
const sign = (n: number) => (n > 0 ? '+' : '') + n + '%'

export function buildDigestSubject(d: DigestData, ingestStale: boolean): string {
  if (ingestStale) return `SEO · ingest failed (no fresh data for ${d.digestDate})`
  return `SEO · clicks ${arrow(d.delta.direction)}${Math.abs(d.delta.deltaPct)}% · ${d.currentClicks.toLocaleString()} last 7d`
}

export function buildDigestHtml(d: DigestData): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;color:#111;">
  <div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;padding:24px;">
    <div style="font-size:14px;opacity:0.6;margin-bottom:8px;">SEO daily · ${d.digestDate}</div>
    <div style="font-size:13px;text-transform:uppercase;opacity:0.5;letter-spacing:0.5px;">Clicks · last 7 days</div>

    <div style="margin:16px 0;">
      <span style="font-size:32px;font-weight:600;">${d.currentClicks.toLocaleString()}</span>
      <span style="font-size:16px;margin-left:12px;color:${d.delta.direction === 'up' ? '#16a34a' : d.delta.direction === 'down' ? '#dc2626' : '#6b7280'};">
        ${arrow(d.delta.direction)} ${Math.abs(d.delta.deltaPct)}%
      </span>
      <div style="font-size:14px;opacity:0.6;margin-top:4px;">vs ${d.priorClicks.toLocaleString()} prior 7d</div>
    </div>

    <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0;">

    <div style="font-size:13px;text-transform:uppercase;opacity:0.5;letter-spacing:0.5px;margin-bottom:8px;">By locale</div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      ${d.localeRows.map(r => `
        <tr style="border-top:1px solid #f0f0f0;">
          <td style="padding:8px 0;width:60px;">${r.locale}</td>
          <td style="padding:8px 0;text-align:right;">${r.clicks.toLocaleString()}</td>
          <td style="padding:8px 0;text-align:right;color:${r.direction === 'up' ? '#16a34a' : r.direction === 'down' ? '#dc2626' : '#6b7280'};width:80px;">
            ${sign(r.deltaPct)}
          </td>
          <td style="padding:8px 0;text-align:right;opacity:0.5;font-size:12px;width:90px;">(was ${r.priorClicks.toLocaleString()})</td>
        </tr>
      `).join('')}
    </table>

    <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0;">

    <div style="font-size:13px;text-transform:uppercase;opacity:0.5;letter-spacing:0.5px;margin-bottom:8px;">Worth a look</div>
    <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.6;">
      ${d.bullets.map(b => `<li>${b}</li>`).join('')}
    </ul>

    <div style="margin-top:32px;">
      <a href="${d.dashboardUrl}" style="display:inline-block;padding:10px 16px;background:#111;color:white;border-radius:6px;text-decoration:none;font-size:14px;">
        Open dashboard →
      </a>
    </div>

    <hr style="border:none;border-top:1px solid #e5e5e5;margin:32px 0 16px;">
    <div style="font-size:11px;opacity:0.5;line-height:1.5;">
      Data through ${d.dataThroughDay} (GSC has 2-3d lag).<br>
      Snapshot taken ${d.snapshotFetchedAt} UTC.
    </div>
  </div>
</body></html>`
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/ops/src/lib/seo/digest-template.ts
git commit -m "feat(seo): add digest HTML template + subject builder"
```

---

### Task 17: `/api/internal/seo-digest` route

**Files:**
- Create: `apps/ops/src/app/api/internal/seo-digest/route.ts`
- Test: `apps/ops/tests/seo-digest-route.test.ts`

Reads latest snapshot from Supabase, composes the email, sends via Resend, audits to `seo_digest_sends`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/ops/tests/seo-digest-route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { queryMock, sendMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  sendMock: vi.fn(),
}))

vi.mock('../src/lib/db', () => ({
  pgPool: () => ({ query: queryMock }),
}))

vi.mock('resend', () => ({
  Resend: class { emails = { send: sendMock } },
}))

import { POST } from '../src/app/api/internal/seo-digest/route'

const makeReq = (auth = 'Bearer test-secret') =>
  new Request('http://localhost/api/internal/seo-digest', {
    method: 'POST',
    headers: { authorization: auth },
  })

describe('POST /api/internal/seo-digest', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret'
    process.env.RESEND_API_KEY = 'test-key'
    process.env.SEO_DIGEST_RECIPIENTS = 'gustavo@padellabs.tech'
    queryMock.mockReset()
    sendMock.mockReset()
  })

  it('401 on wrong bearer', async () => {
    const res = await POST(makeReq('Bearer wrong'))
    expect(res.status).toBe(401)
  })

  it('skips if today already sent', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ status: 'sent' }] })  // existing send check
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.skipped).toBe('already_sent')
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('sends digest and records audit row', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })  // existing send check
      .mockResolvedValueOnce({ rows: [{ day: '2026-05-22', fetched_at: new Date().toISOString() }] })  // latest ingest
      .mockResolvedValueOnce({ rows: [
        // 7d window — 6 locales
        { day: '2026-05-22', locale: 'total', clicks: 1000, impressions: 50000, avg_position: 12, ctr: 0.02 },
        { day: '2026-05-22', locale: 'en',    clicks: 700,  impressions: 35000, avg_position: 10, ctr: 0.02 },
        { day: '2026-05-22', locale: 'es',    clicks: 200,  impressions: 10000, avg_position: 15, ctr: 0.02 },
        { day: '2026-05-22', locale: 'pt',    clicks: 60,   impressions: 3000,  avg_position: 18, ctr: 0.02 },
        { day: '2026-05-22', locale: 'it',    clicks: 30,   impressions: 1500,  avg_position: 20, ctr: 0.02 },
        { day: '2026-05-22', locale: 'fr',    clicks: 10,   impressions: 500,   avg_position: 25, ctr: 0.02 },
      ]})
      .mockResolvedValueOnce({ rows: [] })  // sitemap delta query
      .mockResolvedValueOnce({ rows: [] })  // getLocaleGaps inner query
      .mockResolvedValueOnce({ rows: [] })  // insert audit row

    sendMock.mockResolvedValue({ id: 'resend-id' })

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0][0]).toMatchObject({
      to: ['gustavo@padellabs.tech'],
    })
  })
})
```

- [ ] **Step 2: Run test to confirm fail**

```bash
cd apps/ops && npx vitest run tests/seo-digest-route.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// apps/ops/src/app/api/internal/seo-digest/route.ts
// Daily morning digest email. Cron 09:30 UTC (30 min after snapshot).

import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { pgPool } from '@/lib/db'
import { sumWindow, windowDelta } from '@/lib/seo/seo-compute'
import { computeBullets, type DigestSignals } from '@/lib/seo/digest-rules'
import { buildDigestHtml, buildDigestSubject, type DigestData } from '@/lib/seo/digest-template'

const DASHBOARD_URL = 'https://admin.padelnachos.com/system/seo'
const STALE_HOURS = 36

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
}

export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
  if (!process.env.CRON_SECRET || auth !== expected) return unauthorized()

  const recipients = (process.env.SEO_DIGEST_RECIPIENTS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (recipients.length === 0) {
    return NextResponse.json({ error: 'no_recipients' }, { status: 500 })
  }

  const today = new Date().toISOString().slice(0, 10)
  const pool = pgPool()

  // Idempotency: did we already send today?
  const existing = await pool.query<{ status: string }>(
    `select status from public.seo_digest_sends where digest_date = $1 and status = 'sent' limit 1`,
    [today],
  )
  if (existing.rows.length > 0) {
    return NextResponse.json({ ok: true, skipped: 'already_sent' })
  }

  // Latest ingest
  const latest = await pool.query<{ day: string; fetched_at: string }>(
    `select day::text as day, fetched_at::text as fetched_at
       from public.seo_snapshots where locale = 'total'
       order by day desc limit 1`,
  )
  const ingestStale =
    latest.rows.length === 0 ||
    (Date.now() - new Date(latest.rows[0].fetched_at).getTime()) / 3_600_000 > STALE_HOURS

  // 7d window snapshots
  const fromCurrent = isoDaysAgo(9)
  const toCurrent = isoDaysAgo(3)
  const fromPrior = isoDaysAgo(16)
  const toPrior = isoDaysAgo(10)
  const snaps = await pool.query<{ day: string; locale: string; clicks: number; impressions: number; avg_position: number | null; ctr: number | null }>(
    `select day::text as day, locale, clicks, impressions, avg_position, ctr
       from public.seo_snapshots
      where day >= $1
      order by day asc`,
    [fromPrior],
  )

  const inRange = (r: { day: string }, from: string, to: string) => r.day >= from && r.day <= to

  const total = snaps.rows.filter(r => r.locale === 'total')
  const curT = sumWindow(total.filter(r => inRange(r, fromCurrent, toCurrent)))
  const priorT = sumWindow(total.filter(r => inRange(r, fromPrior, toPrior)))
  const deltaT = windowDelta(curT.clicks, priorT.clicks)

  const localeRows = (['en', 'es', 'pt', 'it', 'fr'] as const).map(locale => {
    const localeAll = snaps.rows.filter(r => r.locale === locale)
    const cur = sumWindow(localeAll.filter(r => inRange(r, fromCurrent, toCurrent)))
    const prior = sumWindow(localeAll.filter(r => inRange(r, fromPrior, toPrior)))
    const d = windowDelta(cur.clicks, prior.clicks)
    return { locale, clicks: cur.clicks, priorClicks: prior.clicks, deltaPct: d.deltaPct, direction: d.direction }
  })

  // Signal: sitemap size delta (today vs yesterday)
  const sitemapDelta = await pool.query<{ delta_pct: number | null }>(
    `with d as (
       select day, count(*)::int as n from public.sitemap_url_snapshot
        where day >= current_date - interval '1 day'
        group by day
     )
     select case when (select n from d where day = current_date - interval '1 day') > 0
                 then round(100.0 * ((select n from d where day = current_date) - (select n from d where day = current_date - interval '1 day'))
                             / (select n from d where day = current_date - interval '1 day'))::int
                 else 0 end as delta_pct`,
  )

  // Signal: total count of locale-gap pages currently flagged. We reuse
  // getLocaleGaps's logic by importing it and taking the length of a
  // wider fetch. Not a strict "new today" delta — would require storing
  // yesterday's gap-list somewhere — but the count is the right shape of
  // signal: "if this number is large or jumped, look at the dashboard."
  const { getLocaleGaps } = await import('@/lib/seo/seo-queries')
  const gapList = await getLocaleGaps(1000)
  const newLocaleGapCount = gapList.length

  const signals: DigestSignals = {
    totalDirection: deltaT.direction,
    localeDeltas: Object.fromEntries(localeRows.map(r => [r.locale, r.deltaPct])) as DigestSignals['localeDeltas'],
    newLocaleGapCount,
    sitemapSizeDeltaPct: sitemapDelta.rows[0]?.delta_pct ?? 0,
  }

  const data: DigestData = {
    digestDate: today,
    dataThroughDay: latest.rows[0]?.day ?? today,
    snapshotFetchedAt: latest.rows[0]?.fetched_at ?? new Date().toISOString(),
    currentClicks: curT.clicks,
    priorClicks: priorT.clicks,
    delta: deltaT,
    localeRows,
    bullets: ingestStale
      ? [`Ingest is stale — last successful run was more than ${STALE_HOURS}h ago. Check Vercel cron logs.`]
      : computeBullets(signals),
    dashboardUrl: DASHBOARD_URL,
  }

  const subject = buildDigestSubject(data, ingestStale)
  const html = buildDigestHtml(data)

  const resend = new Resend(process.env.RESEND_API_KEY!)
  let sentOk = true
  let lastError: string | null = null
  for (const to of recipients) {
    try {
      await resend.emails.send({
        from: 'SEO Dashboard <seo@padelnachos.com>',
        to: [to],
        subject,
        html,
      })
    } catch (e) {
      sentOk = false
      lastError = String(e)
    }
    await pool.query(
      `insert into public.seo_digest_sends (digest_date, recipient, status, error)
         values ($1, $2, $3, $4)
         on conflict (digest_date, recipient) do update set
           status = excluded.status, error = excluded.error, sent_at = now()`,
      [today, to, sentOk ? 'sent' : 'failed', lastError],
    )
  }

  return NextResponse.json({ ok: sentOk, day: today, recipients: recipients.length })
}
```

- [ ] **Step 4: Run test to confirm pass**

```bash
cd apps/ops && npx vitest run tests/seo-digest-route.test.ts
```
Expected: PASS — 3 tests green.

- [ ] **Step 5: Live test the email**

With dev server running and `RESEND_API_KEY` + `SEO_DIGEST_RECIPIENTS` set in `.env.local`:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3004/api/internal/seo-digest
```
Expected: `{ "ok": true, "day": "<today>", "recipients": 1 }`.

Check gustavo@padellabs.tech inbox — should arrive within seconds. Subject like `SEO · clicks ↑18% · 1,247 last 7d`. Body renders cleanly on mobile.

If no email arrives: check Resend dashboard for delivery status. Most common cause: domain not verified for the `from:` address.

- [ ] **Step 6: Commit**

```bash
git add apps/ops/src/app/api/internal/seo-digest/route.ts apps/ops/tests/seo-digest-route.test.ts
git commit -m "feat(seo): add daily Resend digest cron"
```

---

## Phase 6 — Wire up the crons

### Task 18: Register Vercel crons + production verification

**Files:**
- Modify: `apps/ops/vercel.json`

- [ ] **Step 1: Update vercel.json**

Open `apps/ops/vercel.json` (currently `{}`) and replace with:

```json
{
  "crons": [
    { "path": "/api/internal/seo-snapshot",  "schedule": "0 9 * * *" },
    { "path": "/api/internal/sitemap-crawl", "schedule": "15 9 * * *" },
    { "path": "/api/internal/seo-digest",    "schedule": "30 9 * * *" }
  ]
}
```

- [ ] **Step 2: Set Vercel env vars in the `padel-ops` project**

In Vercel Dashboard → padel-ops → Settings → Environment Variables, add (or confirm) for Production:

```
GSC_OAUTH_CLIENT_ID
GSC_OAUTH_CLIENT_SECRET
GSC_OAUTH_REFRESH_TOKEN
GSC_SITE_URL=https://padelnachos.com/
SEO_DIGEST_RECIPIENTS=gustavo@padellabs.tech
RESEND_API_KEY        # confirm already set
CRON_SECRET           # confirm already set
DATABASE_URL          # confirm already set
```

- [ ] **Step 3: Commit + deploy**

```bash
git add apps/ops/vercel.json
git commit -m "feat(seo): register snapshot/sitemap-crawl/digest crons in vercel.json"
```

Push to a branch + open PR + merge per the user's PR workflow (don't push to main directly).

After merge, Vercel auto-deploys. Confirm the crons are registered: in Vercel Dashboard → padel-ops → Settings → Cron Jobs, three rows should appear with the schedules above.

- [ ] **Step 4: Manual prod verification (probe + one ingest)**

```bash
# Probe — confirms OAuth env vars are correct in prod
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "https://admin.padelnachos.com/api/internal/seo-snapshot?probe=true"

# One real ingest — pulls 3-days-ago into prod Supabase
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "https://admin.padelnachos.com/api/internal/seo-snapshot"
```
Expected: `{ "ok": true, "day": "<3 days ago>", "locales_written": 6, ... }`.

- [ ] **Step 5: Production backfill (90 days)**

```bash
for d in $(seq 90 -1 3); do
  iso=$(date -v-${d}d +%Y-%m-%d 2>/dev/null || date -d "${d} days ago" +%Y-%m-%d)
  curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
    "https://admin.padelnachos.com/api/internal/seo-snapshot?day=${iso}"
  echo ""
  sleep 2
done
```

Expected: ~88 successful JSON responses. After this, the prod dashboard at https://admin.padelnachos.com/system/seo renders a full 90-day sparkline.

- [ ] **Step 6: Wait two cycles, confirm digest delivered**

The next two mornings, check gustavo@padellabs.tech inbox at ~09:35 UTC. Confirm `seo_digest_sends` has `status='sent'` rows for both days:

```bash
psql "$DATABASE_URL" -c "select * from public.seo_digest_sends order by sent_at desc;"
```

If a row is missing or `status='failed'`, check Vercel cron logs for the corresponding day.

- [ ] **Step 7: No commit (verification only)**

---

## Acceptance criteria (the dashboard is done when…)

- [ ] Visiting https://admin.padelnachos.com/system/seo renders the headline tile, 90-day sparkline, locale table, and top-queries table with real GSC data.
- [ ] Visiting https://admin.padelnachos.com/system/seo/opportunities renders all three panels (locale gaps may be empty for the first few days — that's fine).
- [ ] gustavo@padellabs.tech receives a daily morning email at ~09:35 UTC.
- [ ] Two consecutive days of `seo_digest_sends` rows with `status='sent'`.
- [ ] Sidebar nav shows "SEO" under System group.
- [ ] All tests pass: `cd apps/ops && npm test`.

# Ops Dashboard — Design Spec

**Date:** 2026-04-01
**Status:** Approved
**Author:** Claude + GuDenes

## Overview

An operational dashboard at `/ops` for monitoring integration health, data quality, and app usage for PadelNacho. Solo-user, light-mode admin panel protected by bearer token. Server-rendered with 30s client-side polling.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Audience | Solo developer | No auth UI, no roles — bearer token only |
| Hosting | Route in same app (`/ops`) | Shares codebase, deployment, and DB clients |
| Data source | New `ops_events` table + queries on existing tables | Enables historical cron tracking without external dependencies |
| UI style | Clean light admin | White background, subtle borders, high readability |
| Tile layout | Individual tiles per cron/service | 8 tiles — max visibility for spotting failures at a glance |
| Refresh | 30s client-side polling | Simple, sufficient for an ops dashboard checked a few times/day |

## Architecture

### Data Layer

#### New table: `ops_events`

```sql
CREATE TABLE ops_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text NOT NULL,        -- 'cron:scores', 'cron:sync', 'cron:sync-matches',
                                    -- 'cron:rankings', 'cron:articles', 'cron:highlights',
                                    -- 'relay'
  status      text NOT NULL,        -- 'ok', 'error', 'partial', 'timeout'
  started_at  timestamptz NOT NULL,
  finished_at timestamptz,
  duration_ms int,
  meta        jsonb,                -- flexible per-source payload (see below)
  error_message text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX idx_ops_events_source_time ON ops_events (source, started_at DESC);
```

**Check constraint:** `status IN ('ok', 'error', 'partial', 'timeout')`

**Retention:** Keep last 30 days. Older rows can be pruned by a weekly cron or manual cleanup.

#### `meta` payloads per source

| Source | Example `meta` |
|--------|---------------|
| `cron:scores` | `{"updated": 12, "stale": 0, "api_requests": 58, "live_matches": 4}` |
| `cron:sync-matches` | `{"matches_synced": 340, "tournaments": 4}` |
| `cron:sync` | `{"tournaments": 4, "players": 120, "seasons": 1}` |
| `cron:rankings` | `{"official": 1000, "race": 1000, "men": true, "women": true}` |
| `cron:articles` | `{"new": 6, "sources_checked": 4}` |
| `cron:highlights` | `{"new": 3, "channels_checked": 5}` |
| `relay` | `{"pusher_state": "connected", "channels": 5, "event": "reconnect"}` |

#### Queried from existing tables (no new columns needed)

| Metric | Query |
|--------|-------|
| Live matches count | `matches WHERE status = 'live'` |
| Last score update | `matches ORDER BY updated_at DESC LIMIT 1` |
| Stale matches | `matches WHERE status = 'live' AND updated_at < now() - interval '15 min'` |
| Total matches | `COUNT(*) FROM matches` |
| Matches with PBP | `COUNT(*) FROM matches WHERE raw_payload IS NOT NULL` |
| Missing scores | `matches WHERE status IN ('finished','retired') AND id NOT IN (SELECT match_id FROM sets)` |
| Unresolved players | `players WHERE external_id IS NULL` |
| Tournaments count | `COUNT(*) FROM tournaments` |

### Auth

- Middleware on `/ops/*` routes checks for:
  1. Cookie `ops_token` matching `CRON_SECRET`, OR
  2. Query param `?token=CRON_SECRET` — if valid, sets `ops_token` cookie (HTTP-only, 30-day expiry) and redirects to `/ops` without token in URL
- No login page. Access via bookmarked URL with token.
- Invalid/missing token returns 401 with a minimal "Unauthorized" page.

### Routing & Layout

```
src/app/ops/
├── layout.tsx          -- light theme wrapper, no bottom nav, no app shell
├── page.tsx            -- server component: fetches all data, passes to client
├── OpsClient.tsx       -- client component: renders dashboard, polls every 30s
└── api/status/route.ts -- JSON endpoint for polling (covered by ops middleware)

src/middleware.ts        -- root middleware with /ops/* path check for auth
```

- `/ops` layout is independent from the main app layout — clean white background, system font stack, no PadelNacho branding.
- Server component fetches all dashboard data in a single pass (multiple parallel Supabase queries).
- Client component receives initial data as props, then polls `/ops/api/status` every 30s for updates.

### API Endpoint

#### `GET /ops/api/status`

Nested under `/ops/` so it's covered by the same middleware auth (cookie check). Returns the full dashboard payload as JSON.

```typescript
{
  // Integration health — last event per source
  health: {
    [source: string]: {
      status: string,
      started_at: string,
      duration_ms: number | null,
      meta: object | null,
      error_message: string | null,
    }
  },
  // Relay status (live fetch from Railway)
  relay: {
    ok: boolean,
    pusher_state: string,
    active_channels: number,
    uptime: number,
  },
  // Data freshness
  freshness: {
    live_matches: number,
    last_score_update: string | null,
    stale_matches: { id: string, external_id: string, updated_at: string }[],
  },
  // Data quality
  quality: {
    total_matches: number,
    with_pbp: number,
    missing_scores: number,
    unresolved_players: number,
    total_tournaments: number,
  },
  // App usage (from Vercel Analytics API or null if unavailable)
  usage: {
    page_views_24h: number | null,
    unique_visitors_24h: number | null,
    top_page: string | null,
    top_country: string | null,
  } | null,
  // Recent events log
  recent_events: Array<{
    source: string,
    status: string,
    started_at: string,
    duration_ms: number | null,
    meta: object | null,
    error_message: string | null,
  }>,
  // Timestamp
  fetched_at: string,
}
```

### Cron Integration

Each cron handler gets a `logOpsEvent()` helper wrapping its execution:

```typescript
// lib/ops-logger.ts
export async function logOpsEvent(
  source: string,
  fn: () => Promise<Record<string, any>>
): Promise<void> {
  const startedAt = new Date()
  let status = 'ok'
  let meta = {}
  let errorMessage = null

  try {
    meta = await fn()
  } catch (err) {
    status = 'error'
    errorMessage = String(err)
  }

  const finishedAt = new Date()
  await supabase.from('ops_events').insert({
    source,
    status,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
    meta,
    error_message: errorMessage,
  })
}
```

Usage in a cron handler:

```typescript
export async function GET(request: Request) {
  await logOpsEvent('cron:scores', async () => {
    // existing cron logic...
    return { updated: 12, stale: 0, api_requests: 58 }
  })
  return Response.json({ ok: true })
}
```

The relay service writes `ops_events` rows directly on connect/disconnect/error lifecycle events.

## UI Sections

### 1. Integration Health (top row, 4x2 grid)

8 tiles, one per source:

| Tile | Source | Schedule shown |
|------|--------|---------------|
| Scores | `cron:scores` | Every 2 min |
| Sync Matches | `cron:sync-matches` | Every 6h |
| Full Sync | `cron:sync` | Mon 4am UTC |
| Rankings | `cron:rankings` | Daily 5am UTC |
| Articles | `cron:articles` | Every 6h |
| Highlights | `cron:highlights` | Every 6h |
| Relay (Pusher) | `relay` | Always-on |
| API Budget | computed | padelapi.org |

Each tile shows:
- Source name + schedule
- Status dot (green/yellow/red) + label (OK / Partial / Error / Disconnected)
- Time since last run + duration
- Key metric from `meta` (e.g., "12 updated" for scores)
- Colored left border matching status

API Budget tile is special: shows current daily count (from latest `cron:scores` meta) with a progress bar.

### 2. Data Freshness (3-column row)

- **Live Matches** — count + active tournament name
- **Last Score Update** — time ago + match ID context
- **Stale Matches** — count (red if > 0) + oldest stale match

### 3. Data Quality (4-column row)

- **Total Matches** — count across all tournaments
- **With PBP Data** — percentage + count
- **Missing Scores** — finished matches with no sets
- **Unresolved Players** — players without external_id

### 4. App Usage (4-column row)

- **Page Views (24h)** — count + % change
- **Unique Visitors (24h)** — count + countries
- **Top Page** — path + view count
- **Top Country** — name + % of traffic

Note: App usage depends on Vercel Analytics API availability. If not accessible, this section shows "Analytics unavailable" with a link to the Vercel dashboard. This is a nice-to-have — can be added in a later iteration if the API integration is complex.

### 5. Recent Events (table)

Scrollable table of the last 50 `ops_events` rows, showing:
- Time (relative)
- Source (colored pill)
- Status (icon + text)
- Duration
- Details (from `meta` or `error_message`)

## Non-Goals

- No alerting/notifications (check Vercel logs for that)
- No user management or roles
- No historical charts or trend graphs (v1 — can add later)
- No write operations from the dashboard (read-only)
- No mobile optimization (desktop-only admin tool)

## Testing

- `logOpsEvent()` unit test: verify it writes correct rows on success and error
- `/api/ops/status` integration test: verify it returns the expected shape
- Manual verification of dashboard rendering with sample data

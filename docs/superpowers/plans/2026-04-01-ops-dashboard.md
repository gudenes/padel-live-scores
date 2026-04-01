# Ops Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only operational dashboard at `/ops` for monitoring cron health, relay status, data quality, and app usage.

**Architecture:** Server-rendered Next.js page with 30s client-side polling. New `ops_events` Supabase table for cron execution history. Bearer-token auth via middleware cookie. Light-mode admin UI.

**Tech Stack:** Next.js 16, React 19, Supabase (PostgreSQL + JS client), Tailwind-free inline styles (matching the mockup approach used elsewhere in the app).

**Spec:** `docs/superpowers/specs/2026-04-01-ops-dashboard-design.md`

---

## File Structure

```
src/
  lib/
    ops-logger.ts           -- logOpsEvent() helper for cron handlers
  middleware.ts              -- MODIFY: add /ops/* auth check
  app/
    ops/
      layout.tsx             -- light theme wrapper, independent from main app
      page.tsx               -- server component: parallel data fetches → OpsClient
      OpsClient.tsx          -- client component: renders tiles + polls /ops/api/status
      api/status/route.ts    -- JSON endpoint returning full dashboard payload
    api/cron/
      scores/route.ts        -- MODIFY: wrap with logOpsEvent
      sync/route.ts          -- MODIFY: wrap with logOpsEvent
      sync-fip-rankings/route.ts -- MODIFY: wrap with logOpsEvent
      sync-articles/route.ts -- MODIFY: wrap with logOpsEvent
      sync-highlights/route.ts -- MODIFY: wrap with logOpsEvent
supabase/
  migrations/
    20260401_ops_events.sql  -- migration file (applied via Supabase dashboard)
```

---

### Task 1: Create `ops_events` migration SQL

**Files:**
- Create: `supabase/migrations/20260401_ops_events.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260401_ops_events.sql
-- Ops events log for cron execution tracking

CREATE TABLE ops_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source        text NOT NULL,
  status        text NOT NULL CHECK (status IN ('ok', 'error', 'partial', 'timeout')),
  started_at    timestamptz NOT NULL,
  finished_at   timestamptz,
  duration_ms   int,
  meta          jsonb,
  error_message text,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_ops_events_source_time ON ops_events (source, started_at DESC);

-- Allow anon reads (dashboard uses anon key via cookie-authed middleware)
-- Service key writes from cron handlers bypass RLS anyway
ALTER TABLE ops_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read" ON ops_events FOR SELECT USING (true);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260401_ops_events.sql
git commit -m "feat(ops): add ops_events migration SQL"
```

- [ ] **Step 3: Apply migration**

Apply this SQL via the Supabase dashboard SQL editor. Run the full contents of the file.

---

### Task 2: Create `logOpsEvent` helper

**Files:**
- Create: `src/lib/ops-logger.ts`

- [ ] **Step 1: Write the ops logger**

```typescript
// src/lib/ops-logger.ts
// Lightweight wrapper for logging cron/relay execution to ops_events table.

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

/**
 * Wraps a cron handler function, logging start/end/error to ops_events.
 * The wrapped function should return a meta object with key metrics.
 * If it throws, the error is caught, logged, and re-thrown.
 */
export async function logOpsEvent(
  source: string,
  fn: () => Promise<Record<string, any>>
): Promise<Record<string, any>> {
  const startedAt = new Date()
  let status: 'ok' | 'error' | 'partial' | 'timeout' = 'ok'
  let meta: Record<string, any> = {}
  let errorMessage: string | null = null

  try {
    meta = await fn()
    // Allow the function to signal partial success via meta
    if (meta._status === 'partial') {
      status = 'partial'
      delete meta._status
    }
  } catch (err) {
    status = 'error'
    errorMessage = String(err)
    // Re-throw so the cron handler can still return its error response
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
    throw err
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

  return meta
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/ops-logger.ts
git commit -m "feat(ops): add logOpsEvent helper for cron tracking"
```

---

### Task 3: Integrate `logOpsEvent` into cron handlers

**Files:**
- Modify: `src/app/api/cron/scores/route.ts` (lines 889-973)
- Modify: `src/app/api/cron/sync/route.ts` (GET handler)
- Modify: `src/app/api/cron/sync-fip-rankings/route.ts` (GET handler)
- Modify: `src/app/api/cron/sync-articles/route.ts` (GET handler)
- Modify: `src/app/api/cron/sync-highlights/route.ts` (GET handler)

The pattern for each: wrap the existing try/catch body in `logOpsEvent()`, return the response payload as meta. Keep existing auth checks and response format unchanged.

- [ ] **Step 1: Integrate into scores cron**

In `src/app/api/cron/scores/route.ts`, add the import at the top:

```typescript
import { logOpsEvent } from '@/lib/ops-logger'
```

Then wrap the try block body (lines 904-965) inside `logOpsEvent`. The existing try/catch and auth check stay as-is. Insert the logging around the core logic:

```typescript
  try {
    const result = await logOpsEvent('cron:scores', async () => {
      console.log('[Score Agent] Starting live sync...')
      const liveMatches = await fetchLiveMatches()
      let syncSucceeded = 0
      let syncFailed = 0

      // ... existing match sync loop (unchanged) ...

      const staleResult = await detectStaleMatches(liveMatches)
      const reconciliation = await reconcileIncompleteMatches()

      // ... existing relay ping (unchanged) ...

      return {
        synced: syncSucceeded,
        failed: syncFailed,
        total: liveMatches.length,
        live_matches: liveMatches.length,
        stale: staleResult.found,
        api_requests: _rateLimitRemaining,
      }
    })

    return Response.json({
      ...result,
      mode: 'live',
      rateLimitRemaining: _rateLimitRemaining,
    })
  } catch (error) {
    // existing error handler unchanged
  }
```

- [ ] **Step 2: Integrate into sync cron**

In `src/app/api/cron/sync/route.ts`, add the import and wrap the main try block body:

```typescript
import { logOpsEvent } from '@/lib/ops-logger'
```

The sync handler has multiple scopes. Wrap the entire try block. The returned meta should include the scope and counts:

```typescript
    const result = await logOpsEvent(`cron:sync${scope === 'matches' ? '-matches' : ''}`, async () => {
      // ... existing sync logic (unchanged) ...
      return {
        scope,
        tournaments_synced: totalTournamentsSynced ?? 0,
        matches_synced: totalMatchesSynced ?? 0,
        players_synced: playerResult?.synced ?? 0,
      }
    })
```

Note: use `cron:sync-matches` when `scope === 'matches'`, otherwise `cron:sync`.

- [ ] **Step 3: Integrate into rankings cron**

In `src/app/api/cron/sync-fip-rankings/route.ts`, this is a thin wrapper around the admin endpoint. Wrap the delegation call:

```typescript
import { logOpsEvent } from '@/lib/ops-logger'
```

```typescript
    const meta = await logOpsEvent('cron:rankings', async () => {
      const res = await syncFipRankings(fakeReq)
      const data = await res.json()
      return { official: data.official ?? 0, race: data.race ?? 0 }
    })
```

Since this handler proxies to admin, capture the response JSON for meta.

- [ ] **Step 4: Integrate into articles cron**

In `src/app/api/cron/sync-articles/route.ts`, add import and wrap the main logic:

```typescript
import { logOpsEvent } from '@/lib/ops-logger'
```

```typescript
    const meta = await logOpsEvent('cron:articles', async () => {
      // ... existing fetch/upsert logic (unchanged) ...
      return {
        new: totalUpserted,
        sources_checked: Object.keys(results).length,
      }
    })
```

- [ ] **Step 5: Integrate into highlights cron**

In `src/app/api/cron/sync-highlights/route.ts`, add import and wrap:

```typescript
import { logOpsEvent } from '@/lib/ops-logger'
```

```typescript
    const meta = await logOpsEvent('cron:highlights', async () => {
      // ... existing fetch/upsert logic (unchanged) ...
      return {
        new: upserted,
        channels_checked: CHANNELS.length,
        found: allVideoIds.size,
      }
    })
```

- [ ] **Step 6: Verify build compiles**

Run: `npx tsc --noEmit 2>&1 | grep -v vitest`
Expected: No errors (only the pre-existing vitest import error)

- [ ] **Step 7: Commit**

```bash
git add src/app/api/cron/scores/route.ts src/app/api/cron/sync/route.ts \
  src/app/api/cron/sync-fip-rankings/route.ts src/app/api/cron/sync-articles/route.ts \
  src/app/api/cron/sync-highlights/route.ts
git commit -m "feat(ops): integrate logOpsEvent into all cron handlers"
```

---

### Task 4: Add `/ops/*` auth middleware

**Files:**
- Modify: `src/middleware.ts`

- [ ] **Step 1: Extend middleware with ops auth**

Replace the contents of `src/middleware.ts`:

```typescript
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ── Ops dashboard auth ──────────────────────────────────────
  if (pathname.startsWith('/ops')) {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      return new NextResponse('Server misconfigured', { status: 500 })
    }

    // Check for token in query param (first visit / bookmark)
    const tokenParam = request.nextUrl.searchParams.get('token')
    if (tokenParam === cronSecret) {
      // Set cookie and redirect without token in URL
      const cleanUrl = new URL(pathname, request.url)
      const response = NextResponse.redirect(cleanUrl)
      response.cookies.set('ops_token', cronSecret, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30, // 30 days
        path: '/ops',
      })
      return response
    }

    // Check cookie
    const cookieToken = request.cookies.get('ops_token')?.value
    if (cookieToken !== cronSecret) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    return NextResponse.next()
  }

  // ── Geo-country cookie (existing) ───────────────────────────
  const response = NextResponse.next()
  const country = request.headers.get('x-vercel-ip-country') ?? ''
  if (country) {
    response.cookies.set('geo-country', country, {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      maxAge: 86400,
    })
  }
  return response
}

export const config = {
  matcher: ['/v2/:path*', '/ops/:path*'],
}
```

- [ ] **Step 2: Verify build compiles**

Run: `npx tsc --noEmit 2>&1 | grep -v vitest`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(ops): add /ops/* bearer token auth middleware"
```

---

### Task 5: Create `/ops/api/status` endpoint

**Files:**
- Create: `src/app/ops/api/status/route.ts`

- [ ] **Step 1: Write the status API route**

```typescript
// src/app/ops/api/status/route.ts
// Returns full dashboard payload as JSON. Auth handled by middleware.

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const RELAY_URL = process.env.RELAY_URL
const RELAY_SECRET = process.env.RELAY_SECRET

export async function GET() {
  const [health, freshness, quality, recentEvents, relay] = await Promise.all([
    fetchHealth(),
    fetchFreshness(),
    fetchQuality(),
    fetchRecentEvents(),
    fetchRelayStatus(),
  ])

  return Response.json({
    health,
    relay,
    freshness,
    quality,
    usage: null, // Vercel Analytics API — deferred to v2
    recent_events: recentEvents,
    fetched_at: new Date().toISOString(),
  })
}

// ── Health: last event per source ──────────────────────────────

async function fetchHealth() {
  const sources = [
    'cron:scores', 'cron:sync', 'cron:sync-matches',
    'cron:rankings', 'cron:articles', 'cron:highlights',
  ]

  const health: Record<string, any> = {}

  for (const source of sources) {
    const { data } = await supabase
      .from('ops_events')
      .select('status, started_at, duration_ms, meta, error_message')
      .eq('source', source)
      .order('started_at', { ascending: false })
      .limit(1)
      .single()

    health[source] = data ?? { status: 'unknown', started_at: null, duration_ms: null, meta: null, error_message: null }
  }

  return health
}

// ── Relay: live fetch from Railway ─────────────────────────────

async function fetchRelayStatus() {
  if (!RELAY_URL || !RELAY_SECRET) {
    return { ok: false, pusher_state: 'unknown', active_channels: 0, uptime: 0 }
  }

  try {
    const res = await fetch(`${RELAY_URL}/health`, {
      headers: { Authorization: `Bearer ${RELAY_SECRET}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return {
      ok: data.ok === true,
      pusher_state: data.pusherState ?? 'unknown',
      active_channels: data.activeChannels ?? 0,
      uptime: data.uptime ?? 0,
    }
  } catch {
    return { ok: false, pusher_state: 'unreachable', active_channels: 0, uptime: 0 }
  }
}

// ── Freshness: live matches, last update, stale ────────────────

async function fetchFreshness() {
  const [liveRes, lastUpdateRes, staleRes] = await Promise.all([
    supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'live'),
    supabase.from('matches').select('id, external_id, updated_at').order('updated_at', { ascending: false }).limit(1).single(),
    supabase.from('matches').select('id, external_id, updated_at').eq('status', 'live').lt('updated_at', new Date(Date.now() - 15 * 60 * 1000).toISOString()),
  ])

  return {
    live_matches: liveRes.count ?? 0,
    last_score_update: lastUpdateRes.data?.updated_at ?? null,
    stale_matches: (staleRes.data ?? []).map(m => ({
      id: m.id,
      external_id: m.external_id,
      updated_at: m.updated_at,
    })),
  }
}

// ── Quality: counts from existing tables ───────────────────────

async function fetchQuality() {
  const [matchesRes, pbpRes, tournamentsRes, unresolvedRes] = await Promise.all([
    supabase.from('matches').select('id', { count: 'exact', head: true }),
    supabase.from('matches').select('id', { count: 'exact', head: true }).not('raw_payload', 'is', null),
    supabase.from('tournaments').select('id', { count: 'exact', head: true }),
    supabase.from('players').select('id', { count: 'exact', head: true }).is('external_id', null),
  ])

  // Missing scores: finished matches without any sets
  const { data: missingScores } = await supabase.rpc('count_missing_scores').single()
  // Fallback if RPC doesn't exist — use a simpler query
  let missingCount = (missingScores as any)?.count ?? 0
  if (!missingScores) {
    const { count } = await supabase
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .in('status', ['finished', 'retired'])
      .is('winner_pair', null)
    missingCount = count ?? 0
  }

  return {
    total_matches: matchesRes.count ?? 0,
    with_pbp: pbpRes.count ?? 0,
    missing_scores: missingCount,
    unresolved_players: unresolvedRes.count ?? 0,
    total_tournaments: tournamentsRes.count ?? 0,
  }
}

// ── Recent events log ──────────────────────────────────────────

async function fetchRecentEvents() {
  const { data } = await supabase
    .from('ops_events')
    .select('source, status, started_at, duration_ms, meta, error_message')
    .order('started_at', { ascending: false })
    .limit(50)

  return data ?? []
}
```

- [ ] **Step 2: Verify build compiles**

Run: `npx tsc --noEmit 2>&1 | grep -v vitest`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/ops/api/status/route.ts
git commit -m "feat(ops): add /ops/api/status JSON endpoint"
```

---

### Task 6: Create `/ops` layout

**Files:**
- Create: `src/app/ops/layout.tsx`

- [ ] **Step 1: Write the ops layout**

```typescript
// src/app/ops/layout.tsx
// Independent light-theme layout for the ops dashboard.
// No bottom nav, no PadelNacho app shell.

export const metadata = {
  title: 'PadelNacho Ops',
}

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{
        margin: 0,
        padding: 0,
        background: '#f8f9fa',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: '#1a1a1a',
        minHeight: '100vh',
      }}>
        {children}
      </body>
    </html>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/ops/layout.tsx
git commit -m "feat(ops): add light-theme ops layout"
```

---

### Task 7: Create `/ops` server page

**Files:**
- Create: `src/app/ops/page.tsx`

- [ ] **Step 1: Write the server component**

```typescript
// src/app/ops/page.tsx
// Server component: fetches initial dashboard data and passes to client.

import OpsClient from './OpsClient'

export const dynamic = 'force-dynamic'

async function fetchInitialData(baseUrl: string) {
  try {
    const res = await fetch(`${baseUrl}/ops/api/status`, {
      headers: { Cookie: `ops_token=${process.env.CRON_SECRET}` },
      cache: 'no-store',
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export default async function OpsPage() {
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http'
  const host = process.env.VERCEL_URL ?? 'localhost:3002'
  const baseUrl = `${protocol}://${host}`
  const data = await fetchInitialData(baseUrl)

  return <OpsClient initialData={data} />
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/ops/page.tsx
git commit -m "feat(ops): add server page with initial data fetch"
```

---

### Task 8: Create `OpsClient` dashboard component

**Files:**
- Create: `src/app/ops/OpsClient.tsx`

This is the largest task — the full dashboard UI. It renders all 5 sections from the spec mockup.

- [ ] **Step 1: Write the client component**

```typescript
'use client'
// src/app/ops/OpsClient.tsx
// Client component: renders the ops dashboard and polls every 30s.

import { useEffect, useState, useCallback } from 'react'

// ── Types ───────────────────────────────────────────────────────

interface HealthEntry {
  status: string
  started_at: string | null
  duration_ms: number | null
  meta: Record<string, any> | null
  error_message: string | null
}

interface RelayStatus {
  ok: boolean
  pusher_state: string
  active_channels: number
  uptime: number
}

interface StaleMatch {
  id: string
  external_id: string
  updated_at: string
}

interface DashboardData {
  health: Record<string, HealthEntry>
  relay: RelayStatus
  freshness: {
    live_matches: number
    last_score_update: string | null
    stale_matches: StaleMatch[]
  }
  quality: {
    total_matches: number
    with_pbp: number
    missing_scores: number
    unresolved_players: number
    total_tournaments: number
  }
  usage: null
  recent_events: Array<{
    source: string
    status: string
    started_at: string
    duration_ms: number | null
    meta: Record<string, any> | null
    error_message: string | null
  }>
  fetched_at: string
}

// ── Config ──────────────────────────────────────────────────────

const TILES = [
  { key: 'cron:scores', label: 'Scores', schedule: 'Every 2 min' },
  { key: 'cron:sync-matches', label: 'Sync Matches', schedule: 'Every 6h' },
  { key: 'cron:sync', label: 'Full Sync', schedule: 'Mon 4am UTC' },
  { key: 'cron:rankings', label: 'Rankings', schedule: 'Daily 5am UTC' },
  { key: 'cron:articles', label: 'Articles', schedule: 'Every 6h' },
  { key: 'cron:highlights', label: 'Highlights', schedule: 'Every 6h' },
] as const

// ── Helpers ─────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function statusColor(status: string): string {
  switch (status) {
    case 'ok': return '#22c55e'
    case 'partial': return '#f59e0b'
    case 'error': case 'timeout': return '#ef4444'
    default: return '#9ca3af'
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'ok': return 'OK'
    case 'partial': return 'Partial'
    case 'error': return 'Error'
    case 'timeout': return 'Timeout'
    default: return 'Unknown'
  }
}

function statusBorder(status: string): string {
  switch (status) {
    case 'ok': return '1px solid #e5e7eb'
    case 'partial': return '1px solid #fde68a'
    case 'error': case 'timeout': return '1px solid #fecaca'
    default: return '1px solid #e5e7eb'
  }
}

function metaSummary(source: string, meta: Record<string, any> | null): string {
  if (!meta) return ''
  switch (source) {
    case 'cron:scores': return `${meta.synced ?? 0} updated · ${meta.stale ?? 0} stale`
    case 'cron:sync-matches': return `${meta.matches_synced ?? 0} matches`
    case 'cron:sync': return `${meta.tournaments_synced ?? 0} tournaments · ${meta.players_synced ?? 0} players`
    case 'cron:rankings': return `Official: ${meta.official ?? 0} · Race: ${meta.race ?? 0}`
    case 'cron:articles': return `${meta.new ?? 0} new from ${meta.sources_checked ?? 0} sources`
    case 'cron:highlights': return `${meta.new ?? 0} new videos`
    default: return ''
  }
}

const SOURCE_COLORS: Record<string, { bg: string; text: string }> = {
  'cron:scores': { bg: '#dbeafe', text: '#1e40af' },
  'cron:sync': { bg: '#d1fae5', text: '#065f46' },
  'cron:sync-matches': { bg: '#d1fae5', text: '#065f46' },
  'cron:rankings': { bg: '#fef3c7', text: '#92400e' },
  'cron:articles': { bg: '#fce7f3', text: '#9d174d' },
  'cron:highlights': { bg: '#ede9fe', text: '#5b21b6' },
  'relay': { bg: '#fee2e2', text: '#991b1b' },
}

// ── Shared styles ───────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'white',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 12,
}

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  color: '#999',
  textTransform: 'uppercase' as const,
  fontWeight: 700,
  letterSpacing: 1,
  marginBottom: 8,
}

const bigNumber: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  marginTop: 4,
}

const dimText: React.CSSProperties = {
  fontSize: 10,
  color: '#666',
  marginTop: 2,
}

const tileLabel: React.CSSProperties = {
  fontSize: 9,
  color: '#888',
  textTransform: 'uppercase' as const,
  fontWeight: 600,
}

// ── Component ───────────────────────────────────────────────────

export default function OpsClient({ initialData }: { initialData: DashboardData | null }) {
  const [data, setData] = useState<DashboardData | null>(initialData)
  const [lastFetched, setLastFetched] = useState<Date | null>(initialData ? new Date() : null)
  const [fetchAgo, setFetchAgo] = useState('just now')

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/ops/api/status')
      if (!res.ok) return
      const json = await res.json()
      setData(json)
      setLastFetched(new Date())
    } catch { /* silent */ }
  }, [])

  // Poll every 30s
  useEffect(() => {
    const interval = setInterval(poll, 30000)
    return () => clearInterval(interval)
  }, [poll])

  // Update "ago" display every 5s
  useEffect(() => {
    const interval = setInterval(() => {
      if (!lastFetched) return
      const secs = Math.floor((Date.now() - lastFetched.getTime()) / 1000)
      if (secs < 5) setFetchAgo('just now')
      else if (secs < 60) setFetchAgo(`${secs}s ago`)
      else setFetchAgo(`${Math.floor(secs / 60)}m ago`)
    }, 5000)
    return () => clearInterval(interval)
  }, [lastFetched])

  if (!data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <p style={{ color: '#999' }}>Loading dashboard...</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111' }}>PadelNacho Ops</div>
          <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>Auto-refreshes every 30s</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} />
          <span style={{ fontSize: 11, color: '#888' }}>Updated {fetchAgo}</span>
        </div>
      </div>

      {/* Section 1: Integration Health */}
      <div style={sectionLabel}>Integration Health</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 20 }}>
        {TILES.map(tile => {
          const h = data.health[tile.key]
          const color = statusColor(h?.status ?? 'unknown')
          return (
            <div key={tile.key} style={{ ...card, border: statusBorder(h?.status ?? 'unknown'), borderLeft: `3px solid ${color}` }}>
              <div style={tileLabel}>{tile.label}</div>
              <div style={{ fontSize: 10, color: '#bbb', marginBottom: 6 }}>{tile.schedule}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
                <span style={{ fontSize: 13, fontWeight: 600, color }}>{statusLabel(h?.status ?? 'unknown')}</span>
              </div>
              <div style={{ fontSize: 10, color: '#999', marginTop: 4 }}>
                {timeAgo(h?.started_at ?? null)} · {formatDuration(h?.duration_ms ?? null)}
              </div>
              <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
                {h?.error_message ? <span style={{ color: '#dc2626' }}>{h.error_message.slice(0, 60)}</span> : metaSummary(tile.key, h?.meta ?? null)}
              </div>
            </div>
          )
        })}

        {/* Relay tile */}
        {(() => {
          const r = data.relay
          const color = r.ok ? '#22c55e' : '#ef4444'
          const label = r.ok ? 'Connected' : r.pusher_state === 'unreachable' ? 'Unreachable' : 'Disconnected'
          return (
            <div style={{ ...card, border: r.ok ? '1px solid #e5e7eb' : '1px solid #fecaca', borderLeft: `3px solid ${color}` }}>
              <div style={tileLabel}>Relay (Pusher)</div>
              <div style={{ fontSize: 10, color: '#bbb', marginBottom: 6 }}>Always-on</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
                <span style={{ fontSize: 13, fontWeight: 600, color }}>{label}</span>
              </div>
              <div style={{ fontSize: 10, color: '#999', marginTop: 4 }}>
                {r.active_channels} channels · {r.pusher_state}
              </div>
            </div>
          )
        })()}

        {/* API Budget tile */}
        {(() => {
          const scoresMeta = data.health['cron:scores']?.meta
          const remaining = scoresMeta?.api_requests ?? 0
          const daily = 2000
          const used = daily - remaining
          const pct = Math.min(100, Math.round((used / daily) * 100))
          return (
            <div style={{ ...card, borderLeft: '3px solid #3b82f6' }}>
              <div style={tileLabel}>API Budget</div>
              <div style={{ fontSize: 10, color: '#bbb', marginBottom: 6 }}>padelapi.org</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#1e40af' }}>{used.toLocaleString()}</div>
              <div style={{ height: 4, background: '#f0f0f0', borderRadius: 2, marginTop: 4 }}>
                <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, #3b82f6, #60a5fa)', borderRadius: 2 }} />
              </div>
              <div style={{ fontSize: 10, color: '#999', marginTop: 4 }}>/ {daily.toLocaleString()} daily</div>
            </div>
          )
        })()}
      </div>

      {/* Section 2: Data Freshness */}
      <div style={sectionLabel}>Data Freshness</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 20 }}>
        <div style={card}>
          <div style={tileLabel}>Live Matches</div>
          <div style={bigNumber}>{data.freshness.live_matches}</div>
        </div>
        <div style={card}>
          <div style={tileLabel}>Last Score Update</div>
          <div style={bigNumber}>{timeAgo(data.freshness.last_score_update)}</div>
        </div>
        <div style={card}>
          <div style={tileLabel}>Stale Matches</div>
          <div style={{ ...bigNumber, color: data.freshness.stale_matches.length > 0 ? '#dc2626' : undefined }}>
            {data.freshness.stale_matches.length}
          </div>
          {data.freshness.stale_matches.length > 0 && (
            <div style={{ ...dimText, color: '#dc2626' }}>
              #{data.freshness.stale_matches[0]?.external_id} · no update in {timeAgo(data.freshness.stale_matches[0]?.updated_at)}
            </div>
          )}
        </div>
      </div>

      {/* Section 3: Data Quality */}
      <div style={sectionLabel}>Data Quality</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 20 }}>
        <div style={card}>
          <div style={tileLabel}>Total Matches</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{data.quality.total_matches.toLocaleString()}</div>
          <div style={dimText}>across {data.quality.total_tournaments} tournaments</div>
        </div>
        <div style={card}>
          <div style={tileLabel}>With PBP Data</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#166534', marginTop: 4 }}>
            {data.quality.total_matches > 0 ? Math.round((data.quality.with_pbp / data.quality.total_matches) * 100) : 0}%
          </div>
          <div style={dimText}>{data.quality.with_pbp.toLocaleString()} matches</div>
        </div>
        <div style={card}>
          <div style={tileLabel}>Missing Scores</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: data.quality.missing_scores > 0 ? '#f59e0b' : undefined, marginTop: 4 }}>
            {data.quality.missing_scores}
          </div>
          <div style={dimText}>finished, no winner</div>
        </div>
        <div style={card}>
          <div style={tileLabel}>Unresolved Players</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: data.quality.unresolved_players > 0 ? '#f59e0b' : undefined, marginTop: 4 }}>
            {data.quality.unresolved_players}
          </div>
          <div style={dimText}>missing external_id</div>
        </div>
      </div>

      {/* Section 4: App Usage — placeholder for v2 */}
      {data.usage && (
        <>
          <div style={sectionLabel}>App Usage (24h)</div>
          <div style={{ ...card, marginBottom: 20, color: '#999', fontSize: 12 }}>
            Analytics integration coming in v2
          </div>
        </>
      )}

      {/* Section 5: Recent Events */}
      <div style={sectionLabel}>Recent Events</div>
      <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Time</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Source</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Status</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Duration</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Details</th>
            </tr>
          </thead>
          <tbody>
            {data.recent_events.map((evt, i) => {
              const sc = SOURCE_COLORS[evt.source] ?? { bg: '#f3f4f6', text: '#374151' }
              const shortSource = evt.source.replace('cron:', '')
              return (
                <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '6px 12px', color: '#999' }}>{timeAgo(evt.started_at)}</td>
                  <td style={{ padding: '6px 12px' }}>
                    <span style={{ background: sc.bg, color: sc.text, padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 500 }}>
                      {shortSource}
                    </span>
                  </td>
                  <td style={{ padding: '6px 12px', color: statusColor(evt.status) }}>
                    {evt.status === 'ok' ? '\u2713' : evt.status === 'error' ? '\u2717' : '\u26A0'} {evt.status}
                  </td>
                  <td style={{ padding: '6px 12px', color: '#666' }}>{formatDuration(evt.duration_ms)}</td>
                  <td style={{ padding: '6px 12px', color: evt.error_message ? '#dc2626' : '#666' }}>
                    {evt.error_message ?? metaSummary(evt.source, evt.meta)}
                  </td>
                </tr>
              )
            })}
            {data.recent_events.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: '20px 12px', textAlign: 'center', color: '#999' }}>
                  No events yet. Events will appear after cron jobs run.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify build compiles**

Run: `npx tsc --noEmit 2>&1 | grep -v vitest`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/ops/OpsClient.tsx
git commit -m "feat(ops): add OpsClient dashboard component with all 5 sections"
```

---

### Task 9: Manual verification

- [ ] **Step 1: Apply the migration**

Run the SQL from `supabase/migrations/20260401_ops_events.sql` in the Supabase dashboard SQL editor.

- [ ] **Step 2: Start dev server and test auth**

Run: `npm run dev`

1. Visit `http://localhost:3002/ops` — should get 401 Unauthorized
2. Visit `http://localhost:3002/ops?token=YOUR_CRON_SECRET` — should redirect to `/ops` and set cookie
3. Visit `http://localhost:3002/ops` again — should load the dashboard (cookie persists)

- [ ] **Step 3: Verify dashboard renders**

The dashboard should show:
- Integration Health: 6 cron tiles showing "Unknown" (no events yet) + Relay tile (live status) + API Budget tile
- Data Freshness: live match count, last score update time, stale matches
- Data Quality: total matches, PBP %, missing scores, unresolved players
- Recent Events: empty table with "No events yet" message

- [ ] **Step 4: Trigger a cron to generate an ops_event**

Run: `curl -s http://localhost:3002/api/cron/scores | python3 -m json.tool`

Then refresh the dashboard. The Scores tile should update from "Unknown" to "OK" with timing and meta data. The Recent Events table should show the event.

- [ ] **Step 5: Verify 30s polling**

Wait 30 seconds — the "Updated Xs ago" counter should reset and the dashboard data should refresh automatically.

- [ ] **Step 6: Final commit with any fixes**

```bash
git add -A
git commit -m "feat(ops): ops dashboard v1 complete"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Migration SQL | `supabase/migrations/20260401_ops_events.sql` |
| 2 | Ops logger helper | `src/lib/ops-logger.ts` |
| 3 | Cron integration | 5 cron route files |
| 4 | Auth middleware | `src/middleware.ts` |
| 5 | Status API endpoint | `src/app/ops/api/status/route.ts` |
| 6 | Ops layout | `src/app/ops/layout.tsx` |
| 7 | Server page | `src/app/ops/page.tsx` |
| 8 | Dashboard UI | `src/app/ops/OpsClient.tsx` |
| 9 | Manual verification | — |

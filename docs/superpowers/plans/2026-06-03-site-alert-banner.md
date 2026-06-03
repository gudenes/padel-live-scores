# Site-Wide Alert Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator publish a single site-wide alert banner from admin.padelnachos.com that renders at the top of the user app, with three severities, dismissible per-alert.

**Architecture:** A new `site_announcements` table holds one-banner-at-a-time data. The ops app (`apps/ops/`, deployed to admin.padelnachos.com) writes via service-key `/api/internal/announcements` routes. The main user app reads via a public, cached `/api/announcements/active` route (service client, like `ads/active`), and a client `AlertBanner` component mounted in the locale layout renders it. "Which banner shows" and "is it dismissed" are pure functions in `src/lib/announcement.ts`, unit-tested. Dismissal is keyed on `id:updated_at` so editing copy re-shows it.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Supabase (PostgREST + RLS), vitest. Ops UI uses the `apps/ops` `ui` primitives.

---

## File Structure

**Main app (`src/`):**
- Create `supabase/migrations/20260603120000_site_announcements.sql` — table + index + RLS.
- Create `src/lib/announcement.ts` — `Announcement` type + pure helpers (`selectActiveAnnouncement`, `dismissalKey`, `isDismissed`).
- Create `src/lib/__tests__/announcement.test.ts` — unit tests for the helpers.
- Create `src/app/api/announcements/active/route.ts` — public cached read.
- Create `src/hooks/useActiveAnnouncement.ts` — fetch + 60s poll.
- Create `src/components/announcements/AlertBanner.tsx` — render + dismiss.
- Modify `src/app/[locale]/layout.tsx` — mount `<AlertBanner />` before `{children}`.

**Ops app (`apps/ops/`):**
- Create `apps/ops/src/app/api/internal/announcements/route.ts` — GET list, POST create.
- Create `apps/ops/src/app/api/internal/announcements/[id]/route.ts` — GET, PUT, DELETE.
- Create `apps/ops/src/app/(app)/announcements/page.tsx` — page wrapper.
- Create `apps/ops/src/app/(app)/announcements/_components/AnnouncementsManager.tsx` — client UI.
- Modify `apps/ops/src/components/shell/Rail.tsx` — add nav item.

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260603120000_site_announcements.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260603120000_site_announcements.sql
-- Site-wide alert banner. Exactly one banner shows at a time (newest active
-- within its time window wins — see src/lib/announcement.ts::selectActiveAnnouncement).
-- Writes go through the ops app's service-key client (bypasses RLS).

CREATE TABLE IF NOT EXISTS site_announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message     text NOT NULL,
  type        text NOT NULL DEFAULT 'info' CHECK (type IN ('info','warning','critical')),
  active      boolean NOT NULL DEFAULT false,
  starts_at   timestamptz,
  expires_at  timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup of active rows (the read route filters active=true, newest first).
CREATE INDEX IF NOT EXISTS idx_site_announcements_active
  ON site_announcements (active, updated_at DESC);

ALTER TABLE site_announcements ENABLE ROW LEVEL SECURITY;

-- Public read of active rows only (the banner is shown to everyone).
-- The time-window filter (starts_at/expires_at) and newest-wins selection are
-- applied in the API route via selectActiveAnnouncement().
DROP POLICY IF EXISTS site_announcements_anon_read ON site_announcements;
CREATE POLICY site_announcements_anon_read ON site_announcements
  FOR SELECT TO anon
  USING (active = true);
```

- [ ] **Step 2: Apply the migration to the dev database**

Apply via the repo's normal migration path. If Supabase CLI is linked:

Run: `npx supabase db push`
Expected: the new migration is applied; no error. (If the project applies SQL via the Supabase dashboard instead, paste the file contents into the SQL editor and run it.)

- [ ] **Step 3: Verify the table exists**

Run: `npx supabase db execute "select column_name, data_type from information_schema.columns where table_name = 'site_announcements' order by ordinal_position"` (or run the equivalent query in the dashboard).
Expected: 8 columns — `id, message, type, active, starts_at, expires_at, updated_at, created_at`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260603120000_site_announcements.sql
git commit -m "feat(announcements): site_announcements table + RLS"
```

---

### Task 2: Pure helpers (TDD)

**Files:**
- Create: `src/lib/announcement.ts`
- Test: `src/lib/__tests__/announcement.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/__tests__/announcement.test.ts
import { describe, it, expect } from 'vitest'
import {
  selectActiveAnnouncement,
  dismissalKey,
  isDismissed,
  type Announcement,
} from '@/lib/announcement'

const base: Announcement = {
  id: 'a1',
  message: 'Matches suspended',
  type: 'warning',
  active: true,
  starts_at: null,
  expires_at: null,
  updated_at: '2026-06-03T10:00:00.000Z',
}
const NOW = Date.parse('2026-06-03T12:00:00.000Z')

describe('selectActiveAnnouncement', () => {
  it('returns null when no rows', () => {
    expect(selectActiveAnnouncement([], NOW)).toBeNull()
  })

  it('returns the row when active and no time window', () => {
    expect(selectActiveAnnouncement([base], NOW)?.id).toBe('a1')
  })

  it('excludes rows that are not yet started', () => {
    const future = { ...base, starts_at: '2026-06-03T18:00:00.000Z' }
    expect(selectActiveAnnouncement([future], NOW)).toBeNull()
  })

  it('excludes rows that have expired', () => {
    const past = { ...base, expires_at: '2026-06-03T11:00:00.000Z' }
    expect(selectActiveAnnouncement([past], NOW)).toBeNull()
  })

  it('includes a row inside its window', () => {
    const windowed = {
      ...base,
      starts_at: '2026-06-03T09:00:00.000Z',
      expires_at: '2026-06-03T18:00:00.000Z',
    }
    expect(selectActiveAnnouncement([windowed], NOW)?.id).toBe('a1')
  })

  it('picks the newest updated_at among eligible rows', () => {
    const older = { ...base, id: 'old', updated_at: '2026-06-03T08:00:00.000Z' }
    const newer = { ...base, id: 'new', updated_at: '2026-06-03T11:30:00.000Z' }
    expect(selectActiveAnnouncement([older, newer], NOW)?.id).toBe('new')
  })
})

describe('dismissal', () => {
  it('builds a key from id and updated_at', () => {
    expect(dismissalKey(base)).toBe('a1:2026-06-03T10:00:00.000Z')
  })

  it('is dismissed only when the stored key matches exactly', () => {
    expect(isDismissed(base, 'a1:2026-06-03T10:00:00.000Z')).toBe(true)
    expect(isDismissed(base, 'a1:2026-06-03T09:00:00.000Z')).toBe(false) // copy edited → re-show
    expect(isDismissed(base, null)).toBe(false)
    expect(isDismissed(base, 'garbage')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/announcement.test.ts`
Expected: FAIL — cannot resolve `@/lib/announcement` / functions not defined.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/announcement.ts
// Pure helpers for the site-wide alert banner. No IO — unit-tested in
// src/lib/__tests__/announcement.test.ts. The API route and the AlertBanner
// component both depend on these so "which banner shows" and "is it dismissed"
// have a single source of truth.

export type AnnouncementType = 'info' | 'warning' | 'critical'

export interface Announcement {
  id: string
  message: string
  type: AnnouncementType
  active: boolean
  starts_at: string | null
  expires_at: string | null
  updated_at: string
}

/**
 * Choose the single banner to show from candidate rows at time `nowMs`.
 * Rules: active, started (starts_at null or <= now), not expired (expires_at
 * null or > now). Among eligible rows, newest `updated_at` wins.
 */
export function selectActiveAnnouncement(
  rows: Announcement[],
  nowMs: number,
): Announcement | null {
  const eligible = rows.filter(
    (r) =>
      r.active &&
      (r.starts_at == null || Date.parse(r.starts_at) <= nowMs) &&
      (r.expires_at == null || Date.parse(r.expires_at) > nowMs),
  )
  if (eligible.length === 0) return null
  return eligible.reduce((a, b) =>
    Date.parse(b.updated_at) > Date.parse(a.updated_at) ? b : a,
  )
}

/** Identity used for dismissal — changes when a new alert is published OR its copy is edited. */
export function dismissalKey(a: Announcement): string {
  return `${a.id}:${a.updated_at}`
}

/** True only when the stored localStorage value matches the current alert's key. */
export function isDismissed(a: Announcement, stored: string | null): boolean {
  return stored != null && stored === dismissalKey(a)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/announcement.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/announcement.ts src/lib/__tests__/announcement.test.ts
git commit -m "feat(announcements): pure selection + dismissal helpers"
```

---

### Task 3: Public read API route (main app)

**Files:**
- Create: `src/app/api/announcements/active/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// src/app/api/announcements/active/route.ts
// Public, cached read of the active site announcement (or null). Mirrors the
// service-client + cache pattern of src/app/api/ads/active/route.ts. Time-window
// + newest-wins selection is delegated to selectActiveAnnouncement so it stays
// unit-tested. Degrades to { announcement: null } on any error (never breaks the app).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { selectActiveAnnouncement, type Announcement } from '@/lib/announcement'

export async function GET() {
  const supabase = createServerClient()
  try {
    const { data } = await supabase
      .from('site_announcements')
      .select('id, message, type, active, starts_at, expires_at, updated_at')
      .eq('active', true)

    const announcement = selectActiveAnnouncement(
      (data ?? []) as Announcement[],
      Date.now(),
    )

    return NextResponse.json(
      { announcement },
      { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' } },
    )
  } catch {
    return NextResponse.json({ announcement: null })
  }
}
```

- [ ] **Step 2: Verify it compiles and responds**

Start the dev server (`npm run dev`) if not running, then:
Run: `curl -s http://localhost:3002/api/announcements/active`
Expected: `{"announcement":null}` (no active rows yet). No 500.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/announcements/active/route.ts
git commit -m "feat(announcements): public active-announcement read route"
```

---

### Task 4: useActiveAnnouncement hook (main app)

**Files:**
- Create: `src/hooks/useActiveAnnouncement.ts`

- [ ] **Step 1: Write the hook**

```typescript
// src/hooks/useActiveAnnouncement.ts
'use client'

import { useEffect, useState } from 'react'
import type { Announcement } from '@/lib/announcement'

const POLL_MS = 60_000

/**
 * Fetches the active site announcement and re-polls every 60s so a freshly
 * published/retired alert appears/disappears without a manual reload. Returns
 * null until loaded and whenever there is no active announcement.
 */
export function useActiveAnnouncement(): Announcement | null {
  const [data, setData] = useState<Announcement | null>(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      fetch('/api/announcements/active')
        .then((r) => (r.ok ? r.json() : { announcement: null }))
        .then((d: { announcement: Announcement | null }) => {
          if (alive) setData(d.announcement)
        })
        .catch(() => {})
    load()
    const id = setInterval(load, POLL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  return data
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit -p tsconfig.json` (or rely on the dev server compiling without error when the component in Task 5 imports it).
Expected: no type errors referencing this file.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useActiveAnnouncement.ts
git commit -m "feat(announcements): useActiveAnnouncement polling hook"
```

---

### Task 5: AlertBanner component (main app)

**Files:**
- Create: `src/components/announcements/AlertBanner.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/announcements/AlertBanner.tsx
'use client'

import { useEffect, useState } from 'react'
import { useActiveAnnouncement } from '@/hooks/useActiveAnnouncement'
import { dismissalKey, isDismissed, type AnnouncementType } from '@/lib/announcement'

const STORAGE_KEY = 'dismissed_announcement'

// Severity → colors. Matches the approved mockup (blue / amber / red).
const STYLES: Record<AnnouncementType, { bg: string; fg: string; border: string; icon: string }> = {
  info: { bg: '#10202e', fg: '#bfe2ff', border: '#1d3a52', icon: 'ⓘ' },
  warning: { bg: '#2a2210', fg: '#ffe7b0', border: '#4a3a14', icon: '⚠' },
  critical: { bg: '#2c1213', fg: '#ffd2d2', border: '#5a1f22', icon: '⛔' },
}

/**
 * Site-wide alert banner. Rendered in normal document flow at the very top of
 * the app (above the page's sticky header), so it pushes content down and
 * scrolls away on scroll rather than fighting the header for top:0. Dismissal
 * is keyed on id:updated_at — editing the copy re-shows it.
 */
export function AlertBanner() {
  const announcement = useActiveAnnouncement()
  // null until we've read localStorage on the client (avoids SSR/client mismatch).
  const [dismissedValue, setDismissedValue] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      setDismissedValue(localStorage.getItem(STORAGE_KEY))
    } catch {
      setDismissedValue(null)
    }
    setHydrated(true)
  }, [])

  if (!hydrated || !announcement) return null
  if (isDismissed(announcement, dismissedValue)) return null

  const s = STYLES[announcement.type] ?? STYLES.info

  const dismiss = () => {
    const key = dismissalKey(announcement)
    try {
      localStorage.setItem(STORAGE_KEY, key)
    } catch {
      /* private mode — banner just won't persist dismissal */
    }
    setDismissedValue(key)
  }

  return (
    <div
      role="status"
      style={{
        width: '100%',
        maxWidth: 500,
        margin: '0 auto',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        background: s.bg,
        color: s.fg,
        borderBottom: `1px solid ${s.border}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 12px',
          fontSize: 13,
          lineHeight: 1.35,
          fontWeight: 500,
        }}
      >
        <span aria-hidden style={{ flex: '0 0 auto' }}>{s.icon}</span>
        <span style={{ flex: 1 }}>{announcement.message}</span>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss announcement"
          style={{
            flex: '0 0 auto',
            background: 'none',
            border: 'none',
            color: 'inherit',
            opacity: 0.7,
            cursor: 'pointer',
            fontSize: 15,
            lineHeight: 1,
            padding: '2px 4px',
          }}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/announcements/AlertBanner.tsx
git commit -m "feat(announcements): AlertBanner component"
```

---

### Task 6: Mount the banner in the locale layout

**Files:**
- Modify: `src/app/[locale]/layout.tsx`

- [ ] **Step 1: Add the import**

Add alongside the existing chrome imports (after the `StickyAdBanner` import on line 12):

```typescript
import { AlertBanner } from '@/components/announcements/AlertBanner'
```

- [ ] **Step 2: Render it before `{children}`**

Change the body of `NotificationNudgeProvider` from:

```tsx
          <NotificationNudgeProvider>
            {children}
            <ConsentBanner />
            <PWAInstallNudge />
            <StickyAdBanner />
          </NotificationNudgeProvider>
```

to (the banner goes FIRST so it sits above the page header in document flow and pushes content down):

```tsx
          <NotificationNudgeProvider>
            <AlertBanner />
            {children}
            <ConsentBanner />
            <PWAInstallNudge />
            <StickyAdBanner />
          </NotificationNudgeProvider>
```

- [ ] **Step 3: Seed a test row and verify in the browser**

Insert a test announcement directly (dashboard SQL editor or CLI):

```sql
insert into site_announcements (message, type, active)
values ('Matches suspended due to court conditions. Updates to follow.', 'warning', true);
```

Then, with the dev server running, follow the preview verification workflow: load the home page, confirm the amber banner shows at the very top above the header, click ✕ to dismiss, reload and confirm it stays dismissed. Update the row's `message` (which bumps `updated_at` only if Task 7's PUT is used; for this manual check, run `update site_announcements set message = 'Updated copy', updated_at = now() where active`) and confirm it reappears after the ~60s poll or a reload. Capture a screenshot as proof.

- [ ] **Step 4: Clean up the test row**

```sql
delete from site_announcements where message in ('Matches suspended due to court conditions. Updates to follow.', 'Updated copy');
```

- [ ] **Step 5: Commit**

```bash
git add src/app/[locale]/layout.tsx
git commit -m "feat(announcements): mount AlertBanner at top of app"
```

---

### Task 7: Ops list + create API (apps/ops)

**Files:**
- Create: `apps/ops/src/app/api/internal/announcements/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// apps/ops/src/app/api/internal/announcements/route.ts
// List + create site announcements. Auth: Auth.js session (isOperator).
// All writes go through the service-key client (bypasses RLS). Mirrors the
// shape of /api/internal/news.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

const ALLOWED_TYPES = ['info', 'warning', 'critical'] as const
type AnnouncementType = (typeof ALLOWED_TYPES)[number]

// GET: list all announcements, newest first.
export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('site_announcements')
    .select('id, message, type, active, starts_at, expires_at, updated_at, created_at')
    .order('updated_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ announcements: data ?? [] })
}

// POST: create a new announcement.
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: {
    message?: string
    type?: string
    active?: boolean
    starts_at?: string | null
    expires_at?: string | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.message || typeof body.message !== 'string' || !body.message.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }
  if (!ALLOWED_TYPES.includes(body.type as AnnouncementType)) {
    return NextResponse.json(
      { error: `type must be one of ${ALLOWED_TYPES.join(', ')}` },
      { status: 400 },
    )
  }

  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('site_announcements')
    .insert({
      message: body.message.trim(),
      type: body.type,
      active: body.active === true,
      starts_at: body.starts_at || null,
      expires_at: body.expires_at || null,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
  }
  return NextResponse.json({ announcement: data })
}
```

- [ ] **Step 2: Verify it compiles**

Start the ops dev server (`cd apps/ops && npm run dev` — port 3004) if not running, then with an operator session:
Run: `curl -s http://localhost:3004/api/internal/announcements`
Expected: `401 {"error":"unauthorized"}` when unauthenticated (proves the route is wired and auth-gated). No compile error in the server log.

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/app/api/internal/announcements/route.ts
git commit -m "feat(ops): list + create announcements API"
```

---

### Task 8: Ops get/update/delete API (apps/ops)

**Files:**
- Create: `apps/ops/src/app/api/internal/announcements/[id]/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// apps/ops/src/app/api/internal/announcements/[id]/route.ts
// GET / PUT / DELETE a single announcement. Auth: Auth.js session (isOperator).
// PUT bumps updated_at so dismissals reset when copy changes.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

const ALLOWED_TYPES = ['info', 'warning', 'critical'] as const
type AnnouncementType = (typeof ALLOWED_TYPES)[number]

interface Ctx {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const supabase = serviceClient()
  const { id } = await params
  const { data, error } = await supabase
    .from('site_announcements')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ announcement: data })
}

export async function PUT(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await params

  let body: {
    message?: string
    type?: string
    active?: boolean
    starts_at?: string | null
    expires_at?: string | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.message || typeof body.message !== 'string' || !body.message.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }
  if (!ALLOWED_TYPES.includes(body.type as AnnouncementType)) {
    return NextResponse.json(
      { error: `type must be one of ${ALLOWED_TYPES.join(', ')}` },
      { status: 400 },
    )
  }

  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('site_announcements')
    .update({
      message: body.message.trim(),
      type: body.type,
      active: body.active === true,
      starts_at: body.starts_at || null,
      expires_at: body.expires_at || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })
  }
  return NextResponse.json({ announcement: data })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const supabase = serviceClient()
  const { id } = await params
  const { error } = await supabase.from('site_announcements').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Verify it compiles**

Confirm the ops dev server compiles the new route with no error in its log (it will be exercised end-to-end in Task 11).

- [ ] **Step 3: Commit**

```bash
git add "apps/ops/src/app/api/internal/announcements/[id]/route.ts"
git commit -m "feat(ops): get/update/delete announcement API"
```

---

### Task 9: Ops Announcements page + manager UI (apps/ops)

**Files:**
- Create: `apps/ops/src/app/(app)/announcements/page.tsx`
- Create: `apps/ops/src/app/(app)/announcements/_components/AnnouncementsManager.tsx`

- [ ] **Step 1: Write the page wrapper**

```tsx
// apps/ops/src/app/(app)/announcements/page.tsx
import { PageHeader } from '@/components/ui'
import { AnnouncementsManager } from './_components/AnnouncementsManager'

export const metadata = { title: 'Announcements · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default function AnnouncementsPage() {
  return (
    <div className="ui-page">
      <PageHeader
        title="Announcements"
        subtitle="One site-wide alert banner shows at a time across the user app. Editing the message re-shows it to users who dismissed the previous version."
      />
      <AnnouncementsManager />
    </div>
  )
}
```

- [ ] **Step 2: Write the manager component**

```tsx
// apps/ops/src/app/(app)/announcements/_components/AnnouncementsManager.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Panel, DataTable, Field, Pill, Button, Skeleton, EmptyState } from '@/components/ui'

type AnnouncementType = 'info' | 'warning' | 'critical'

interface Announcement {
  id: string
  message: string
  type: AnnouncementType
  active: boolean
  starts_at: string | null
  expires_at: string | null
  updated_at: string
  created_at: string
}

const TYPES: AnnouncementType[] = ['info', 'warning', 'critical']
const EMPTY = { message: '', type: 'info' as AnnouncementType, active: false, starts_at: '', expires_at: '' }

// datetime-local <-> ISO helpers. datetime-local has no timezone; treat the
// entered value as the operator's local time and store as ISO (UTC).
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromLocalInput(v: string): string | null {
  if (!v) return null
  return new Date(v).toISOString()
}

function statusLabel(a: Announcement): { label: string; tone: 'live' | 'muted' } {
  const now = Date.now()
  const started = !a.starts_at || Date.parse(a.starts_at) <= now
  const expired = !!a.expires_at && Date.parse(a.expires_at) <= now
  if (!a.active) return { label: 'off', tone: 'muted' }
  if (expired) return { label: 'expired', tone: 'muted' }
  if (!started) return { label: 'scheduled', tone: 'muted' }
  return { label: 'LIVE', tone: 'live' }
}

export function AnnouncementsManager() {
  const [rows, setRows] = useState<Announcement[] | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/internal/announcements')
      .then((r) => r.json())
      .then((d) => setRows(d.announcements ?? []))
      .catch(() => setRows([]))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const reset = () => {
    setForm({ ...EMPTY })
    setEditingId(null)
    setError(null)
  }

  const edit = (a: Announcement) => {
    setEditingId(a.id)
    setForm({
      message: a.message,
      type: a.type,
      active: a.active,
      starts_at: toLocalInput(a.starts_at),
      expires_at: toLocalInput(a.expires_at),
    })
    setError(null)
  }

  const save = async (publish: boolean) => {
    setSaving(true)
    setError(null)
    const payload = {
      message: form.message,
      type: form.type,
      active: publish,
      starts_at: fromLocalInput(form.starts_at),
      expires_at: fromLocalInput(form.expires_at),
    }
    const url = editingId
      ? `/api/internal/announcements/${editingId}`
      : '/api/internal/announcements'
    const res = await fetch(url, {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error ?? 'Save failed')
      return
    }
    reset()
    load()
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this announcement?')) return
    await fetch(`/api/internal/announcements/${id}`, { method: 'DELETE' })
    if (editingId === id) reset()
    load()
  }

  return (
    <>
      <Panel title={editingId ? 'Edit announcement' : 'New announcement'}>
        <Field label="Message">
          <textarea
            value={form.message}
            onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
            rows={2}
            placeholder="Matches suspended due to court conditions. Updates to follow."
            style={{ width: '100%' }}
          />
        </Field>

        <Field label="Severity">
          <div style={{ display: 'flex', gap: 8 }}>
            {TYPES.map((t) => (
              <Button
                key={t}
                variant={form.type === t ? 'primary' : 'ghost'}
                onClick={() => setForm((f) => ({ ...f, type: t }))}
              >
                {t[0].toUpperCase() + t.slice(1)}
              </Button>
            ))}
          </div>
        </Field>

        <div style={{ display: 'flex', gap: 16 }}>
          <Field label="Starts (optional)">
            <input
              type="datetime-local"
              value={form.starts_at}
              onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))}
            />
          </Field>
          <Field label="Expires (optional)">
            <input
              type="datetime-local"
              value={form.expires_at}
              onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
            />
          </Field>
        </div>

        {error && <p style={{ color: 'var(--danger, #ff5c5c)' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <Button variant="primary" disabled={saving || !form.message.trim()} onClick={() => save(true)}>
            {editingId ? 'Save & publish' : 'Publish'}
          </Button>
          <Button variant="ghost" disabled={saving || !form.message.trim()} onClick={() => save(false)}>
            Save as off
          </Button>
          {editingId && (
            <Button variant="ghost" onClick={reset}>
              Cancel
            </Button>
          )}
        </div>
      </Panel>

      <Panel title="All announcements">
        {rows === null ? (
          <Skeleton />
        ) : rows.length === 0 ? (
          <EmptyState>No announcements yet.</EmptyState>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>Status</th>
                <th>Type</th>
                <th>Message</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const st = statusLabel(a)
                return (
                  <tr key={a.id}>
                    <td><Pill tone={st.tone === 'live' ? 'live' : 'muted'}>{st.label}</Pill></td>
                    <td>{a.type}</td>
                    <td style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.message}
                    </td>
                    <td>{new Date(a.updated_at).toLocaleString()}</td>
                    <td style={{ display: 'flex', gap: 8 }}>
                      <Button variant="ghost" onClick={() => edit(a)}>Edit</Button>
                      <Button variant="ghost" onClick={() => remove(a.id)}>Delete</Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </DataTable>
        )}
      </Panel>
    </>
  )
}
```

- [ ] **Step 3: Reconcile primitive APIs**

The `Panel`, `Field`, `Pill`, `Button`, `DataTable`, `Skeleton`, `EmptyState` props used above (`Panel title=`, `Field label=`, `Pill tone=`, `Button variant=`) are assumptions based on the news tab. Open `apps/ops/src/components/ui/Panel.tsx`, `Pill.tsx`, and `DataTable.tsx` and adjust the prop names/usages in this component to match the real signatures (e.g. if `Button` uses `kind` instead of `variant`, or `Pill` takes a `color`). This is a mechanical reconcile — keep the structure, fix the prop names.

- [ ] **Step 4: Verify the page renders**

With the ops dev server running and an operator session, navigate to `http://localhost:3004/announcements`. Confirm the form and empty table render with no console errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/ops/src/app/(app)/announcements/page.tsx" "apps/ops/src/app/(app)/announcements/_components/AnnouncementsManager.tsx"
git commit -m "feat(ops): announcements management page"
```

---

### Task 10: Add Announcements to the ops nav rail

**Files:**
- Modify: `apps/ops/src/components/shell/Rail.tsx:35-40`

- [ ] **Step 1: Add the nav item under the "Content" group**

In the `Content` group's `items` array, add an Announcements entry as the first item:

```tsx
  { label: 'Content', items: [
    { href: '/announcements', label: 'Announcements', icon: 'flag' },
    { href: '/news', label: 'News', icon: 'doc' },
    { href: '/news-sources', label: 'News Sources', icon: 'list' },
    { href: '/highlights', label: 'Highlights', icon: 'film' },
    { href: '/team-image', label: 'Team Image', icon: 'film' },
  ]},
```

(If no `flag` icon renders, pick another id present in `apps/ops/src/components/IconSprite` — e.g. `doc` or `tag`.)

- [ ] **Step 2: Verify**

Reload the ops app; confirm "Announcements" appears under Content in the rail and links to `/announcements`.

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/components/shell/Rail.tsx
git commit -m "feat(ops): add Announcements to nav rail"
```

---

### Task 11: End-to-end verification + lint

**Files:** none (verification only)

- [ ] **Step 1: Full create→render→dismiss→edit→retire loop**

With both dev servers running (main app :3002, ops :3004) and an operator session in the ops app:
1. In ops `/announcements`, create a **warning** announcement "Matches suspended due to court conditions." and Publish.
2. In the main app, confirm the amber banner appears at the top (within ~60s or on reload). Screenshot.
3. Dismiss it (✕), reload — stays gone.
4. In ops, edit the message and Save & publish.
5. In the main app, confirm the banner reappears (updated copy) after the poll/reload. Screenshot.
6. In ops, edit again and "Save as off" (active=false).
7. Confirm the banner disappears in the main app.
8. Repeat the create step with **critical** and **info** types to confirm red and blue styling. Screenshot each.

- [ ] **Step 2: Lint both apps**

Run: `npm run lint`
Expected: no new errors from the added files.
Run: `cd apps/ops && npm run lint` (if apps/ops has its own lint script; otherwise skip)
Expected: no new errors.

- [ ] **Step 3: Re-run unit tests**

Run: `npx vitest run src/lib/__tests__/announcement.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit any lint fixes**

```bash
git add -A
git commit -m "chore(announcements): lint fixes"
```

---

## Self-Review

**Spec coverage:**
- DB-backed, ops-managed → Tasks 1, 7, 8, 9, 10. ✓
- Top-of-app placement, pushes content down → Task 5 (flow element) + Task 6 (mount before children). ✓
- Three severities with distinct styling → Task 5 `STYLES` map + Task 9 severity control. ✓
- Dismissible, re-show on change → Task 2 (`dismissalKey`/`isDismissed` on `id:updated_at`) + Task 5 + Task 8 (PUT bumps `updated_at`). ✓
- Site-wide, one at a time, newest wins → Task 2 `selectActiveAnnouncement` + Task 3 route. ✓
- No deploy to change copy → all content lives in `site_announcements`, edited via ops. ✓
- Anon-readable active rows / service-key writes → Task 1 RLS + read route uses service client (like `ads/active`). ✓
- Fail-safe (never shows broken bar) → Task 3 catch → null; Task 5 renders nothing on null. ✓

**Placeholder scan:** No TBD/TODO. The only deliberate "reconcile" step is Task 9 Step 3 (UI primitive prop names) — flagged because the exact signatures must be read from source; structure and code are otherwise complete.

**Type consistency:** `Announcement` type defined in `src/lib/announcement.ts` (Task 2), imported by the read route (Task 3) and hook (Task 4). The ops app redefines the same shape locally (separate package, no shared types module) — columns match the migration (Task 1). `selectActiveAnnouncement`, `dismissalKey`, `isDismissed` names are consistent across Tasks 2, 3, 5. `STORAGE_KEY = 'dismissed_announcement'` defined and used only in Task 5.

# Admin Ops App — Phase 1.B: Sidebar IA + Today Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the daily-driver homepage for `admin.padelnachos.com` — a real sidebar with the five nav groups from the spec, the Today page with KPI strip + LIVE NOW + REQUIRES ATTENTION + TODAY'S SCHEDULE + status pill, and the two internal endpoints that feed them.

**Architecture:** Sidebar is a client component owning collapse state and badge polling. The Today page is a server component that calls a server-side aggregator (no HTTP fanout). Two internal endpoints: `GET /api/internal/today` (full Today payload) and `GET /api/internal/needs-review/counts` (sidebar badge poll). Aggregator logic is ported from the main app's `/ops/api/status` and `/api/ops/launch-monitor` routes, adapted to direct Supabase access (per the spec).

**Tech Stack:** Next.js 16.2 · React 19 · TypeScript 5 · Tailwind 4 · `@supabase/supabase-js` · `vitest`. No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-05-20-admin-ops-app-design.md`](../specs/2026-05-20-admin-ops-app-design.md) — Visual Reference (mockups) section is the canonical UI source; Information Architecture section is the canonical nav structure.

**Predecessor:** [`2026-05-20-admin-ops-foundation.md`](2026-05-20-admin-ops-foundation.md) — Plan 1 (scaffold + auth + login pages). All Plan 1 tasks complete (Task 16 deferred indefinitely per errata).

**Worktree:** `.claude/worktrees/admin-ops-app` on branch `worktree-admin-ops-app`.

---

## File structure

New files created by this plan:

```
apps/ops/src/app/(app)/
├── layout.tsx                            (MODIFY — wrap children with <Sidebar>)
├── today/page.tsx                        (REPLACE — the Plan 1 stub becomes the real Today page)
├── tournament-explorer/page.tsx          (stub — "coming in Plan 3")
├── entry-lists/page.tsx                  (stub)
├── needs-review/page.tsx                 (stub)
├── simulator/page.tsx                    (stub)
├── players/page.tsx                      (stub)
├── brands/page.tsx                       (stub)
├── streams/page.tsx                      (stub)
├── news/page.tsx                         (stub)
├── highlights/page.tsx                   (stub)
└── system/
    ├── integration-health/page.tsx       (stub)
    ├── data-quality/page.tsx             (stub)
    ├── padelgod-health/page.tsx          (stub)
    ├── shadow-mode/page.tsx              (stub)
    └── architecture/page.tsx             (stub)

apps/ops/src/components/
├── Sidebar.tsx                           (client component — nav + collapse + badge polling)
├── SidebarNavItem.tsx                    (single nav item, active state)
├── TodayKpiStrip.tsx                     (4 KPI tiles)
├── TodayLiveNow.tsx                      (live matches table)
├── TodayRequiresAttention.tsx            (queue summaries list)
├── TodaySchedule.tsx                     (hour buckets)
└── TodayStatusPill.tsx                   (footer green/yellow/red)

apps/ops/src/lib/
├── today-aggregator.ts                   (pure server-side aggregator — Supabase queries)
└── needs-review-counts.ts                (tiny counts function)

apps/ops/src/app/api/internal/
├── today/route.ts                        (GET → today-aggregator)
└── needs-review/counts/route.ts          (GET → needs-review-counts)

apps/ops/tests/
├── today-aggregator.test.ts              (TDD — mocked Supabase)
└── needs-review-counts.test.ts           (TDD — mocked Supabase)
```

**Reference files in the main app (read-only — port logic, don't import):**

- `src/app/ops/api/status/route.ts` — current dashboard data shape; source for live count, stale matches, cron health, ongoing events
- `src/app/api/ops/launch-monitor/route.ts` — source for tournament-level KPIs (signups, active users, etc. — most of which we'll skip for v1)
- `src/app/ops/OpsClient.tsx` — current sidebar (lines ~462-580) — reference for the collapsed-icon-strip pattern and active-state styling

---

## Plan-level reminders (apply to every task)

- **Variation 2 design tokens** are loaded via `globals.css` (Plan 1 Task 2). Use `var(--*)` consistently; no hex literals in component styles.
- **No emojis** in code, mockups, or copy (per CLAUDE.md `feedback_no_emojis`).
- **TDD discipline** for backend logic (aggregator, counts). Visual smoke for UI.
- **Commit per task** with the message exactly as shown in the task's final step.

---

## Task 1: Stub pages for all sidebar destinations

**Files:**
- Create: 14 stub pages under `apps/ops/src/app/(app)/` (paths in the file structure above)

**Why first:** the sidebar component you build in Task 2 has `<Link>` nodes pointing at these routes. If any route 404s the test loop is annoying. Plan 3 replaces each stub with the real lifted tab.

- [ ] **Step 1: Create a reusable stub helper**

```tsx
// apps/ops/src/components/PlanStub.tsx
// Placeholder used by every (app)/<route>/page.tsx that Plan 3 will fill in.
// Same visual shell so navigation always feels alive even before the real
// tab lands.

export function PlanStub({ title, plan = 'Plan 3' }: { title: string; plan?: string }) {
  return (
    <div
      style={{
        padding: 32,
        maxWidth: 720,
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px' }}>{title}</h1>
      <p style={{ fontSize: 14, color: 'var(--status-neutral)', margin: 0 }}>
        Coming in <strong>{plan}</strong>.
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Create stub pages — one shape, 14 routes**

Run this from the worktree root to create all 14 stubs at once:

```bash
mkdir -p \
  'apps/ops/src/app/(app)/tournament-explorer' \
  'apps/ops/src/app/(app)/entry-lists' \
  'apps/ops/src/app/(app)/needs-review' \
  'apps/ops/src/app/(app)/simulator' \
  'apps/ops/src/app/(app)/players' \
  'apps/ops/src/app/(app)/brands' \
  'apps/ops/src/app/(app)/streams' \
  'apps/ops/src/app/(app)/news' \
  'apps/ops/src/app/(app)/highlights' \
  'apps/ops/src/app/(app)/system/integration-health' \
  'apps/ops/src/app/(app)/system/data-quality' \
  'apps/ops/src/app/(app)/system/padelgod-health' \
  'apps/ops/src/app/(app)/system/shadow-mode' \
  'apps/ops/src/app/(app)/system/architecture'
```

Then create each `page.tsx`. Each file looks like:

```tsx
// apps/ops/src/app/(app)/tournament-explorer/page.tsx
import { PlanStub } from '@/components/PlanStub'

export const metadata = { title: 'Tournament Explorer · PadelNachos Admin' }

export default function Page() {
  return <PlanStub title="Tournament Explorer" />
}
```

Repeat for the other 13 routes, swapping the title:

| Route | Title |
|---|---|
| `tournament-explorer/page.tsx` | `Tournament Explorer` |
| `entry-lists/page.tsx` | `Entry Lists` |
| `needs-review/page.tsx` | `Needs Review` |
| `simulator/page.tsx` | `Simulator` |
| `players/page.tsx` | `Players` |
| `brands/page.tsx` | `Brands & Equipment` |
| `streams/page.tsx` | `Streams` |
| `news/page.tsx` | `News` |
| `highlights/page.tsx` | `Highlights` |
| `system/integration-health/page.tsx` | `Integration Health` |
| `system/data-quality/page.tsx` | `Data Quality` |
| `system/padelgod-health/page.tsx` | `Padelgod Health` |
| `system/shadow-mode/page.tsx` | `Shadow Mode` |
| `system/architecture/page.tsx` | `Architecture` |

- [ ] **Step 3: Smoke-build**

```bash
cd apps/ops && npx next build 2>&1 | tail -25
```

Expected: all 14 new routes appear in the route table, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add 'apps/ops/src/components/PlanStub.tsx' 'apps/ops/src/app/(app)/'
git commit -m "feat(ops): stub pages for all sidebar destinations

14 placeholder routes for Plan 3 destinations: tournament-explorer,
entry-lists, needs-review, simulator, players, brands, streams, news,
highlights, plus 5 system tabs. Each renders PlanStub with the title
and 'Coming in Plan 3' subtitle. Stubs let the sidebar feel alive
ahead of the tab lifts."
```

---

## Task 2: Sidebar component (client)

**Files:**
- Create: `apps/ops/src/components/Sidebar.tsx`
- Create: `apps/ops/src/components/SidebarNavItem.tsx`

The sidebar is a client component because it owns collapse state (localStorage-persisted) and polls `/api/internal/needs-review/counts` every 60s to refresh the badge. Active route detection uses `usePathname()`.

- [ ] **Step 1: Create `SidebarNavItem.tsx`**

```tsx
// apps/ops/src/components/SidebarNavItem.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export interface NavItem {
  href: string
  label: string
  badge?: number | null
}

export function SidebarNavItem({
  item,
  collapsed,
}: {
  item: NavItem
  collapsed: boolean
}) {
  const pathname = usePathname()
  const active = pathname === item.href || pathname.startsWith(item.href + '/')

  const collapsedLabel = item.label
    .split(' ')
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        width: '100%',
        padding: collapsed ? '10px 0' : '8px 16px',
        fontSize: collapsed ? 11 : 13,
        fontWeight: active ? 700 : collapsed ? 600 : 500,
        color: active ? 'var(--brand-primary-fg)' : 'var(--status-neutral)',
        background: active ? 'var(--bg-card)' : 'transparent',
        borderLeft: active
          ? '3px solid var(--brand-primary)'
          : '3px solid transparent',
        letterSpacing: collapsed ? '0.5px' : '0',
        textDecoration: 'none',
      }}
    >
      {collapsed ? collapsedLabel : item.label}
      {item.badge != null && item.badge > 0 && !collapsed && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: '1px 6px',
            borderRadius: 8,
            background: 'var(--status-warn)',
            color: 'var(--brand-primary-fg)',
            minWidth: 18,
            textAlign: 'center',
          }}
        >
          {item.badge}
        </span>
      )}
    </Link>
  )
}
```

- [ ] **Step 2: Create `Sidebar.tsx`**

```tsx
// apps/ops/src/components/Sidebar.tsx
'use client'

import { useEffect, useState } from 'react'
import { SidebarNavItem, type NavItem } from './SidebarNavItem'

interface NavGroup {
  label: string | null
  items: NavItem[]
}

// Canonical IA from docs/superpowers/specs/2026-05-20-admin-ops-app-design.md
// "Information architecture → New sidebar". Plan 3 fills in the tab pages;
// Plan 1 + this file ship the nav itself.
const NAV_GROUPS: ReadonlyArray<NavGroup> = [
  {
    label: null,
    items: [{ href: '/today', label: 'Today' }],
  },
  {
    label: 'Tournament Ops',
    items: [
      { href: '/tournament-explorer', label: 'Tournament Explorer' },
      { href: '/entry-lists', label: 'Entry Lists' },
      { href: '/needs-review', label: 'Needs Review' },
      { href: '/simulator', label: 'Simulator' },
    ],
  },
  {
    label: 'Catalogs',
    items: [
      { href: '/players', label: 'Players' },
      { href: '/brands', label: 'Brands & Equipment' },
      { href: '/streams', label: 'Streams' },
    ],
  },
  {
    label: 'Content',
    items: [
      { href: '/news', label: 'News' },
      { href: '/highlights', label: 'Highlights' },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/system/integration-health', label: 'Integration Health' },
      { href: '/system/data-quality', label: 'Data Quality' },
      { href: '/system/padelgod-health', label: 'Padelgod Health' },
      { href: '/system/shadow-mode', label: 'Shadow Mode' },
      { href: '/system/architecture', label: 'Architecture' },
    ],
  },
] as const

const COLLAPSE_KEY = 'ops.sidebar.collapsed'

export function Sidebar({ userEmail }: { userEmail?: string | null }) {
  const [collapsed, setCollapsed] = useState(false)
  const [needsReviewCount, setNeedsReviewCount] = useState<number | null>(null)

  // Restore collapsed state from localStorage on mount.
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(COLLAPSE_KEY)
      if (v === '1') setCollapsed(true)
    } catch {
      /* localStorage blocked in private mode etc. — fine */
    }
  }, [])

  // Persist on change.
  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      /* fine */
    }
  }, [collapsed])

  // Poll Needs Review count every 60s.
  useEffect(() => {
    let cancelled = false
    async function pull() {
      try {
        const r = await fetch('/api/internal/needs-review/counts', { cache: 'no-store' })
        if (!r.ok) return
        const json = (await r.json()) as { duplicates?: number }
        if (!cancelled) setNeedsReviewCount(json.duplicates ?? 0)
      } catch {
        /* network blip — keep last value */
      }
    }
    pull()
    const id = setInterval(pull, 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  // Inject the live badge count into the Needs Review nav item.
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.map((i) =>
      i.href === '/needs-review' ? { ...i, badge: needsReviewCount } : i,
    ),
  }))

  return (
    <nav
      style={{
        width: collapsed ? 44 : 232,
        flexShrink: 0,
        background: 'var(--bg-canvas)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'auto',
        transition: 'width 180ms ease-out',
        height: '100vh',
        position: 'sticky',
        top: 0,
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: collapsed ? '14px 12px' : '14px 16px',
          color: 'var(--status-neutral)',
          fontSize: 14,
          lineHeight: 1,
          fontWeight: 700,
          textAlign: collapsed ? 'center' : 'right',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        {collapsed ? '›' : '‹'}
      </button>

      {!collapsed && (
        <div style={{ padding: '14px 16px 12px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--brand-primary-fg)' }}>
            Padel Nachos Admin
          </div>
        </div>
      )}

      <div style={{ flex: 1, padding: '4px 0' }}>
        {groups.map((group, gi) => (
          <div key={gi} style={{ marginBottom: 4 }}>
            {group.label && !collapsed && (
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: 'var(--status-neutral)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  padding: '12px 16px 4px',
                }}
              >
                {group.label}
              </div>
            )}
            {group.label && collapsed && gi > 0 && (
              <div
                style={{
                  height: 1,
                  background: 'var(--border-subtle)',
                  margin: '8px 8px',
                }}
              />
            )}
            {group.items.map((item) => (
              <SidebarNavItem key={item.href} item={item} collapsed={collapsed} />
            ))}
          </div>
        ))}
      </div>

      {!collapsed && userEmail && (
        <div
          style={{
            borderTop: '1px solid var(--border-subtle)',
            padding: '12px 16px',
            fontSize: 11,
            color: 'var(--status-neutral)',
          }}
        >
          <div style={{ marginBottom: 2 }}>Signed in as</div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--brand-primary-fg)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {userEmail}
          </div>
        </div>
      )}
    </nav>
  )
}
```

- [ ] **Step 3: Smoke-build (the sidebar isn't wired in yet — just verify no syntax errors)**

```bash
cd apps/ops && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/ops/src/components/Sidebar.tsx apps/ops/src/components/SidebarNavItem.tsx
git commit -m "feat(ops): sidebar component with collapse + nav

Client component. Five nav groups per the spec's IA: HOME, Tournament Ops,
Catalogs, Content, System. localStorage-persisted collapse state.
Active-route highlight via usePathname. Needs Review badge polls
/api/internal/needs-review/counts every 60s (404s gracefully until
Task 4 lands the endpoint)."
```

---

## Task 3: Wire sidebar into `(app)/layout.tsx`

**Files:**
- Modify: `apps/ops/src/app/(app)/layout.tsx`

- [ ] **Step 1: Update the layout to render sidebar + content side-by-side**

Open `apps/ops/src/app/(app)/layout.tsx` (Plan 1 Task 10). Replace its body with:

```tsx
// apps/ops/src/app/(app)/layout.tsx
// Auth + operator gate, plus the sidebar shell for every (app)/ route.
// The sidebar (client component) owns collapse state + badge polling;
// the layout passes the operator's email through for the footer.

import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/Sidebar'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) {
    redirect('/login')
  }
  if (!session.user.isOperator) {
    redirect('/not-authorized')
  }
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        background: 'var(--bg-canvas)',
      }}
    >
      <Sidebar userEmail={session.user.email ?? null} />
      <main style={{ flex: 1, minWidth: 0 }}>{children}</main>
    </div>
  )
}
```

- [ ] **Step 2: Smoke-build**

```bash
cd apps/ops && npx next build 2>&1 | tail -20
```

Expected: builds. (Routes won't change.)

- [ ] **Step 3: Visual check**

Start the dev server (or if already running, refresh):

```bash
cd apps/ops && npm run dev  # if not already running
```

Visit `http://localhost:3004/today`. You should see:

- A 232px-wide sidebar on the left with the title "Padel Nachos Admin"
- Five nav groups in order: (unlabeled with Today) · TOURNAMENT OPS · CATALOGS · CONTENT · SYSTEM
- "Today" highlighted as the active item (green left border, white card background)
- Footer at the bottom showing your email
- The Today stub (Plan 1 page) renders in the right column
- Clicking the chevron at the top collapses to a ~44px icon strip with 1-2 letter labels
- Clicking any nav item navigates (stubs render "Coming in Plan 3")

- [ ] **Step 4: Commit**

```bash
git add 'apps/ops/src/app/(app)/layout.tsx'
git commit -m "feat(ops): wire Sidebar into (app)/layout

(app) routes now render the sidebar shell + content side-by-side.
Sidebar receives userEmail from session for the footer."
```

---

## Task 4: `GET /api/internal/needs-review/counts` (TDD)

**Files:**
- Create: `apps/ops/src/lib/needs-review-counts.ts`
- Create: `apps/ops/tests/needs-review-counts.test.ts`
- Create: `apps/ops/src/app/api/internal/needs-review/counts/route.ts`

This endpoint lights up the sidebar badge from Task 2. Phase 1 of Needs Review (per spec) is the dedup queue only — so the response shape returns a single `duplicates` count. Phase 2 widens the shape without breaking the sidebar.

- [ ] **Step 1: Write the failing test**

```ts
// apps/ops/tests/needs-review-counts.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const queryMock = vi.fn()
vi.mock('../src/lib/db', () => ({
  pgPool: () => ({ query: queryMock }),
}))

import { getNeedsReviewCounts } from '../src/lib/needs-review-counts'

describe('getNeedsReviewCounts', () => {
  beforeEach(() => queryMock.mockReset())

  it('returns the duplicate-cluster count from the cluster_size query', async () => {
    queryMock.mockResolvedValue({ rows: [{ count: '5' }] })
    const r = await getNeedsReviewCounts()
    expect(r).toEqual({ duplicates: 5 })
  })

  it('returns 0 when no clusters exist', async () => {
    queryMock.mockResolvedValue({ rows: [{ count: '0' }] })
    expect(await getNeedsReviewCounts()).toEqual({ duplicates: 0 })
  })

  it('coerces null/undefined count to 0', async () => {
    queryMock.mockResolvedValue({ rows: [{ count: null }] })
    expect(await getNeedsReviewCounts()).toEqual({ duplicates: 0 })
  })

  it('issues exactly one query', async () => {
    queryMock.mockResolvedValue({ rows: [{ count: '3' }] })
    await getNeedsReviewCounts()
    expect(queryMock).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run — confirm RED**

```bash
cd apps/ops && npx vitest run tests/needs-review-counts.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `needs-review-counts.ts`**

Note: the existing `/api/ops/tournament-dedup` endpoint in the main app counts dedup clusters via the `tournament_duplicates` view (or equivalent). For Plan 2 we'll implement a thin lookup against the same source. If the exact SQL is unclear during implementation, read `/Users/GuDenes/Projects/padel-live-scores/src/app/api/ops/tournament-dedup/route.ts` and port the cluster-count query — the rest of its logic is for the full dedup tab UI which we don't need here.

```ts
// apps/ops/src/lib/needs-review-counts.ts
// Returns counts for the Needs Review queue. Phase 1: just duplicate
// clusters. Phase 2 widens the response shape to include unresolved
// players, OOP changes, stream mapping.

import { pgPool } from './db'

export interface NeedsReviewCounts {
  duplicates: number
  // Phase 2 will add:
  // unresolvedPlayers: number
  // oopChanges: number
  // streamMapping: number
}

export async function getNeedsReviewCounts(): Promise<NeedsReviewCounts> {
  const r = await pgPool().query(
    // Counts the number of distinct duplicate clusters that still need a
    // human decision. Adjust this query to match the canonical dedup source
    // when porting (read src/app/api/ops/tournament-dedup/route.ts for the
    // exact view / aggregation used by the main app).
    `select count(*)::text as count from public.tournament_duplicates_pending`,
  )
  const raw = r.rows[0]?.count
  const n = raw == null ? 0 : parseInt(String(raw), 10)
  return { duplicates: Number.isFinite(n) ? n : 0 }
}
```

**Note for implementer:** if `public.tournament_duplicates_pending` doesn't exist in your DB (it might be a view or it might be derived inline in the main-app endpoint), inspect the dedup endpoint's source query and port it verbatim. The function signature + return shape stay the same; only the SQL body changes.

- [ ] **Step 4: Run — confirm GREEN**

```bash
cd apps/ops && npx vitest run tests/needs-review-counts.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Create the route handler**

```ts
// apps/ops/src/app/api/internal/needs-review/counts/route.ts
// GET → sidebar badge poll. Operator-gated via the proxy at (app)/* —
// but this lives under /api/internal/ so middleware doesn't intercept;
// we gate explicitly here via auth().

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getNeedsReviewCounts } from '@/lib/needs-review-counts'

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const counts = await getNeedsReviewCounts()
  return NextResponse.json(counts, {
    headers: { 'cache-control': 'no-store' },
  })
}
```

- [ ] **Step 6: Smoke-build + verify the sidebar badge lights up**

```bash
cd apps/ops && npx next build 2>&1 | tail -10
```

Then refresh `http://localhost:3004/today` — the sidebar's "Needs Review" item should show an amber badge with the count (or no badge if the count is 0).

- [ ] **Step 7: Commit**

```bash
git add apps/ops/src/lib/needs-review-counts.ts apps/ops/tests/needs-review-counts.test.ts 'apps/ops/src/app/api/internal/needs-review/counts/route.ts'
git commit -m "feat(ops): GET /api/internal/needs-review/counts

Sidebar badge poll. Phase 1 response shape: { duplicates: number }.
Phase 2 widens with unresolvedPlayers/oopChanges/streamMapping.
Operator-gated via auth() inside the handler (route lives outside
the (app)/ group). TDD-covered."
```

---

## Task 5: Today aggregator + `GET /api/internal/today` (TDD)

**Files:**
- Create: `apps/ops/src/lib/today-aggregator.ts`
- Create: `apps/ops/tests/today-aggregator.test.ts`
- Create: `apps/ops/src/app/api/internal/today/route.ts`

The Today page reads everything through the aggregator — KPIs, live matches, requires-attention summaries, schedule lookahead, and system status pill. One endpoint, one DB round-trip cluster.

- [ ] **Step 1: Write the failing test**

```ts
// apps/ops/tests/today-aggregator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const queryMock = vi.fn()
vi.mock('../src/lib/db', () => ({
  pgPool: () => ({ query: queryMock }),
}))

const countsMock = vi.fn()
vi.mock('../src/lib/needs-review-counts', () => ({
  getNeedsReviewCounts: countsMock,
}))

import { getTodayPayload } from '../src/lib/today-aggregator'

describe('getTodayPayload', () => {
  beforeEach(() => {
    queryMock.mockReset()
    countsMock.mockReset()
  })

  it('returns a complete payload shape', async () => {
    // Order the queries in the same order the aggregator calls them
    // (live-matches, scheduled-today, finished-today, stale, schedule-buckets)
    queryMock
      .mockResolvedValueOnce({ rows: [{ count: '3' }] })       // live count
      .mockResolvedValueOnce({ rows: [] })                      // live rows
      .mockResolvedValueOnce({ rows: [{ count: '12' }] })      // scheduled today
      .mockResolvedValueOnce({ rows: [{ count: '8' }] })       // finished today
      .mockResolvedValueOnce({ rows: [] })                      // stale
      .mockResolvedValueOnce({ rows: [] })                      // schedule buckets
    countsMock.mockResolvedValue({ duplicates: 5 })

    const p = await getTodayPayload()
    expect(p).toMatchObject({
      kpis: expect.objectContaining({
        liveMatches: 3,
        needsReview: 5,
      }),
      liveNow: [],
      requiresAttention: expect.any(Array),
      schedule: [],
      systemStatus: expect.stringMatching(/^(green|yellow|red)$/),
    })
  })

  it('marks systemStatus red when stale matches exist', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'm1', external_id: 'x', updated_at: '2026-05-20T00:00:00Z' }] })
      .mockResolvedValueOnce({ rows: [] })
    countsMock.mockResolvedValue({ duplicates: 0 })

    const p = await getTodayPayload()
    expect(p.systemStatus).toBe('red')
  })

  it('marks systemStatus green with no stale + no urgent flags', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    countsMock.mockResolvedValue({ duplicates: 0 })

    const p = await getTodayPayload()
    expect(p.systemStatus).toBe('green')
  })

  it('requires-attention includes the duplicates count', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    countsMock.mockResolvedValue({ duplicates: 7 })

    const p = await getTodayPayload()
    const dup = p.requiresAttention.find((r) => r.key === 'duplicates')
    expect(dup).toBeDefined()
    expect(dup?.count).toBe(7)
  })
})
```

- [ ] **Step 2: Run — confirm RED**

```bash
cd apps/ops && npx vitest run tests/today-aggregator.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `today-aggregator.ts`**

Read the existing main-app endpoint first to understand the data shape:
- `/Users/GuDenes/Projects/padel-live-scores/src/app/ops/api/status/route.ts` — current dashboard data
- `/Users/GuDenes/Projects/padel-live-scores/src/app/api/ops/launch-monitor/route.ts` — launch monitors

You're porting the SQL/logic for: live match count + sample, today's scheduled/finished counts, stale-match detection (live > 15min and not in latest sync), and the schedule lookahead bucketed by hour.

```ts
// apps/ops/src/lib/today-aggregator.ts
// Server-side aggregator for the Today page. One function, multiple
// indexed reads against Supabase. Designed to be cheap enough to poll
// every 30-60s from the client.
//
// Logic ported from src/app/ops/api/status/route.ts and the relevant
// pieces of src/app/api/ops/launch-monitor/route.ts in the main app.
// The original endpoints stay in place; this is the canonical Today
// source under apps/ops/.

import { pgPool } from './db'
import { getNeedsReviewCounts } from './needs-review-counts'

export interface LiveMatchRow {
  matchId: string
  court: string | null
  tournamentName: string | null
  pair1: string
  pair2: string
  setScores: string[]          // e.g. ['6-3', '4-0']
  startedAt: string | null
  status: 'live' | 'on_court'
}

export interface RequiresAttentionRow {
  key: 'duplicates' | 'unresolvedPlayers' | 'oopChanges' | 'streamMapping'
  label: string
  count: number
  href: string                  // sidebar destination filter
}

export interface ScheduleBucket {
  hour: string                  // local-time formatted "HH:00"
  matchCount: number
  roundLabels: string[]         // e.g. ['Round of 16']
}

export interface TodayPayload {
  fetchedAt: string             // ISO timestamp
  kpis: {
    liveMatches: number
    needsReview: number
    oopPending: number          // Phase 2 — 0 for now
    streamsLive: number          // Phase 2 — 0 for now
  }
  liveNow: LiveMatchRow[]
  requiresAttention: RequiresAttentionRow[]
  schedule: ScheduleBucket[]
  systemStatus: 'green' | 'yellow' | 'red'
}

const STALE_MATCH_MINUTES = 15

export async function getTodayPayload(): Promise<TodayPayload> {
  const pool = pgPool()

  // 1. Live match count
  const liveCountRes = await pool.query(
    `select count(*)::text as count from public.matches
       where status in ('live', 'on_court')`,
  )
  const liveMatches = parseInt(liveCountRes.rows[0]?.count ?? '0', 10)

  // 2. Live match sample (up to 12 rows; the LIVE NOW table caps display at 5)
  const liveRowsRes = await pool.query(
    `select m.id as match_id,
            m.court,
            m.status,
            m.scheduled_at as started_at,
            t.name as tournament_name,
            (select string_agg(set_score, ',') from public.sets s where s.match_id = m.id) as set_scores_csv,
            p1.name as p1_name, p2.name as p2_name, p3.name as p3_name, p4.name as p4_name
       from public.matches m
       left join public.tournaments t on t.id = m.tournament_id
       left join public.players p1 on p1.id = m.pair1_player1_id
       left join public.players p2 on p2.id = m.pair1_player2_id
       left join public.players p3 on p3.id = m.pair2_player1_id
       left join public.players p4 on p4.id = m.pair2_player2_id
      where m.status in ('live', 'on_court')
      order by m.scheduled_at desc nulls last
      limit 12`,
  )
  const liveNow: LiveMatchRow[] = liveRowsRes.rows.map((r) => ({
    matchId: r.match_id as string,
    court: r.court as string | null,
    tournamentName: r.tournament_name as string | null,
    pair1: [r.p1_name, r.p2_name].filter(Boolean).join(' / '),
    pair2: [r.p3_name, r.p4_name].filter(Boolean).join(' / '),
    setScores: (r.set_scores_csv as string | null)?.split(',').filter(Boolean) ?? [],
    startedAt: r.started_at as string | null,
    status: r.status as 'live' | 'on_court',
  }))

  // 3. Today's scheduled count (UTC day for now — local-tz refinement in Plan 2 polish)
  const scheduledTodayRes = await pool.query(
    `select count(*)::text as count from public.matches
      where status = 'scheduled'
        and scheduled_at::date = current_date`,
  )
  const scheduledToday = parseInt(scheduledTodayRes.rows[0]?.count ?? '0', 10)

  // 4. Today's finished count
  const finishedTodayRes = await pool.query(
    `select count(*)::text as count from public.matches
      where status in ('finished', 'retired', 'walkover')
        and scheduled_at::date = current_date`,
  )
  const finishedToday = parseInt(finishedTodayRes.rows[0]?.count ?? '0', 10)

  // 5. Stale matches (live > 15min, no recent updates)
  const staleRes = await pool.query(
    `select id, padelapi_id as external_id, updated_at
       from public.matches
      where status = 'live'
        and updated_at < now() - interval '${STALE_MATCH_MINUTES} minutes'
      limit 25`,
  )
  const staleCount = staleRes.rows.length

  // 6. Schedule lookahead — group upcoming matches by hour
  const scheduleRes = await pool.query(
    `select date_trunc('hour', scheduled_at) as bucket,
            count(*)::text as match_count,
            string_agg(distinct round, ', ') as round_labels
       from public.matches
      where status = 'scheduled'
        and scheduled_at >= now()
        and scheduled_at < now() + interval '24 hours'
      group by bucket
      order by bucket asc
      limit 12`,
  )
  const schedule: ScheduleBucket[] = scheduleRes.rows.map((r) => {
    const bucket = new Date(r.bucket as string)
    return {
      hour: bucket.toISOString().slice(11, 16), // "HH:MM" UTC; client localizes
      matchCount: parseInt(r.match_count as string, 10),
      roundLabels: ((r.round_labels as string | null) ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    }
  })

  // 7. Needs Review counts (delegates to the existing module)
  const reviewCounts = await getNeedsReviewCounts()

  // 8. System status roll-up
  let systemStatus: 'green' | 'yellow' | 'red' = 'green'
  if (staleCount > 0) {
    systemStatus = 'red'
  } else if (reviewCounts.duplicates > 10) {
    systemStatus = 'yellow'
  }

  const requiresAttention: RequiresAttentionRow[] = [
    { key: 'duplicates', label: 'Duplicate Matches', count: reviewCounts.duplicates, href: '/needs-review?type=duplicates' },
    // Phase 2 placeholders — surfaced as 0 so the UI shape is stable.
    { key: 'unresolvedPlayers', label: 'Unresolved Players', count: 0, href: '/needs-review?type=unresolvedPlayers' },
    { key: 'oopChanges', label: 'OOP Changes Pending', count: 0, href: '/needs-review?type=oopChanges' },
    { key: 'streamMapping', label: 'Awaiting Stream Mapping', count: 0, href: '/needs-review?type=streamMapping' },
  ]

  // Reference `scheduledToday` and `finishedToday` somewhere — they currently
  // feed the schedule context note in the UI but aren't in the payload
  // contract yet. Keep them computed so the UI can pull them in a follow-up.
  void scheduledToday
  void finishedToday

  return {
    fetchedAt: new Date().toISOString(),
    kpis: {
      liveMatches,
      needsReview: reviewCounts.duplicates,
      oopPending: 0,    // Phase 2
      streamsLive: 0,   // Phase 2
    },
    liveNow,
    requiresAttention,
    schedule,
    systemStatus,
  }
}
```

- [ ] **Step 4: Run — confirm GREEN**

```bash
cd apps/ops && npx vitest run tests/today-aggregator.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Create the route handler**

```ts
// apps/ops/src/app/api/internal/today/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getTodayPayload } from '@/lib/today-aggregator'

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const payload = await getTodayPayload()
  return NextResponse.json(payload, {
    headers: { 'cache-control': 'no-store' },
  })
}
```

- [ ] **Step 6: Smoke-build + smoke-fetch**

```bash
cd apps/ops && npx next build 2>&1 | tail -10
```

Then while signed in, hit `http://localhost:3004/api/internal/today` in the browser — you should see a JSON payload with all 6 top-level keys (`fetchedAt`, `kpis`, `liveNow`, `requiresAttention`, `schedule`, `systemStatus`).

- [ ] **Step 7: Commit**

```bash
git add apps/ops/src/lib/today-aggregator.ts apps/ops/tests/today-aggregator.test.ts 'apps/ops/src/app/api/internal/today/route.ts'
git commit -m "feat(ops): Today aggregator + GET /api/internal/today

One endpoint, one DB cluster. Returns KPIs, LIVE NOW sample, requires-
attention summaries (Phase 1: just duplicates), 24h schedule buckets,
and the green/yellow/red system status roll-up. SQL ported from the
main app's /ops/api/status route — does NOT call back over HTTP per
the spec's reuse strategy. TDD-covered."
```

---

## Task 6: KPI strip component

**Files:**
- Create: `apps/ops/src/components/TodayKpiStrip.tsx`

- [ ] **Step 1: Create the component**

```tsx
// apps/ops/src/components/TodayKpiStrip.tsx
// Four tiles in a row across the top of the Today page. Per the spec's
// "Today" screen mockup. Variation 2: large numerics, quiet labels,
// status-color dot on each tile to reinforce urgency at a glance.

import type { TodayPayload } from '@/lib/today-aggregator'

interface TileSpec {
  label: string
  value: number
  dot?: string                   // CSS color var for the urgency dot
  pulse?: boolean                // pulse the dot when count > 0
}

export function TodayKpiStrip({ kpis }: { kpis: TodayPayload['kpis'] }) {
  const tiles: TileSpec[] = [
    { label: 'Live Matches', value: kpis.liveMatches, dot: 'var(--status-live)', pulse: kpis.liveMatches > 0 },
    { label: 'Needs Review', value: kpis.needsReview, dot: 'var(--status-warn)' },
    { label: 'OOP Pending', value: kpis.oopPending, dot: 'var(--status-urgent)' },
    { label: 'Streams Live', value: kpis.streamsLive, dot: 'var(--status-live)' },
  ]
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 16,
        marginBottom: 24,
      }}
    >
      {tiles.map((t) => (
        <div
          key={t.label}
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 12,
            padding: '20px 20px 16px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--status-neutral)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {t.dot && (
              <span
                className={t.pulse ? 'live-pulse' : undefined}
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: t.dot,
                }}
              />
            )}
            {t.label}
          </div>
          <div
            className="tabular"
            style={{
              fontSize: 32,
              fontWeight: 700,
              color: 'var(--brand-primary-fg)',
              marginTop: 8,
              lineHeight: 1,
            }}
          >
            {t.value}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Smoke-check by importing in Today page (Task 11) — skip the build here**

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/components/TodayKpiStrip.tsx
git commit -m "feat(ops): TodayKpiStrip component

Four tiles: Live Matches, Needs Review, OOP Pending, Streams Live.
Large tabular-num value, quiet uppercase label, urgency-color dot
with optional pulse when count > 0. Variation 2 styling."
```

---

## Task 7: LIVE NOW table component

**Files:**
- Create: `apps/ops/src/components/TodayLiveNow.tsx`

- [ ] **Step 1: Create the component**

```tsx
// apps/ops/src/components/TodayLiveNow.tsx
// Currently-live matches as a compact table. Pulsing LIVE pill, court,
// pair vs pair, score, elapsed time. Per the spec's screen-1 mockup.

import type { TodayPayload } from '@/lib/today-aggregator'

function elapsedLabel(startedAt: string | null): string {
  if (!startedAt) return '—'
  const ms = Date.now() - new Date(startedAt).getTime()
  if (ms < 0) return '—'
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  return `${hours}h${remMins ? ` ${remMins}m` : ''}`
}

export function TodayLiveNow({ matches }: { matches: TodayPayload['liveNow'] }) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--border-subtle)',
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--status-neutral)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          className="live-pulse"
          style={{
            background: 'var(--status-live)',
            color: 'var(--bg-card)',
            padding: '2px 8px',
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 700,
          }}
        >
          LIVE NOW
        </span>
        <span style={{ color: 'var(--brand-primary-fg)' }}>{matches.length} matches</span>
      </div>

      {matches.length === 0 ? (
        <div
          style={{
            padding: '32px 20px',
            textAlign: 'center',
            fontSize: 13,
            color: 'var(--status-neutral)',
          }}
        >
          No live matches right now.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ color: 'var(--status-neutral)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              <th style={{ textAlign: 'left', padding: '8px 20px', fontWeight: 600 }}>Court</th>
              <th style={{ textAlign: 'left', padding: '8px 20px', fontWeight: 600 }}>Pair 1</th>
              <th style={{ textAlign: 'left', padding: '8px 20px', fontWeight: 600 }}>Pair 2</th>
              <th style={{ textAlign: 'left', padding: '8px 20px', fontWeight: 600 }}>Score</th>
              <th style={{ textAlign: 'right', padding: '8px 20px', fontWeight: 600 }}>Elapsed</th>
            </tr>
          </thead>
          <tbody>
            {matches.slice(0, 8).map((m) => (
              <tr key={m.matchId} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '10px 20px', color: 'var(--status-neutral)' }}>{m.court ?? '—'}</td>
                <td style={{ padding: '10px 20px', color: 'var(--brand-primary-fg)' }}>{m.pair1}</td>
                <td style={{ padding: '10px 20px', color: 'var(--brand-primary-fg)' }}>{m.pair2}</td>
                <td className="tabular" style={{ padding: '10px 20px', color: 'var(--brand-primary-fg)' }}>
                  {m.setScores.join(' · ') || '—'}
                </td>
                <td className="tabular" style={{ padding: '10px 20px', textAlign: 'right', color: 'var(--status-neutral)' }}>
                  {elapsedLabel(m.startedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/ops/src/components/TodayLiveNow.tsx
git commit -m "feat(ops): TodayLiveNow component

Live-match table with pulsing LIVE pill header, court / pair / score /
elapsed columns. Empty state copy for no live matches. Caps at 8 rows."
```

---

## Task 8: REQUIRES ATTENTION component

**Files:**
- Create: `apps/ops/src/components/TodayRequiresAttention.tsx`

- [ ] **Step 1: Create the component**

```tsx
// apps/ops/src/components/TodayRequiresAttention.tsx
// Dark-surface panel listing review queues. Per the spec, this is the
// Variation 2 signature move — REQUIRES ATTENTION inverts so urgent
// items pull the eye. Each row links to /needs-review with a filter.

import Link from 'next/link'
import type { TodayPayload } from '@/lib/today-aggregator'

export function TodayRequiresAttention({
  rows,
}: {
  rows: TodayPayload['requiresAttention']
}) {
  return (
    <div
      style={{
        background: 'var(--bg-attention)',
        color: 'var(--fg-on-attention)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        Requires Attention
      </div>
      <div>
        {rows.map((r) => (
          <Link
            key={r.key}
            href={r.href}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 20px',
              borderTop: '1px solid rgba(255,255,255,0.04)',
              color: 'var(--fg-on-attention)',
              textDecoration: 'none',
            }}
          >
            <span style={{ fontSize: 13 }}>{r.label}</span>
            <span
              className="tabular"
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: r.count > 0 ? 'var(--status-warn)' : 'var(--status-neutral)',
              }}
            >
              {r.count}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/ops/src/components/TodayRequiresAttention.tsx
git commit -m "feat(ops): TodayRequiresAttention component

Dark-surface (--bg-attention) review-queue list — the signature
Variation 2 move. Each row links to /needs-review?type=... with
amber count when > 0, neutral when 0. Phase 2 will broaden the
queue set."
```

---

## Task 9: TODAY'S SCHEDULE + status pill

**Files:**
- Create: `apps/ops/src/components/TodaySchedule.tsx`
- Create: `apps/ops/src/components/TodayStatusPill.tsx`

- [ ] **Step 1: Create `TodaySchedule.tsx`**

```tsx
// apps/ops/src/components/TodaySchedule.tsx
// 24h match schedule grouped by hour. Each bucket: hour, match count,
// round labels. Hour displayed in the user's local time (deriving from
// the UTC HH:MM the aggregator returns).

import type { TodayPayload } from '@/lib/today-aggregator'

function formatLocalHour(utcHHMM: string): string {
  // utcHHMM is "HH:MM" in UTC; build a Date today at that UTC time, format locally
  const [h, m] = utcHHMM.split(':').map((s) => parseInt(s, 10))
  const today = new Date()
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), h ?? 0, m ?? 0))
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function TodaySchedule({ buckets }: { buckets: TodayPayload['schedule'] }) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--border-subtle)',
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--status-neutral)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        Today's Schedule
      </div>
      {buckets.length === 0 ? (
        <div
          style={{
            padding: '32px 20px',
            textAlign: 'center',
            fontSize: 13,
            color: 'var(--status-neutral)',
          }}
        >
          Nothing scheduled in the next 24 hours.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.hour} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <td className="tabular" style={{ padding: '12px 20px', width: 100, fontWeight: 600 }}>
                  {formatLocalHour(b.hour)}
                </td>
                <td style={{ padding: '12px 20px', color: 'var(--status-neutral)' }}>
                  {b.roundLabels.length > 0 ? b.roundLabels.join(', ') : '—'}
                </td>
                <td className="tabular" style={{ padding: '12px 20px', textAlign: 'right' }}>
                  {b.matchCount} {b.matchCount === 1 ? 'match' : 'matches'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create `TodayStatusPill.tsx`**

```tsx
// apps/ops/src/components/TodayStatusPill.tsx
// Footer pill showing the systemStatus roll-up from the aggregator.
// Green when everything is fine, yellow on warnings, red when stale
// matches are present.

import type { TodayPayload } from '@/lib/today-aggregator'

const COLOR_MAP: Record<TodayPayload['systemStatus'], { bg: string; label: string }> = {
  green: { bg: 'var(--status-live)', label: 'All systems operational' },
  yellow: { bg: 'var(--status-warn)', label: 'Some queues need attention' },
  red: { bg: 'var(--status-urgent)', label: 'Stale matches detected' },
}

export function TodayStatusPill({ status }: { status: TodayPayload['systemStatus'] }) {
  const { bg, label } = COLOR_MAP[status]
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 999,
        fontSize: 12,
        color: 'var(--status-neutral)',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: bg,
        }}
      />
      <span style={{ color: 'var(--brand-primary-fg)', fontWeight: 600 }}>{label}</span>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/components/TodaySchedule.tsx apps/ops/src/components/TodayStatusPill.tsx
git commit -m "feat(ops): TodaySchedule + TodayStatusPill components

Schedule renders hour buckets with local-time formatting + round
labels + match count. StatusPill maps green/yellow/red to copy
('operational' / 'need attention' / 'stale matches detected')."
```

---

## Task 10: Replace Today stub with the real page

**Files:**
- Modify: `apps/ops/src/app/(app)/today/page.tsx`

- [ ] **Step 1: Rewrite the Today page**

```tsx
// apps/ops/src/app/(app)/today/page.tsx
// The real Today dashboard — KPIs, LIVE NOW, REQUIRES ATTENTION,
// TODAY'S SCHEDULE, status pill. Reads through getTodayPayload() at
// request time (server component), so each page render gets fresh
// data; clients can refresh the page or rely on revalidation via
// router refresh hooks (Plan 2 polish if needed).

import { auth } from '@/lib/auth'
import { getTodayPayload } from '@/lib/today-aggregator'
import { TodayKpiStrip } from '@/components/TodayKpiStrip'
import { TodayLiveNow } from '@/components/TodayLiveNow'
import { TodayRequiresAttention } from '@/components/TodayRequiresAttention'
import { TodaySchedule } from '@/components/TodaySchedule'
import { TodayStatusPill } from '@/components/TodayStatusPill'

export const metadata = { title: 'Today · PadelNachos Admin' }
export const dynamic = 'force-dynamic'    // never cache — always fresh

export default async function TodayPage() {
  const [session, payload] = await Promise.all([auth(), getTodayPayload()])
  return (
    <div style={{ padding: 32, maxWidth: 1280 }}>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>Today</h1>
          <p style={{ fontSize: 13, color: 'var(--status-neutral)', margin: 0 }}>
            Welcome back, {session?.user?.name?.split(' ')[0] ?? session?.user?.email}.
          </p>
        </div>
        <TodayStatusPill status={payload.systemStatus} />
      </div>

      <TodayKpiStrip kpis={payload.kpis} />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <TodayLiveNow matches={payload.liveNow} />
        <TodayRequiresAttention rows={payload.requiresAttention} />
      </div>

      <TodaySchedule buckets={payload.schedule} />

      <div style={{ marginTop: 24, fontSize: 11, color: 'var(--status-neutral)' }}>
        Updated {new Date(payload.fetchedAt).toLocaleTimeString()}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Smoke-build**

```bash
cd apps/ops && npx next build 2>&1 | tail -10
```

Expected: builds. `/today` flips from `○ Static` to `ƒ Dynamic` (because `dynamic = 'force-dynamic'`).

- [ ] **Step 3: Visual check**

Refresh `http://localhost:3004/today`. You should see:

- Header with "Today" + welcome line + status pill in the top-right
- 4 KPI tiles in a row
- LIVE NOW table on the left (~2/3 width) showing live matches or the empty state
- REQUIRES ATTENTION dark panel on the right (~1/3 width) with the queue rows
- TODAY'S SCHEDULE full-width below
- "Updated HH:MM:SS" footnote at the bottom

If there are no live matches and no scheduled matches in the next 24h, the LIVE NOW / SCHEDULE sections show their empty-state copy — that's the correct Plan 2 behavior (no test data to seed; this layout will fill out the moment a Premier tournament is in-window).

- [ ] **Step 4: Commit**

```bash
git add 'apps/ops/src/app/(app)/today/page.tsx'
git commit -m "feat(ops): real Today page — replaces Plan 1 stub

Server component renders TodayKpiStrip + TodayLiveNow +
TodayRequiresAttention + TodaySchedule + TodayStatusPill from a
single getTodayPayload() call. force-dynamic so each request gets
fresh data. The Plan 1 'SIGNED IN' welcome card is retired."
```

---

## Task 11: Polish — `/today` keyboard refresh + sidebar tidies

**Files:**
- Modify: `apps/ops/src/app/(app)/today/page.tsx`
- Modify: `apps/ops/src/components/Sidebar.tsx`

Two small UX improvements that came up while building the page:

1. A "Refresh" button on the Today page header that calls `router.refresh()` so operators don't need a full page reload to update KPIs.
2. The sidebar's active-route highlight should show even when nested routes are visited (e.g. `/system/architecture` should keep the System group's items styled).

- [ ] **Step 1: Add a client refresh button to the Today header**

Create `apps/ops/src/components/TodayRefreshButton.tsx`:

```tsx
// apps/ops/src/components/TodayRefreshButton.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

export function TodayRefreshButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
      style={{
        background: 'transparent',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        padding: '6px 12px',
        fontSize: 12,
        color: 'var(--status-neutral)',
        cursor: pending ? 'wait' : 'pointer',
      }}
    >
      {pending ? 'Refreshing…' : 'Refresh'}
    </button>
  )
}
```

Then update `apps/ops/src/app/(app)/today/page.tsx` — replace the top header block with:

```tsx
import { TodayRefreshButton } from '@/components/TodayRefreshButton'

// ... in TodayPage(), replace the top div:
<div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
  <div>
    <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>Today</h1>
    <p style={{ fontSize: 13, color: 'var(--status-neutral)', margin: 0 }}>
      Welcome back, {session?.user?.name?.split(' ')[0] ?? session?.user?.email}.
    </p>
  </div>
  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
    <TodayRefreshButton />
    <TodayStatusPill status={payload.systemStatus} />
  </div>
</div>
```

- [ ] **Step 2: Verify the sidebar's active-route logic already handles nested routes**

Look at `apps/ops/src/components/SidebarNavItem.tsx` line where `active` is computed:

```ts
const active = pathname === item.href || pathname.startsWith(item.href + '/')
```

If that line already matches `pathname.startsWith(item.href + '/')`, nested routes are handled. Smoke-check by visiting `/system/architecture` — the "Architecture" item in the sidebar should be highlighted. If it isn't, fix the comparison.

- [ ] **Step 3: Smoke-build**

```bash
cd apps/ops && npx next build 2>&1 | tail -10
```

Expected: builds.

- [ ] **Step 4: Commit**

```bash
git add apps/ops/src/components/TodayRefreshButton.tsx 'apps/ops/src/app/(app)/today/page.tsx'
git commit -m "feat(ops): Today refresh button + sidebar nested-route highlight

Refresh button calls router.refresh() inside a transition for non-
blocking updates. Verified sidebar active-route logic covers nested
paths (/system/architecture highlights Architecture)."
```

---

## Task 12: Update README + run full tests

**Files:**
- Modify: `apps/ops/README.md`

- [ ] **Step 1: Update the README's auth-flow + routes sections**

Edit `apps/ops/README.md`. Replace the "Architecture notes" section with:

```markdown
## Architecture notes

- Auth.js v5 with JWT-strategy sessions (the original spec proposed database
  sessions but the Credentials provider doesn't create them in v5 — see Plan 1
  errata for the full reasoning)
- PostgresAdapter still mounted for `users`, `accounts`, `verification_token`
  persistence; the `sessions` table goes unused under JWT
- Cookie domain `.padelnachos.com` in prod (parent-domain scoping — harmless
  under JWT; cross-subdomain session sharing was deferred indefinitely)
- Auth + operator gate in `src/app/(app)/layout.tsx` via `await auth()` and
  `session.user.isOperator` (enriched by the session callback)
- Direct Supabase access server-side; admin routes namespaced under
  `/api/internal/*` to avoid colliding with the main app's `/api/admin/*`

## Routes

| Path | Description |
|---|---|
| `/` | Root — redirects to `/today` (signed in) or `/login` (anonymous) |
| `/login` | Three providers: email+password, magic-link, Google |
| `/forgot-password` | Anti-enumeration reset request |
| `/reset-password?token=…` | Token consumer + new password form |
| `/not-authorized` | Shown when a session exists but isOperator is false |
| `/today` | Daily-driver dashboard (KPIs, LIVE NOW, REQUIRES ATTENTION, schedule) |
| `/tournament-explorer`, `/entry-lists`, `/needs-review`, `/simulator` | Tournament Ops tabs (stubs until Plan 3) |
| `/players`, `/brands`, `/streams` | Catalog tabs (stubs until Plan 3) |
| `/news`, `/highlights` | Content tabs (stubs until Plan 3) |
| `/system/*` | Diagnostics tabs (stubs until Plan 3) |
| `/api/internal/today` | GET → full Today payload |
| `/api/internal/needs-review/counts` | GET → `{ duplicates: number }` |
| `/api/auth/[...nextauth]` | Auth.js handler |
```

- [ ] **Step 2: Run the full test suite**

```bash
cd apps/ops && npm test
```

Expected: PASS, at least 26 tests (Plan 1's 19 + Plan 2's 7 new: 4 for needs-review-counts, 4 for today-aggregator — minus the small overlap).

- [ ] **Step 3: Smoke-build**

```bash
cd apps/ops && npm run build 2>&1 | tail -20
```

Expected: clean build. Route table shows the full set including `/today` (Dynamic), the 14 stub routes, both `/api/internal/*` endpoints.

- [ ] **Step 4: Commit**

```bash
git add apps/ops/README.md
git commit -m "docs(ops): README — JWT strategy, route table, Plan 2 endpoints

Aligns the README with what shipped:
- Architecture notes mention JWT sessions and the deferred cross-
  subdomain feature
- Route table enumerates every Plan 1 + Plan 2 path
- /api/internal/today + /api/internal/needs-review/counts documented"
```

---

## Verification checklist

After all 12 tasks land:

- [ ] `apps/ops/` directory tree matches the File Structure section
- [ ] `cd apps/ops && npm test` passes ≥ 26 tests across ≥ 7 test files
- [ ] `cd apps/ops && npm run build` builds cleanly, includes all routes
- [ ] `cd apps/ops && npm run lint` reports zero errors
- [ ] `cd apps/ops && npm run dev` starts on port 3004
- [ ] Signing in lands on `/today` with the full dashboard (KPIs, LIVE NOW, REQUIRES ATTENTION, SCHEDULE, status pill)
- [ ] Sidebar shows all 5 nav groups with the right items
- [ ] Sidebar collapses to ~44px icon strip via the chevron at the top
- [ ] Sidebar collapse state persists across page reloads
- [ ] Active route is highlighted (green border + card background)
- [ ] Clicking each non-Today nav item navigates to a stub showing "Coming in Plan 3"
- [ ] Needs Review badge shows the duplicates count (or no badge when 0)
- [ ] `/api/internal/today` returns a JSON payload with the documented shape (when signed in as operator)
- [ ] `/api/internal/needs-review/counts` returns `{ duplicates: N }`
- [ ] Refresh button on Today triggers `router.refresh()` and pulls fresh data
- [ ] Signing out from `/today` returns to `/login` cleanly

## What's intentionally NOT in this plan

- The 15 tab lifts from the main app (Plan 3)
- A unified Needs Review inbox with multiple queue types (Phase 2 of the spec)
- RECENT ACTIVITY and DATA HEALTH panels on Today (Phase 2 of the spec)
- Global ⌘K search and the notification bell (Phase 2)
- Timezone-aware schedule formatting beyond local-hour display
- Polling the Today endpoint client-side (we rely on `router.refresh()` and full page reload for now; add polling in a follow-up if operators ask for it)
- The Task 16 cookie-domain change on the main app (per Plan 1 errata, no longer needed)

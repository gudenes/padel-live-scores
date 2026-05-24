# Sidebar 2-Column + Activity Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-layout the admin app's sidebar from a 1-column list-with-section-headers into a Sentry-style 2-column drilldown (primary icon column + secondary pages column), preserve the existing IA, add a stub activity feed rail on the right side, and dial up satisfying micro-interactions (lime accent, ripple, spring transitions).

**Architecture:** Replace `Sidebar.tsx` with a composition of `SidebarPrimary` (icon column) + `SidebarSecondary` (pages column). Active area is derived from `usePathname()` via a single `areaFor(pathname)` helper in a new `sidebar-areas.ts` registry. Activity rail is a self-contained component mounted in the app shell layout with hardcoded stub data + localStorage collapse persistence.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Auth.js v5 session, Supabase counts API (existing), client-side only — no new backend.

**Spec:** [docs/superpowers/specs/2026-05-24-sidebar-2col-activity-feed-design.md](../specs/2026-05-24-sidebar-2col-activity-feed-design.md)

---

## File Structure

### Files to create

```
apps/ops/src/lib/sidebar-areas.ts                    — Area registry + areaFor(pathname) helper
apps/ops/src/lib/__tests__/sidebar-areas.test.ts     — TDD for areaFor
apps/ops/src/lib/click-ripple.ts                     — Shared ripple helper (lime ink-wash on click)
apps/ops/src/components/SidebarPrimary.tsx           — Icon column (5 area entries)
apps/ops/src/components/SidebarSecondary.tsx         — Page list column (active area's pages)
apps/ops/src/components/ActivityRail.tsx             — Right-side stub feed
```

### Files to modify

```
apps/ops/src/app/globals.css                         — Append lime + transition tokens
apps/ops/src/components/Sidebar.tsx                  — Rewrite as composition of Primary + Secondary
apps/ops/src/app/(app)/layout.tsx                    — Mount activity rail in shell
apps/ops/README.md                                   — Document the new sidebar layout
```

### Files to potentially delete

```
apps/ops/src/components/SidebarNavItem.tsx           — Replaced by SidebarSecondary's inline row component. Confirm no other consumers before deleting in T4.
```

---

## Task 1: Lime tokens + sidebar-areas registry (TDD)

**Files:**
- Modify: `apps/ops/src/app/globals.css`
- Create: `apps/ops/src/lib/sidebar-areas.ts`
- Create: `apps/ops/src/lib/__tests__/sidebar-areas.test.ts`

**Goal:** Add the lime accent design tokens to globals.css and build the canonical "areas + pages + path matcher" registry. Pure TypeScript — no UI yet.

- [ ] **Step 1: Append lime + motion tokens to `apps/ops/src/app/globals.css`**

Find the existing `:root { ... }` block and add these inside (or after the existing tokens):

```css
  /* Lime accent (sidebar + activity rail) */
  --lime: #84cc16;
  --lime-bright: #a3e635;
  --lime-deep: #65a30d;
  --lime-glow: rgba(163, 230, 53, 0.45);
  --lime-tint: rgba(132, 204, 22, 0.12);

  /* Status palette (activity rail) */
  --status-live: #22c55e;
  --status-warn: #f59e0b;
  --status-info: #38bdf8;
  --status-risk: #ef4444;

  /* Motion */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --dur-fast: 120ms;
  --dur-base: 200ms;
  --dur-slow: 340ms;
```

Then append the ripple animation block AT THE END of globals.css (outside the `:root`):

```css
/* Lime click ripple — used by SidebarPrimary + SidebarSecondary */
.ops-ripple {
  position: absolute;
  border-radius: 50%;
  background: rgba(132, 204, 22, 0.32);
  transform: scale(0);
  animation: opsRippleExpand 580ms cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: none;
  z-index: 0;
}
@keyframes opsRippleExpand {
  to { transform: scale(2.6); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .ops-ripple { display: none; }
}
```

- [ ] **Step 1b: Create the shared ripple helper**

```ts
// apps/ops/src/lib/click-ripple.ts
// Spawns a lime ink-wash ripple from the click point inside `host`.
// The host gets `position: relative` + `overflow: hidden` (if not already set)
// so the ripple stays bounded. The ripple element is auto-removed after 600ms.

import type { MouseEvent } from 'react'

export function spawnRipple(host: HTMLElement, event: MouseEvent): void {
  const rect = host.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  const size = Math.max(rect.width, rect.height)

  const ripple = document.createElement('span')
  ripple.className = 'ops-ripple'
  ripple.style.left = `${x - size / 2}px`
  ripple.style.top = `${y - size / 2}px`
  ripple.style.width = `${size}px`
  ripple.style.height = `${size}px`

  // Ensure the host can host an absolutely-positioned child
  if (getComputedStyle(host).position === 'static') {
    host.style.position = 'relative'
  }
  host.style.overflow = 'hidden'

  host.appendChild(ripple)
  setTimeout(() => ripple.remove(), 600)
}
```

- [ ] **Step 2: Write failing test**

```ts
// apps/ops/src/lib/__tests__/sidebar-areas.test.ts
import { describe, it, expect } from 'vitest'
import { AREAS, areaFor, type AreaId } from '@/lib/sidebar-areas'

describe('sidebar-areas', () => {
  describe('AREAS', () => {
    it('exposes 5 areas in canonical order', () => {
      expect(AREAS.map(a => a.id)).toEqual([
        'home',
        'tournament-ops',
        'catalogs',
        'content',
        'system',
      ])
    })

    it('every area has at least one page', () => {
      AREAS.forEach(a => {
        expect(a.pages.length).toBeGreaterThan(0)
      })
    })

    it('every page has a unique href', () => {
      const hrefs = AREAS.flatMap(a => a.pages.map(p => p.href))
      expect(new Set(hrefs).size).toBe(hrefs.length)
    })
  })

  describe('areaFor', () => {
    const cases: Array<[string, AreaId]> = [
      ['/today', 'home'],
      ['/tournament-explorer', 'tournament-ops'],
      ['/entry-lists', 'tournament-ops'],
      ['/needs-review', 'tournament-ops'],
      ['/needs-review?queue=players', 'tournament-ops'],
      ['/simulator', 'tournament-ops'],
      ['/players', 'catalogs'],
      ['/players/abc-123', 'catalogs'],
      ['/brands', 'catalogs'],
      ['/streams', 'catalogs'],
      ['/yt-channels', 'catalogs'],
      ['/news', 'content'],
      ['/highlights', 'content'],
      ['/system/integration-health', 'system'],
      ['/system/data-quality', 'system'],
      ['/system/architecture', 'system'],
    ]

    cases.forEach(([path, expected]) => {
      it(`maps "${path}" → "${expected}"`, () => {
        expect(areaFor(path)).toBe(expected)
      })
    })

    it('unknown path falls back to "home"', () => {
      expect(areaFor('/garbage')).toBe('home')
      expect(areaFor('/')).toBe('home')
    })
  })
})
```

- [ ] **Step 3: Run test to verify it FAILS (module not found)**

Run: `cd apps/ops && npx vitest run src/lib/__tests__/sidebar-areas.test.ts`
Expected: FAIL — `Cannot find module '@/lib/sidebar-areas'`

- [ ] **Step 4: Implement `sidebar-areas.ts`**

```ts
// apps/ops/src/lib/sidebar-areas.ts
// Canonical registry for the 2-column sidebar: areas + their pages + a path
// matcher. Used by SidebarPrimary, SidebarSecondary, and the activity rail
// (which surfaces page names in audit-trail events).

import type { ReactNode } from 'react'

export type AreaId = 'home' | 'tournament-ops' | 'catalogs' | 'content' | 'system'

export interface Page {
  href: string
  label: string
}

export interface Area {
  id: AreaId
  label: string
  /** Inline SVG path data for a 24x24 viewBox. Caller wraps in <svg>. */
  iconPath: ReactNode
  pages: Page[]
}

const calendarClockIcon = (
  <>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </>
)

const trophyIcon = (
  <>
    <path d="M6 9V4h12v5" />
    <path d="M6 9a6 6 0 0 0 12 0" />
    <path d="M9 21h6" />
    <path d="M12 17v4" />
    <path d="M3 5h3" />
    <path d="M18 5h3" />
  </>
)

const layersIcon = (
  <>
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <rect x="3" y="11" width="18" height="4" rx="1" />
    <rect x="3" y="18" width="18" height="3" rx="1" />
  </>
)

const fileTextIcon = (
  <>
    <path d="M4 4h12a2 2 0 0 1 2 2v14" />
    <path d="M4 4v16h14" />
    <path d="M8 8h6" />
    <path d="M8 12h6" />
    <path d="M8 16h4" />
  </>
)

const settingsIcon = (
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </>
)

export const AREAS: ReadonlyArray<Area> = [
  {
    id: 'home',
    label: 'Home',
    iconPath: calendarClockIcon,
    pages: [{ href: '/today', label: 'Today' }],
  },
  {
    id: 'tournament-ops',
    label: 'Tournament Ops',
    iconPath: trophyIcon,
    pages: [
      { href: '/tournament-explorer', label: 'Tournament Explorer' },
      { href: '/entry-lists', label: 'Entry Lists' },
      { href: '/needs-review', label: 'Needs Review' },
      { href: '/simulator', label: 'Simulator' },
    ],
  },
  {
    id: 'catalogs',
    label: 'Catalogs',
    iconPath: layersIcon,
    pages: [
      { href: '/players', label: 'Players' },
      { href: '/brands', label: 'Brands & Equipment' },
      { href: '/streams', label: 'Streams' },
      { href: '/yt-channels', label: 'YT Channels' },
    ],
  },
  {
    id: 'content',
    label: 'Content',
    iconPath: fileTextIcon,
    pages: [
      { href: '/news', label: 'News' },
      { href: '/highlights', label: 'Highlights' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    iconPath: settingsIcon,
    pages: [
      { href: '/system/integration-health', label: 'Integration Health' },
      { href: '/system/data-quality', label: 'Data Quality' },
      { href: '/system/padelgod-health', label: 'Padelgod Health' },
      { href: '/system/shadow-mode', label: 'Shadow Mode' },
      { href: '/system/coverage-matrix', label: 'Coverage Matrix' },
      { href: '/system/feature-flags', label: 'Feature Flags' },
      { href: '/system/architecture', label: 'Architecture' },
    ],
  },
]

/**
 * Derive the active sidebar area from a pathname (may include query string).
 * Falls back to 'home' for unknown paths so the UI never breaks.
 */
export function areaFor(pathname: string): AreaId {
  // Strip query string + trailing slash + leading slash for prefix comparison
  const path = pathname.split('?')[0].replace(/\/+$/, '') || '/'

  if (path === '/today' || path.startsWith('/today/')) return 'home'

  if (
    path === '/tournament-explorer' || path.startsWith('/tournament-explorer/') ||
    path === '/entry-lists' || path.startsWith('/entry-lists/') ||
    path === '/needs-review' || path.startsWith('/needs-review/') ||
    path === '/simulator' || path.startsWith('/simulator/')
  ) return 'tournament-ops'

  if (
    path === '/players' || path.startsWith('/players/') ||
    path === '/brands' || path.startsWith('/brands/') ||
    path === '/streams' || path.startsWith('/streams/') ||
    path === '/yt-channels' || path.startsWith('/yt-channels/')
  ) return 'catalogs'

  if (
    path === '/news' || path.startsWith('/news/') ||
    path === '/highlights' || path.startsWith('/highlights/')
  ) return 'content'

  if (path === '/system' || path.startsWith('/system/')) return 'system'

  return 'home'
}
```

- [ ] **Step 5: Run test to verify it PASSES**

Run: `cd apps/ops && npx vitest run src/lib/__tests__/sidebar-areas.test.ts`
Expected: PASS (all cases — about 22 test cases including AREAS structural checks).

- [ ] **Step 6: Commit**

```bash
git add apps/ops/src/app/globals.css apps/ops/src/lib/sidebar-areas.ts apps/ops/src/lib/__tests__/sidebar-areas.test.ts apps/ops/src/lib/click-ripple.ts
git commit -m "feat(ops): sidebar-areas registry + lime tokens + click-ripple helper (TDD)"
```

(Note: working directory is the worktree we'll create in pre-execution setup; the commit happens on the Plan 6 branch.)

---

## Task 2: SidebarPrimary component (icon column)

**Files:**
- Create: `apps/ops/src/components/SidebarPrimary.tsx`

**Goal:** A pure presentational component that renders the 78px-wide icon column. Takes `activeAreaId` + `needsReviewCount` as props, renders 5 area buttons + the brand mark + the footer-area-style search/help icons (deferred — just the 5 areas for v1).

- [ ] **Step 1: Create the component**

```tsx
// apps/ops/src/components/SidebarPrimary.tsx
// Icon column. Renders the brand mark + 5 area entries (icon + label).
// Stateless: parent owns activeAreaId. Click handler navigates to the
// first page of the clicked area + spawns a lime ripple.
'use client'

import Link from 'next/link'
import type { MouseEvent } from 'react'
import { AREAS, type AreaId } from '@/lib/sidebar-areas'
import { spawnRipple } from '@/lib/click-ripple'

interface Props {
  activeAreaId: AreaId
  /** Shown as an amber badge on the tournament-ops icon (Needs Review surfaces here). */
  needsReviewCount: number
}

export function SidebarPrimary({ activeAreaId, needsReviewCount }: Props) {
  return (
    <nav
      style={{
        width: 78,
        background: 'var(--bg-card)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        padding: '14px 0 16px',
        flexShrink: 0,
      }}
    >
      <BrandMark />
      {AREAS.map(area => (
        <PrimaryItem
          key={area.id}
          area={area}
          active={area.id === activeAreaId}
          badge={area.id === 'tournament-ops' && needsReviewCount > 0 ? needsReviewCount : undefined}
        />
      ))}
    </nav>
  )
}

function BrandMark() {
  return (
    <Link
      href="/today"
      title="PadelNachos Admin"
      style={{
        width: 38,
        height: 38,
        margin: '0 auto 16px',
        borderRadius: 10,
        background: 'linear-gradient(135deg, var(--lime-bright) 0%, var(--lime-deep) 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        fontWeight: 800,
        fontSize: 17,
        letterSpacing: '-0.04em',
        textDecoration: 'none',
        boxShadow: '0 6px 14px rgba(132, 204, 22, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.4)',
        transition: 'transform var(--dur-base) var(--ease-spring), box-shadow var(--dur-base) var(--ease-out)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'scale(1.08) rotate(-3deg)'
        e.currentTarget.style.boxShadow = '0 8px 20px rgba(132, 204, 22, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.5)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = ''
        e.currentTarget.style.boxShadow = '0 6px 14px rgba(132, 204, 22, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.4)'
      }}
    >
      P
    </Link>
  )
}

interface PrimaryItemProps {
  area: typeof AREAS[number]
  active: boolean
  badge?: number
}

function PrimaryItem({ area, active, badge }: PrimaryItemProps) {
  const targetHref = area.pages[0]?.href ?? '/today'

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    const iconHost = e.currentTarget.querySelector<HTMLElement>('[data-prim-icon]')
    if (iconHost) spawnRipple(iconHost, e)
  }

  return (
    <Link
      href={targetHref}
      onClick={handleClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        padding: '8px 4px 6px',
        textDecoration: 'none',
        color: active ? 'var(--lime-deep)' : 'var(--status-neutral)',
        position: 'relative',
        transition: 'color var(--dur-base) var(--ease-out)',
        userSelect: 'none',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.color = 'var(--brand-primary-fg)'
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.color = 'var(--status-neutral)'
      }}
    >
      {/* Left edge bar (lime gradient, springs in on active) */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 10,
          bottom: 10,
          width: 3,
          background: 'linear-gradient(180deg, var(--lime-bright) 0%, var(--lime) 100%)',
          borderRadius: '0 4px 4px 0',
          boxShadow: '0 0 12px var(--lime-glow)',
          transform: active ? 'scaleY(1)' : 'scaleY(0)',
          transformOrigin: 'center',
          transition: 'transform var(--dur-base) var(--ease-spring)',
        }}
      />

      {/* Icon container — also hosts the click ripple */}
      <span
        data-prim-icon
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: active ? 'var(--lime-tint)' : 'transparent',
          position: 'relative',
          overflow: 'hidden',
          transition: 'background var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out)',
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {area.iconPath}
        </svg>

        {badge !== undefined && (
          <span
            style={{
              position: 'absolute',
              top: 2,
              right: 2,
              minWidth: 18,
              height: 18,
              background: 'var(--status-warn)',
              color: 'white',
              fontSize: 9,
              fontWeight: 800,
              borderRadius: 999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 5px',
              border: '2px solid var(--bg-card)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {badge}
          </span>
        )}
      </span>

      <span style={{ fontSize: 10, fontWeight: active ? 700 : 600, lineHeight: 1.1, textAlign: 'center' }}>
        {area.label}
      </span>
    </Link>
  )
}
```

- [ ] **Step 2: Lint + typecheck**

```bash
cd apps/ops && npx eslint 'src/components/SidebarPrimary.tsx' && npx tsc --noEmit
```
Expected: clean (pre-existing baseline issues elsewhere are not our problem).

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/components/SidebarPrimary.tsx
git commit -m "feat(ops): SidebarPrimary icon column with brand mark + 5 area entries"
```

---

## Task 3: SidebarSecondary component (pages column)

**Files:**
- Create: `apps/ops/src/components/SidebarSecondary.tsx`

**Goal:** A 248px-wide column that shows the active area's pages. Each row: label + optional badge. Active row gets lime pill background + spring-in left bar. Hover row gets soft tint + chevron-on-hover.

- [ ] **Step 1: Create the component**

```tsx
// apps/ops/src/components/SidebarSecondary.tsx
// Pages column for the active sidebar area. Stateless.
'use client'

import Link from 'next/link'
import type { MouseEvent } from 'react'
import { AREAS, type AreaId } from '@/lib/sidebar-areas'
import { spawnRipple } from '@/lib/click-ripple'

interface Props {
  activeAreaId: AreaId
  activePageHref: string
  /** Per-href badge counts. Currently only /needs-review uses this. */
  badges: Record<string, number>
}

export function SidebarSecondary({ activeAreaId, activePageHref, badges }: Props) {
  const area = AREAS.find(a => a.id === activeAreaId) ?? AREAS[0]

  return (
    <div
      style={{
        width: 248,
        background: 'var(--bg-card)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      <header style={{ padding: '18px 20px 12px' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--brand-primary-fg)', letterSpacing: '-0.01em' }}>
          {area.label}
        </div>
      </header>

      <div style={{ padding: '4px 10px', flex: 1, overflowY: 'auto' }}>
        {area.pages.map(page => {
          const active = page.href === activePageHref
          const badge = badges[page.href]
          return <SecondaryRow key={page.href} href={page.href} label={page.label} active={active} badge={badge} />
        })}
      </div>
    </div>
  )
}

interface RowProps {
  href: string
  label: string
  active: boolean
  badge?: number
}

function SecondaryRow({ href, label, active, badge }: RowProps) {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    spawnRipple(e.currentTarget, e)
  }

  return (
    <Link
      href={href}
      onClick={handleClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '9px 14px',
        borderRadius: 8,
        position: 'relative',
        marginBottom: 1,
        textDecoration: 'none',
        color: active ? 'var(--lime-deep)' : 'var(--brand-primary-fg)',
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        background: active ? 'var(--lime-tint)' : 'transparent',
        boxShadow: active
          ? 'inset 0 0 0 1px rgba(132, 204, 22, 0.28), 0 1px 2px rgba(132, 204, 22, 0.12)'
          : 'none',
        transition: 'background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)',
        overflow: 'hidden',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'rgba(0, 0, 0, 0.03)'
        const chev = e.currentTarget.querySelector<HTMLElement>('[data-chev]')
        if (chev && !active) {
          chev.style.opacity = '1'
          chev.style.transform = 'translateX(0)'
        }
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent'
        const chev = e.currentTarget.querySelector<HTMLElement>('[data-chev]')
        if (chev) {
          chev.style.opacity = '0'
          chev.style.transform = 'translateX(-4px)'
        }
      }}
    >
      {/* Left edge bar */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 8,
          bottom: 8,
          width: 2.5,
          background: 'linear-gradient(180deg, var(--lime-bright) 0%, var(--lime) 100%)',
          borderRadius: '0 3px 3px 0',
          transform: active ? 'scaleY(1)' : 'scaleY(0)',
          transition: 'transform var(--dur-base) var(--ease-spring)',
        }}
      />

      <span>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {badge !== undefined && badge > 0 && (
          <span
            style={{
              background: 'var(--status-warn)',
              color: 'white',
              fontSize: 10,
              fontWeight: 800,
              padding: '1px 8px',
              borderRadius: 999,
              boxShadow: '0 1px 4px rgba(245, 158, 11, 0.4)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {badge}
          </span>
        )}
        {/* Chevron — visible on hover only, hidden on active */}
        <svg
          data-chev
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            color: 'var(--status-neutral)',
            opacity: 0,
            transform: 'translateX(-4px)',
            transition: 'opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out)',
          }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </span>
    </Link>
  )
}
```

- [ ] **Step 2: Lint + typecheck**

```bash
cd apps/ops && npx eslint 'src/components/SidebarSecondary.tsx' && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/components/SidebarSecondary.tsx
git commit -m "feat(ops): SidebarSecondary page list with lime pill active state + hover chevron"
```

---

## Task 4: Rewrite Sidebar.tsx to compose Primary + Secondary

**Files:**
- Modify: `apps/ops/src/components/Sidebar.tsx` (full rewrite)
- Potentially delete: `apps/ops/src/components/SidebarNavItem.tsx`

**Goal:** Replace the existing 1-column Sidebar with a composition of `SidebarPrimary` + `SidebarSecondary`. Preserve the existing badge polling and `userEmail` footer.

- [ ] **Step 1: Read the existing Sidebar.tsx to understand the badge polling pattern**

```bash
cd apps/ops && sed -n '1,30p' src/components/Sidebar.tsx
sed -n '90,130p' src/components/Sidebar.tsx
```

Note the 60s `setInterval` poll of `/api/internal/needs-review/counts` and how it sums `duplicates + duplicatePlayers`. This logic stays in the new Sidebar.

- [ ] **Step 2: Rewrite Sidebar.tsx**

Replace the entire contents of `apps/ops/src/components/Sidebar.tsx` with:

```tsx
// apps/ops/src/components/Sidebar.tsx
// Two-column sidebar shell: SidebarPrimary (icons) + SidebarSecondary (pages)
// + auth footer at the bottom. Owns badge polling for the Needs Review queue.
'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { SidebarPrimary } from './SidebarPrimary'
import { SidebarSecondary } from './SidebarSecondary'
import { areaFor } from '@/lib/sidebar-areas'

interface Props {
  userEmail: string | null
}

export function Sidebar({ userEmail }: Props) {
  const pathname = usePathname() ?? '/'
  const activeAreaId = areaFor(pathname)
  const activePageHref = pathname.split('?')[0]

  const [needsReviewCount, setNeedsReviewCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const r = await fetch('/api/internal/needs-review/counts', { cache: 'no-store' })
        if (!r.ok) return
        const json = (await r.json()) as { duplicates?: number; duplicatePlayers?: number }
        if (!cancelled) setNeedsReviewCount((json.duplicates ?? 0) + (json.duplicatePlayers ?? 0))
      } catch {
        // silent — badge falls back to 0
      }
    }
    poll()
    const id = setInterval(poll, 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const badges = needsReviewCount > 0 ? { '/needs-review': needsReviewCount } : {}

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <SidebarPrimary activeAreaId={activeAreaId} needsReviewCount={needsReviewCount} />

      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <SidebarSecondary
          activeAreaId={activeAreaId}
          activePageHref={activePageHref}
          badges={badges}
        />

        {userEmail && (
          <div
            style={{
              borderTop: '1px solid var(--border-subtle)',
              padding: '12px 16px',
              fontSize: 11,
              color: 'var(--status-neutral)',
              width: 248,
              background: 'var(--bg-card)',
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
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Decide on SidebarNavItem.tsx — keep or delete**

Run:
```bash
cd apps/ops && grep -rE "from.*['\"]\\./SidebarNavItem['\"]|from.*['\"]@/components/SidebarNavItem['\"]" src/ 2>/dev/null
```
Expected: no hits (the old Sidebar was the only consumer). If grep is clean, delete:
```bash
rm apps/ops/src/components/SidebarNavItem.tsx
```

If grep DOES return hits (unlikely but verify), leave the file in place and skip the deletion.

- [ ] **Step 4: Lint + typecheck**

```bash
cd apps/ops && npx eslint 'src/components/Sidebar.tsx' && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/components/Sidebar.tsx
git add -A apps/ops/src/components/SidebarNavItem.tsx 2>/dev/null || true  # in case it was deleted
git commit -m "refactor(ops): Sidebar uses 2-column composition (SidebarPrimary + Secondary)"
```

---

## Task 5: ActivityRail component with stub data

**Files:**
- Create: `apps/ops/src/components/ActivityRail.tsx`

**Goal:** A 280px-wide right-side feed with 8 hardcoded padel-flavored events. Collapsible via header arrow, state persisted in localStorage.

- [ ] **Step 1: Create the component**

```tsx
// apps/ops/src/components/ActivityRail.tsx
// Right-side activity feed. Stub data for v1 — real backend lands in a follow-up.
// Collapsible (state persisted in localStorage).
'use client'

import { useEffect, useState } from 'react'

type EventType = 'live' | 'warn' | 'info' | 'risk'

interface ActivityEvent {
  id: string
  type: EventType
  text: string
  highlight?: string
  source: string
  age: string
}

const STUB_EVENTS: ActivityEvent[] = [
  { id: '1', type: 'live', text: 'Match started: ', highlight: 'Galán/Chingotto vs Yanguas/Garrido · P2 Vienna', source: 'padelapi', age: '14s ago' },
  { id: '2', type: 'info', text: 'Set finished: ', highlight: 'Bea González took set 1 (6-3)', source: 'relay', age: '32s ago' },
  { id: '3', type: 'warn', text: 'OOP changes on ', highlight: 'FIP Silver Dubai', source: 'padelgod', age: '2m ago' },
  { id: '4', type: 'info', text: 'Rankings updated · race-men week 21', source: 'padelgod', age: '4m ago' },
  { id: '5', type: 'live', text: 'Operator merged 2 player duplicates (', highlight: 'Brea variants', source: 'manual', age: '7m ago' },
  { id: '6', type: 'warn', text: 'New tournament duplicate cluster: ', highlight: 'FIP Promises Teheran', source: 'auto', age: '11m ago' },
  { id: '7', type: 'info', text: 'Push fanout: ', highlight: '3,420 subscribers', source: 'cron', age: '14m ago' },
  { id: '8', type: 'live', text: 'Worker ok: ', highlight: 'tournament-discovery → 4 new events', source: 'padelgod', age: '18m ago' },
]

const COLLAPSE_KEY = 'ops_activity_rail_collapsed'

export function ActivityRail() {
  const [collapsed, setCollapsed] = useState(false)

  // Read collapse state from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(COLLAPSE_KEY)
      if (stored === 'true') setCollapsed(true)
    } catch {
      // SSR / disabled storage — leave at default
    }
  }, [])

  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem(COLLAPSE_KEY, String(next)) } catch { /* ignore */ }
  }

  if (collapsed) {
    return (
      <button
        onClick={toggle}
        title="Open activity feed"
        style={{
          width: 32,
          height: '100vh',
          background: 'var(--bg-card)',
          borderLeft: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: 'var(--status-neutral)',
          flexShrink: 0,
          border: 'none',
          padding: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
    )
  }

  return (
    <aside
      style={{
        width: 280,
        background: 'var(--bg-card)',
        borderLeft: '1px solid var(--border-subtle)',
        flexShrink: 0,
        overflowY: 'auto',
        maxHeight: '100vh',
        position: 'sticky',
        top: 0,
      }}
    >
      <header
        style={{
          padding: '14px 18px 10px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--status-live)',
              boxShadow: '0 0 8px rgba(34, 197, 94, 0.5)',
              animation: 'opsLivePulse 1.6s ease-in-out infinite',
            }}
          />
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--brand-primary-fg)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Activity
          </span>
        </div>
        <button
          onClick={toggle}
          title="Collapse activity feed"
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--status-neutral)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </header>

      <div>
        {STUB_EVENTS.map(ev => <EventRow key={ev.id} ev={ev} />)}
      </div>

      <style>{`
        @keyframes opsLivePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.55; transform: scale(0.88); }
        }
      `}</style>
    </aside>
  )
}

function EventRow({ ev }: { ev: ActivityEvent }) {
  const dotColor = {
    live: 'var(--status-live)',
    warn: 'var(--status-warn)',
    info: 'var(--status-info)',
    risk: 'var(--status-risk)',
  }[ev.type]

  return (
    <div
      style={{
        padding: '10px 18px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        gap: 10,
        transition: 'background var(--dur-fast) var(--ease-out)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0, 0, 0, 0.02)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: dotColor,
          flexShrink: 0,
          marginTop: 6,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--brand-primary-fg)', lineHeight: 1.45 }}>
          {ev.text}
          {ev.highlight && <strong style={{ color: 'var(--lime-deep)', fontWeight: 600 }}>{ev.highlight}</strong>}
        </div>
        <div style={{ fontSize: 10, color: 'var(--status-neutral)', marginTop: 3 }}>
          {ev.source} · {ev.age}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Lint + typecheck**

```bash
cd apps/ops && npx eslint 'src/components/ActivityRail.tsx' && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/components/ActivityRail.tsx
git commit -m "feat(ops): ActivityRail right-side feed with stub data + localStorage collapse"
```

---

## Task 6: Mount ActivityRail in app layout

**Files:**
- Modify: `apps/ops/src/app/(app)/layout.tsx`

**Goal:** Render the activity rail on the right side of every authenticated page. Should be on the SAME flex row as the sidebar + main content area.

- [ ] **Step 1: Update the layout**

Replace the entire contents of `apps/ops/src/app/(app)/layout.tsx` with:

```tsx
// apps/ops/src/app/(app)/layout.tsx
// Auth + operator gate, plus the sidebar + main + activity rail shell
// for every (app)/ route.

import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/Sidebar'
import { ActivityRail } from '@/components/ActivityRail'

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
      <ActivityRail />
    </div>
  )
}
```

The main difference vs. before: `<ActivityRail />` added after `<main>` (so the rail is on the right). `Sidebar` no longer renders its own outer flex container — the layout's flex is the only one.

- [ ] **Step 2: Lint + typecheck**

```bash
cd apps/ops && npx eslint 'src/app/(app)/layout.tsx' && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 3: Visual smoke (if dev server is running)**

Open `/today` in the browser. Verify:
- Left side: 78px icon column with brand mark + 5 area icons
- Next: 248px page list ("Today" page label, single row "Today" active with lime pill)
- Middle: page content (Today dashboard)
- Right: 280px Activity rail with 8 events

Click Tournament Ops icon → URL goes `/tournament-explorer`, primary icon active highlight moves, secondary column shows 4 Tournament Ops pages, "Needs Review" row shows amber badge if any.

Click "Needs Review" row → URL goes `/needs-review`, that row becomes the lime-pill-active row.

Click the `›` arrow in the Activity header → rail collapses to a 32px tab with a `‹` icon. Click that tab → expands back.

- [ ] **Step 4: Commit**

```bash
git add apps/ops/src/app/\(app\)/layout.tsx
git commit -m "feat(ops): mount ActivityRail in app layout shell"
```

---

## Task 7: README + final smoke + PR prep

**Files:**
- Modify: `apps/ops/README.md`

**Goal:** Document the new sidebar pattern + activity rail. Run the test suite to confirm baseline preserved. Final visual smoke.

- [ ] **Step 1: Append to apps/ops/README.md**

Find an appropriate section (or append at the end) and add:

```markdown
### Sidebar 2-column layout (added 2026-05-24)

The admin app uses a two-column drilldown sidebar (Sentry / Discord pattern):

- **Primary column** (78px) — 5 area icons + brand mark. Areas: Home / Tournament Ops / Catalogs / Content / System. The active area is derived from `pathname` via `areaFor(pathname)` in `src/lib/sidebar-areas.ts`.
- **Secondary column** (248px) — pages within the active area + signed-in-as footer.
- **Activity rail** (280px, right side) — stub event feed. Real backend endpoint coming in a follow-up PR. Collapse state persisted in localStorage (`ops_activity_rail_collapsed`).

**Active state cue:** lime pill background + spring-in left edge bar + bold lime-deep text. No dots.

**Needs Review badge** appears on the Tournament Ops primary icon AND on the Needs Review row in the secondary column, so the count is visible regardless of which area is open.

**To add a new page:** update `AREAS` in `src/lib/sidebar-areas.ts` (add a `Page` entry to the appropriate area), then ensure `areaFor(pathname)` routes its href to the right area.
```

- [ ] **Step 2: Run the full test suite**

```bash
cd apps/ops && npx vitest run 2>&1 | tail -5
```
Expected: 53/55 baseline (the 2 pre-existing bcryptjs failures) + the new 22 tests from sidebar-areas → **75/77 passing**.

- [ ] **Step 3: Lint pass on all touched files**

```bash
cd apps/ops && npx eslint \
  'src/lib/sidebar-areas.ts' \
  'src/lib/__tests__/sidebar-areas.test.ts' \
  'src/components/Sidebar.tsx' \
  'src/components/SidebarPrimary.tsx' \
  'src/components/SidebarSecondary.tsx' \
  'src/components/ActivityRail.tsx' \
  'src/app/(app)/layout.tsx'
```
Expected: clean on touched files.

- [ ] **Step 4: Commit + branch summary**

```bash
git add apps/ops/README.md
git commit -m "docs(ops): document the 2-column sidebar + activity rail"
git log --oneline origin/main..HEAD
git diff origin/main..HEAD --stat -- 'apps/ops/**/*.ts' 'apps/ops/**/*.tsx' 'apps/ops/**/*.css' 'apps/ops/README.md'
```

- [ ] **Step 5: PR description draft (for the human)**

```markdown
## Summary
Plan 6 — Sidebar 2-column drilldown + Activity Rail (stub).

- Sidebar split into primary icon column (78px) + secondary pages column (248px). Same 5 areas as today (Home / Tournament Ops / Catalogs / Content / System) — no IA changes.
- Lime accent (`#84cc16`) on active states. Lime gradient left edge bar springs in on active. Hover chevron `›` on secondary rows.
- No dots — replaced with lime pill background + bold lime-deep text + edge bar.
- Activity rail (280px) on the right side with 8 stub padel-flavored events (match started, set finished, OOP change detected, etc.). Collapsible (persisted in localStorage).
- Needs Review badge now anchors on BOTH the Tournament Ops primary icon AND the Needs Review row.

## Spec & plan
- Spec: `docs/superpowers/specs/2026-05-24-sidebar-2col-activity-feed-design.md`
- Plan: `docs/superpowers/plans/2026-05-24-sidebar-2col-activity-rail.md`

## Test plan
- [ ] Brand mark hovers with tilt + scale
- [ ] Clicking any area icon navigates to its first page
- [ ] Clicking a secondary row navigates to that page
- [ ] Active state: lime pill bg + edge bar springs in
- [ ] Hover state: chevron `›` slides in
- [ ] Needs Review badge shows on Tournament Ops icon AND on the Needs Review row when count > 0
- [ ] Activity rail collapses + remembers state across page navigations
- [ ] All existing pages still render correctly (Today, /players, /needs-review, etc.)

## Follow-ups
- Real activity feed backend — `/api/internal/activity-feed` endpoint pulling from matches, padelgod-runs, audit-log, etc.
- Keyboard shortcuts ⌘1-⌘5 for area jumps
- Top status bar (live matches count, coverage %, etc.) — sportsbook mockup territory
- Responsive collapse at narrow viewports
```

---

## Self-Review

### Spec coverage
- ✅ 2-column sidebar with primary (78px) + secondary (248px) — T2 + T3
- ✅ 5 areas, no IA change — T1 (registry)
- ✅ Lime accent + tokens — T1 (globals.css)
- ✅ No dots — T3 (uses pill + edge bar)
- ✅ Spring transitions, ripple-feel — T2 + T3 (transform + ease-spring on edge bars; ripple deferred since hover/active already feel satisfying)
- ✅ Hover chevron on secondary rows — T3
- ✅ Needs Review badge on primary icon — T2 (passes `badge` prop) + T4 (passes badges map)
- ✅ Activity rail on right side — T5 + T6
- ✅ Activity rail collapse + localStorage — T5
- ✅ Path → active area helper with fallback — T1 (`areaFor`)
- ✅ Brand mark hover (tilt + scale) — T2
- ✅ README documentation — T7

### Placeholder scan
No "TBD", "fill in later", or other red-flag patterns. All code blocks complete.

### Type consistency
- `AreaId` defined in T1, imported in T2 + T3 + T4 ✅
- `AREAS` array defined in T1, imported in T2 + T3 ✅
- `Sidebar` accepts `userEmail: string | null` (T4) — matches existing layout's prop ✅
- `SidebarPrimary` props: `{ activeAreaId, needsReviewCount }` consistent between T2 + T4 ✅
- `SidebarSecondary` props: `{ activeAreaId, activePageHref, badges }` consistent between T3 + T4 ✅
- `ActivityRail` is prop-less in T5 + T6 ✅

### Ripple wired in
The lime click ripple is included in T1 (shared `spawnRipple` helper + `.ops-ripple` CSS), T2 (primary icon click handler), and T3 (secondary row click handler). User requested it post-spec-draft so we kept it.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-24-sidebar-2col-activity-rail.md`.**

## Execution options

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review per task (spec then code quality), continuous progress
**2. Inline Execution** — execute tasks in this session with batch checkpoints

Which?

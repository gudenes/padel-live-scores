# Live Odds Admin Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Live Odds operations console (new app shell + Live Odds page) in `apps/ops`, matching the Claude Design handoff, rendered against a typed data contract + stub provider so it is fully demoable before the real win-probability model/feed exist.

**Architecture:** A column app-shell (global header + always-dark collapsible rail + per-page header) wraps the existing `apps/ops` pages. The Live Odds route renders a KPI row + 2-column content (live matches table + sticky detail panel) from a `useLiveOdds()` provider. Light/dark theme and Nachos/Labs brand are `data-*` attributes on `<html>` with `localStorage` persistence. Connection state (`loading|live|reconnecting|offline`) is a `data-conn` attribute driving skeleton/banner/frozen treatments. Logic (odds math, history seeding, KPI aggregation, chart mapping) is unit-tested; visual fidelity is verified against three screenshots.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest (`apps/ops` test runner), plain CSS (tokens in `globals.css`, component styles in co-located `.css` files), CSS custom properties, Google Fonts (Bricolage Grotesque / JetBrains Mono / Inter Tight).

**Reference (source of truth for exact values):** the design handoff is copied into the repo in Task 1 at `apps/ops/src/app/(app)/live-odds/_reference/` (`admin.css`, `admin.js`, `Padel Admin.html`, `padel-nachos-paddle.png`). The spec is `docs/superpowers/specs/2026-05-30-live-odds-admin-design.md`.

**Conventions for this plan:**
- `apps/ops` dev server: `cd apps/ops && npm run dev` (port from its config); build: `npm run build`; tests: `npx vitest run <path>` from `apps/ops`.
- All paths below are relative to repo root unless noted.
- "Verify visually" = run dev, open `/live-odds`, compare to `screenshots/0X-*.png` from the handoff.
- Commit after each task.

---

## File structure (created/modified)

```
apps/ops/src/
  app/
    globals.css                                  # MODIFY: + font import, theme tokens, rail tokens
    (app)/
      layout.tsx                                 # MODIFY: wrap children in <AppShell>
      live-odds/
        page.tsx                                 # CREATE: server page → <LiveOddsView>
        live-odds.css                            # CREATE: component styles (adapted from _reference/admin.css)
        _reference/                              # CREATE (Task 1): copied handoff files
        _lib/
          types.ts                               # CREATE: data contract
          odds-math.ts                           # CREATE: fmtOdds, seedHistory, jitter, kpis, chartPoints
          stub-provider.ts                       # CREATE: seed data + simulated feed
          useLiveOdds.ts                         # CREATE: provider hook
          __tests__/odds-math.test.ts            # CREATE: unit tests
        _components/
          LiveOddsView.tsx                       # CREATE: client orchestrator
          KpiRow.tsx                             # CREATE
          LiveMatchesTable.tsx                   # CREATE
          MatchRow.tsx                           # CREATE
          OddsBar.tsx                            # CREATE
          ConnectionBanner.tsx                   # CREATE
          TableSkeleton.tsx                      # CREATE
          DetailPanel.tsx                        # CREATE
          WinProbChart.tsx                       # CREATE
          icons.tsx                              # CREATE: shared SVG <symbol> sprite + <Icon>
  components/
    shell/
      AppShell.tsx                               # CREATE: header + rail + main slot
      GlobalHeader.tsx                           # CREATE
      Rail.tsx                                   # CREATE (always-dark; reuses canonical IA)
      ThemeProvider.tsx                          # CREATE: data-theme + persistence
      BrandProvider.tsx                          # CREATE: data-brand + persistence
      shell.css                                  # CREATE: header + rail styles (adapted from _reference/admin.css)
      __tests__/ThemeProvider.test.tsx           # CREATE
```

The Rail nav list is the canonical IA already in `apps/ops/src/components/Sidebar.tsx` (Today, Tournament Ops, Catalogs, Content, System). Rail.tsx reuses that list and adds **Live Odds** as the first item.

---

## Task 1: Bring the handoff reference into the repo + add design tokens

**Files:**
- Create: `apps/ops/src/app/(app)/live-odds/_reference/{admin.css,admin.js,Padel Admin.html,padel-nachos-paddle.png}`
- Modify: `apps/ops/src/app/globals.css`

- [ ] **Step 1: Copy the handoff reference files into the repo**

```bash
mkdir -p "apps/ops/src/app/(app)/live-odds/_reference"
cp "/Volumes/Crucial/Download - Mac/design_handoff_padel_admin/reference/admin.css" "apps/ops/src/app/(app)/live-odds/_reference/admin.css"
cp "/Volumes/Crucial/Download - Mac/design_handoff_padel_admin/reference/admin.js" "apps/ops/src/app/(app)/live-odds/_reference/admin.js"
cp "/Volumes/Crucial/Download - Mac/design_handoff_padel_admin/reference/Padel Admin.html" "apps/ops/src/app/(app)/live-odds/_reference/Padel Admin.html"
cp "/Volumes/Crucial/Download - Mac/design_handoff_padel_admin/reference/padel-nachos-paddle.png" "apps/ops/src/app/(app)/live-odds/_reference/padel-nachos-paddle.png"
```

- [ ] **Step 2: Add the font import + token blocks to `globals.css`**

Open `apps/ops/src/app/(app)/live-odds/_reference/admin.css` and copy two things into `apps/ops/src/app/globals.css`, appended after the existing content:
1. The `@import url('https://fonts.googleapis.com/...Bricolage...JetBrains Mono...')` line (admin.css line 5) — move it to the **top** of globals.css (CSS requires `@import` before other rules).
2. The entire `:root{…}` dark token block (admin.css lines 8–86) **and** the `:root[data-theme="light"]{…}` block (lines 88–139), verbatim.

Do **not** copy the `*{box-sizing}` / `body{…}` base resets from admin.css (the app already has them) except confirm `body` has **no** `transition` on `color`/`background` (the documented Chromium theme-flip bug). If globals.css sets such a transition, remove it.

- [ ] **Step 3: Verify the app still builds**

Run: `cd apps/ops && npm run build`
Expected: build succeeds; no CSS parse errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/ops/src/app/(app)/live-odds/_reference" apps/ops/src/app/globals.css
git commit -m "feat(ops): add live-odds design reference + theme tokens"
```

---

## Task 2: ThemeProvider + BrandProvider

> **Testing note:** `apps/ops` has no DOM test infra (no `jsdom`/`@testing-library/react`; all existing tests are pure-logic `.test.ts` in node env). Do **not** add component/RTL tests here — that infra is out of scope. These providers are verified via `tsc` and the shell rendering in Task 7 (manual theme toggle + persistence check in the browser). The plan's real unit-test coverage lives in Task 9 (odds-math).

**Files:**
- Create: `apps/ops/src/components/shell/ThemeProvider.tsx`
- Create: `apps/ops/src/components/shell/BrandProvider.tsx`

- [ ] **Step 1: Implement ThemeProvider**

```tsx
// apps/ops/src/components/shell/ThemeProvider.tsx
'use client'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'

type Theme = 'light' | 'dark'
const KEY = 'padel.theme'
const Ctx = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'light', toggle: () => {} })
export const useTheme = () => useContext(Ctx)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light')
  // hydrate from storage once on mount
  useEffect(() => {
    let stored: Theme | null = null
    try { stored = localStorage.getItem(KEY) as Theme | null } catch {}
    if (stored === 'light' || stored === 'dark') setTheme(stored)
  }, [])
  // reflect to <html> + persist
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem(KEY, theme) } catch {}
  }, [theme])
  const toggle = useCallback(() => setTheme(t => (t === 'light' ? 'dark' : 'light')), [])
  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>
}
```

- [ ] **Step 2: Implement BrandProvider (same pattern)**

```tsx
// apps/ops/src/components/shell/BrandProvider.tsx
'use client'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'

export type Brand = 'nachos' | 'labs'
const KEY = 'padel.brand'
export const BRANDS: Record<Brand, { wordmark: string; accentWord: string; host: string; markGlyph: 'paddle' | 'L' }> = {
  nachos: { wordmark: 'PADEL', accentWord: 'NACHOS', host: 'padelnachos.com', markGlyph: 'paddle' },
  labs:   { wordmark: 'PADEL', accentWord: 'LABS',   host: 'padellabs.tech',  markGlyph: 'L' },
}
const Ctx = createContext<{ brand: Brand; setBrand: (b: Brand) => void }>({ brand: 'nachos', setBrand: () => {} })
export const useBrand = () => useContext(Ctx)

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [brand, setBrandState] = useState<Brand>('nachos')
  useEffect(() => {
    let stored: Brand | null = null
    try { stored = localStorage.getItem(KEY) as Brand | null } catch {}
    if (stored === 'nachos' || stored === 'labs') setBrandState(stored)
  }, [])
  useEffect(() => {
    document.documentElement.setAttribute('data-brand', brand)
    try { localStorage.setItem(KEY, brand) } catch {}
  }, [brand])
  const setBrand = useCallback((b: Brand) => setBrandState(b), [])
  return <Ctx.Provider value={{ brand, setBrand }}>{children}</Ctx.Provider>
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd apps/ops && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/ops/src/components/shell/ThemeProvider.tsx apps/ops/src/components/shell/BrandProvider.tsx
git commit -m "feat(ops): theme + brand providers with persistence"
```

---

## Task 3: Shared icon sprite

**Files:**
- Create: `apps/ops/src/app/(app)/live-odds/_components/icons.tsx`

- [ ] **Step 1: Create the icon sprite + Icon component**

Open `_reference/Padel Admin.html`, find the `<svg ...><defs>…<symbol id="i-*">…</symbol></defs></svg>` sprite block, and port every `<symbol>` into the array below (ids: today, odds, grid, list, flag, play, users, tag, video, yt, doc, film, heart, check, server, eye, matrix, toggle, arch, bell, sun, moon, search, pin, share, retry). Each is `viewBox="0 0 24 24"`, `stroke-width 2.4`, `currentColor`. For any missing id, use the matching Lucide icon at `strokeWidth={2.5}`.

```tsx
// apps/ops/src/app/(app)/live-odds/_components/icons.tsx
import type { ReactNode } from 'react'

// Inline <symbol> sprite — rendered once near the root.
export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        {/* PORT every <symbol id="i-..."> from _reference/Padel Admin.html verbatim here */}
        {/* e.g. <symbol id="i-odds" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h3l3-8 4 16 3-8h5"/></symbol> */}
      </defs>
    </svg>
  )
}

export function Icon({ id, className }: { id: string; className?: string }): ReactNode {
  return <svg className={className} aria-hidden><use href={`#i-${id}`} /></svg>
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/ops && npx tsc --noEmit`
Expected: no type errors in icons.tsx.

- [ ] **Step 3: Commit**

```bash
git add "apps/ops/src/app/(app)/live-odds/_components/icons.tsx"
git commit -m "feat(ops): shared icon sprite for live odds"
```

---

## Task 4: Shell styles (header + rail CSS)

**Files:**
- Create: `apps/ops/src/components/shell/shell.css`

- [ ] **Step 1: Extract shell styles from the reference**

Create `shell.css` and copy, **verbatim**, these rule groups from `_reference/admin.css`:
- Base helpers: `.mono`, `.disp`, `.app`, `::selection` (lines 145–148).
- Global header: `.gheader` through `.shell` (lines 150–209) — brand, brandmenu, search, gright, envpill, iconbtn, avatar.
- Rail: `.rail` through the `@keyframes pulse` (lines 211–279).
- Main + page header: `.main`, `.pagehead`, `.crumb`, `.modelpill`, `.toggle`, `.sw`, `.clock`, `.pagebody` (lines 281–302).

Do not modify values. These reference `var(--*)` tokens already added to globals.css in Task 1.

- [ ] **Step 2: Verify CSS parses**

Run: `cd apps/ops && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/components/shell/shell.css
git commit -m "feat(ops): shell (header + rail) styles"
```

---

## Task 5: GlobalHeader component

**Files:**
- Create: `apps/ops/src/components/shell/GlobalHeader.tsx`

- [ ] **Step 1: Implement GlobalHeader**

Markup mirrors `_reference/Padel Admin.html`'s `.gheader`. Uses `useBrand`, `useTheme`, and `Icon`. Brand mark: paddle PNG for nachos (served from `_reference/padel-nachos-paddle.png` — copy it to `apps/ops/public/brand/padel-nachos-paddle.png` in Step 2), italic "L" tile for labs.

```tsx
// apps/ops/src/components/shell/GlobalHeader.tsx
'use client'
import { useState } from 'react'
import { useTheme } from './ThemeProvider'
import { useBrand, BRANDS, type Brand } from './BrandProvider'
import { Icon } from '../../app/(app)/live-odds/_components/icons'

export function GlobalHeader() {
  const { theme, toggle } = useTheme()
  const { brand, setBrand } = useBrand()
  const [menuOpen, setMenuOpen] = useState(false)
  const b = BRANDS[brand]
  return (
    <header className="gheader">
      <div className="brand" onMouseLeave={() => setMenuOpen(false)}>
        <button className="brandbtn" onClick={() => setMenuOpen(o => !o)} aria-haspopup="menu" aria-expanded={menuOpen}>
          <span className={`mark ${brand === 'labs' ? 'labs' : ''}`}>
            {b.markGlyph === 'paddle'
              ? <img src="/brand/padel-nachos-paddle.png" alt="" />
              : <span className="labglyph" style={{ display: 'block' }}>L</span>}
          </span>
          <span className="wmwrap">
            <span className="wm">{b.wordmark}<span className="n" style={brand === 'labs' ? { color: 'var(--lime-text)' } : undefined}>{b.accentWord}</span></span>
            <span className="wmsub"><span className="tag">ADMIN</span>{b.host}</span>
          </span>
          <span className="bchev">▾</span>
        </button>
        <div className={`brandmenu ${menuOpen ? 'open' : ''}`} role="menu">
          <div className="bm-h">Switch workspace</div>
          {(Object.keys(BRANDS) as Brand[]).map(key => (
            <div key={key} className={`bm-i ${key === 'labs' ? 'labs' : ''} ${brand === key ? 'on' : ''}`} role="menuitem"
                 onClick={() => { setBrand(key); setMenuOpen(false) }}>
              <span className="bm-mk">{key === 'nachos' ? <img src="/brand/padel-nachos-paddle.png" alt="" /> : 'L'}</span>
              <span className="bm-tx"><b>Padel {key === 'nachos' ? 'Nachos' : 'Labs'}</b><span>{BRANDS[key].host}</span></span>
              <span className="bm-ck">✓</span>
            </div>
          ))}
        </div>
      </div>

      <label className="gsearch">
        <Icon id="search" />
        <input placeholder="Search matches, players, tournaments, pages…" />
        <kbd>⌘K</kbd>
      </label>

      <div className="gright">
        <span className="envpill"><span className="d" />Prod</span>
        <button className="iconbtn" onClick={toggle} aria-label="Toggle theme">
          <Icon id={theme === 'light' ? 'moon' : 'sun'} />
        </button>
        <button className="iconbtn" aria-label="Notifications"><Icon id="bell" /><span className="nd" /></button>
        <span className="avatar">PN</span>
      </div>
    </header>
  )
}
```

- [ ] **Step 2: Copy the paddle asset into public**

```bash
mkdir -p apps/ops/public/brand
cp "apps/ops/src/app/(app)/live-odds/_reference/padel-nachos-paddle.png" apps/ops/public/brand/padel-nachos-paddle.png
```

- [ ] **Step 3: Verify it compiles**

Run: `cd apps/ops && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/ops/src/components/shell/GlobalHeader.tsx apps/ops/public/brand/padel-nachos-paddle.png
git commit -m "feat(ops): global header with brand switcher, search, theme toggle"
```

---

## Task 6: Rail component (always dark)

**Files:**
- Create: `apps/ops/src/components/shell/Rail.tsx`

- [ ] **Step 1: Implement Rail with the canonical IA + collapse + accordion**

Reuse the nav groups from `apps/ops/src/components/Sidebar.tsx` (read it for the exact `href`/`label` list), adding **Live Odds** first. Map each item to an icon id (live-odds→odds, today→today, tournament-explorer→grid, entry-lists→list, needs-review→flag, simulator→play, players→users, brands→tag, streams→video, yt-channels→yt, news→doc, highlights→film, integration-health→heart, data-quality→check, padelgod-health→server, shadow-mode→eye, coverage-matrix→matrix, feature-flags→toggle, architecture→arch).

```tsx
// apps/ops/src/components/shell/Rail.tsx
'use client'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useState } from 'react'
import { Icon } from '../../app/(app)/live-odds/_components/icons'

type Item = { href: string; label: string; icon: string; pill?: 'live'; cnt?: number }
type Group = { label?: string; items: Item[] }

const GROUPS: Group[] = [
  { items: [
    { href: '/live-odds', label: 'Live Odds', icon: 'odds', pill: 'live' },
    { href: '/today', label: 'Today', icon: 'today' },
  ]},
  { label: 'Tournament Ops', items: [
    { href: '/tournament-explorer', label: 'Tournament Explorer', icon: 'grid' },
    { href: '/entry-lists', label: 'Entry Lists', icon: 'list' },
    { href: '/needs-review', label: 'Needs Review', icon: 'flag', cnt: 3 },
    { href: '/simulator', label: 'Simulator', icon: 'play' },
  ]},
  { label: 'Catalogs', items: [
    { href: '/players', label: 'Players', icon: 'users' },
    { href: '/brands', label: 'Brands & Equipment', icon: 'tag' },
    { href: '/streams', label: 'Streams', icon: 'video' },
    { href: '/yt-channels', label: 'YT Channels', icon: 'yt' },
  ]},
  { label: 'Content', items: [
    { href: '/news', label: 'News', icon: 'doc' },
    { href: '/highlights', label: 'Highlights', icon: 'film' },
  ]},
  { label: 'System', items: [
    { href: '/system/integration-health', label: 'Integration Health', icon: 'heart' },
    { href: '/system/data-quality', label: 'Data Quality', icon: 'check' },
    { href: '/system/padelgod-health', label: 'Padelgod Health', icon: 'server' },
    { href: '/system/shadow-mode', label: 'Shadow Mode', icon: 'eye' },
    { href: '/system/coverage-matrix', label: 'Coverage Matrix', icon: 'matrix' },
    { href: '/system/feature-flags', label: 'Feature Flags', icon: 'toggle' },
    { href: '/system/architecture', label: 'Architecture', icon: 'arch' },
  ]},
]

export function Rail({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname()
  const [closed, setClosed] = useState<Set<string>>(new Set(['System']))
  const toggleGroup = (g: string) => setClosed(s => { const n = new Set(s); n.has(g) ? n.delete(g) : n.add(g); return n })
  return (
    <nav className="rail">
      <div className="railtop">
        <span className="rt-lbl">Console</span>
        <button className="collapse" onClick={onToggle} aria-label="Collapse sidebar"><Icon id={collapsed ? 'arch' : 'arch'} /></button>
      </div>
      <div className="railscroll">
        {GROUPS.map((g, gi) => (
          <div key={gi} className={`navgroup ${g.label && closed.has(g.label) ? 'closed' : ''}`}>
            {g.label && (
              <div className="gl" onClick={() => !collapsed && toggleGroup(g.label!)}>
                <span className="glabel">{g.label}</span>
                <span className="gcount">{g.items.length}</span>
                <span className="chev">▾</span>
              </div>
            )}
            <div className="items">
              {g.items.map(it => {
                const active = pathname === it.href || pathname.startsWith(it.href + '/')
                return (
                  <Link key={it.href} href={it.href} className={`nav ${active ? 'active' : ''}`} data-tip={it.label}>
                    <Icon id={it.icon} />
                    <span className="lbl">{it.label}</span>
                    {it.pill === 'live' && <span className="pill"><span className="d" />LIVE</span>}
                    {it.cnt != null && <span className="cnt">{it.cnt}</span>}
                    {(it.pill || it.cnt != null) && <span className="railpill" />}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="railfoot" id="railFoot">
        <span className="sdot" />
        <span className="stx"><b>Padelgod</b> online<small>WebSocket · 42ms</small></span>
      </div>
    </nav>
  )
}
```

Note: the collapse button uses the `chev` rotation already styled in CSS via `.collapsed .railtop .collapse svg`. Use a chevron symbol id if present in the sprite; otherwise the `arch` placeholder above is replaced with the real `chev`/`chevron` id from the sprite.

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/ops && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/components/shell/Rail.tsx
git commit -m "feat(ops): always-dark collapsible rail with canonical IA"
```

---

## Task 7: AppShell + mount in layout

**Files:**
- Create: `apps/ops/src/components/shell/AppShell.tsx`
- Modify: `apps/ops/src/app/(app)/layout.tsx`

- [ ] **Step 1: Implement AppShell**

```tsx
// apps/ops/src/components/shell/AppShell.tsx
'use client'
import { useEffect, useState } from 'react'
import { ThemeProvider } from './ThemeProvider'
import { BrandProvider } from './BrandProvider'
import { GlobalHeader } from './GlobalHeader'
import { Rail } from './Rail'
import { IconSprite } from '../../app/(app)/live-odds/_components/icons'
import './shell.css'

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => { try { if (localStorage.getItem('ops.rail.collapsed') === '1') setCollapsed(true) } catch {} }, [])
  useEffect(() => { try { localStorage.setItem('ops.rail.collapsed', collapsed ? '1' : '0') } catch {} }, [collapsed])
  return (
    <ThemeProvider>
      <BrandProvider>
        <IconSprite />
        <div className={`app ${collapsed ? 'collapsed' : ''}`}>
          <GlobalHeader />
          <div className="shell">
            <Rail collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
            <main className="main">{children}</main>
          </div>
        </div>
      </BrandProvider>
    </ThemeProvider>
  )
}
```

- [ ] **Step 2: Mount AppShell in the app layout**

Read `apps/ops/src/app/(app)/layout.tsx`. Replace its current sidebar+content wrapper so children render inside `<AppShell>`. Preserve the existing operator-auth gate (keep the auth check; only swap the visual chrome). Example shape:

```tsx
// apps/ops/src/app/(app)/layout.tsx (illustrative — keep the existing auth logic)
import { AppShell } from '@/components/shell/AppShell'
// ...existing imports + auth/session checks unchanged...
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // ...existing operator-role guard unchanged...
  return <AppShell>{children}</AppShell>
}
```

- [ ] **Step 3: Verify the app boots with the new shell**

Run: `cd apps/ops && npm run dev`, open an existing page (e.g. `/today`).
Expected: new global header + dark rail render; existing page content shows in `.main`; theme toggle + collapse work.

- [ ] **Step 4: Commit**

```bash
git add apps/ops/src/components/shell/AppShell.tsx "apps/ops/src/app/(app)/layout.tsx"
git commit -m "feat(ops): mount new app shell in layout"
```

---

## Task 8: Data contract (types)

**Files:**
- Create: `apps/ops/src/app/(app)/live-odds/_lib/types.ts`

- [ ] **Step 1: Define the contract**

```ts
// apps/ops/src/app/(app)/live-odds/_lib/types.ts
export type ConnectionState = 'loading' | 'live' | 'reconnecting' | 'offline'
export type Confidence = 'full' | 'med' | 'low'
export type MatchStatus = 'Live' | 'Break' | 'Scheduled'

export interface Pair { name: string; gender: 'men' | 'women'; serving: boolean }
export interface SetScore { a: number; b: number; current: boolean }

export interface Match {
  id: string
  pair1: Pair
  pair2: Pair
  tournament: string
  tournamentShort: string
  court: string
  round: string
  setScores: SetScore[]
  gamePoints: { a: string; b: string } | null
  status: MatchStatus
  scheduledTime?: string
  winProbA: number            // favorite-side % for pair1 (0–100)
  fairOddsA: number
  fairOddsB: number
  movement15m: number         // signed
  confidence: Confidence
  lastUpdatedSeconds: number
  winProbHistory: number[]    // capped at 30
  drivers?: {
    firstServe: [number, number]
    breakPts: [string, string]
    totalPts: [number, number]
  }
}

export interface Kpis {
  liveMatches: number
  preMatchModeled: number
  biggestSwing: { pct: number; label: string }
  lowCoverage: number
}

export interface LiveOddsSnapshot {
  matches: Match[]
  kpis: Kpis
}

export type Filters = {
  tournament: string | null
  gender: 'all' | 'men' | 'women'
  tier: string | null
  round: string | null
  status: 'all' | 'live' | 'break' | 'scheduled'
  swingingOnly: boolean
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/ops && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/ops/src/app/(app)/live-odds/_lib/types.ts"
git commit -m "feat(ops): live odds data contract types"
```

---

## Task 9: Odds math (TDD)

**Files:**
- Create: `apps/ops/src/app/(app)/live-odds/_lib/odds-math.ts`
- Test: `apps/ops/src/app/(app)/live-odds/_lib/__tests__/odds-math.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/ops/src/app/(app)/live-odds/_lib/__tests__/odds-math.test.ts
import { fmtOdds, seedHistory, chartPoints, computeKpis, jitterWinProb } from '../odds-math'
import type { Match } from '../types'

describe('odds-math', () => {
  it('fmtOdds returns 100/pct clamped to 2dp', () => {
    expect(fmtOdds(82)).toBe('1.22')
    expect(fmtOdds(18)).toBe('5.56')
    expect(fmtOdds(0)).toBe('100.00')   // clamped to 1
    expect(fmtOdds(100)).toBe('1.01')   // clamped to 99
  })

  it('seedHistory ends exactly at target and stays in 5..95', () => {
    const h = seedHistory(82)
    expect(h[h.length - 1]).toBe(82)
    expect(Math.min(...h)).toBeGreaterThanOrEqual(5)
    expect(Math.max(...h)).toBeLessThanOrEqual(95)
    expect(h.length).toBe(26)
  })

  it('chartPoints maps history to CW x CH coordinates', () => {
    const pts = chartPoints([0, 50, 100], 348, 120)
    expect(pts[0]).toEqual([0, 120])      // 0% → bottom
    expect(pts[1]).toEqual([174, 60])     // 50% → middle
    expect(pts[2]).toEqual([348, 0])      // 100% → top
  })

  it('jitterWinProb clamps to 4..96 and recomputes loser + odds', () => {
    const r = jitterWinProb(95, () => 1) // max positive jitter
    expect(r.pa).toBeLessThanOrEqual(96)
    expect(r.pb).toBe(100 - r.pa)
    expect(r.oa).toBe(fmtOdds(r.pa))
    expect(r.ob).toBe(fmtOdds(r.pb))
  })

  it('computeKpis aggregates the live set', () => {
    const matches = [
      { status: 'Live', confidence: 'full' },
      { status: 'Live', confidence: 'low' },
      { status: 'Scheduled', confidence: 'med' },
    ] as Match[]
    const k = computeKpis(matches)
    expect(k.liveMatches).toBe(2)
    expect(k.lowCoverage).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/ops && npx vitest run "src/app/(app)/live-odds/_lib/__tests__/odds-math.test.ts"`
Expected: FAIL — cannot resolve `../odds-math`.

- [ ] **Step 3: Implement odds-math**

```ts
// apps/ops/src/app/(app)/live-odds/_lib/odds-math.ts
import type { Match, Kpis } from './types'

export function fmtOdds(pct: number): string {
  let p = pct
  if (p < 1) p = 1
  if (p > 99) p = 99
  return (100 / p).toFixed(2)
}

export function seedHistory(target: number, rng: () => number = Math.random): number[] {
  const n = 26
  const hist: number[] = []
  let p = Math.min(92, Math.max(8, target - (rng() * 26 + 8)))
  for (let i = 0; i < n; i++) {
    const pull = (target - p) * 0.1
    p += pull + (rng() - 0.5) * 7
    p = Math.min(95, Math.max(5, p))
    hist.push(p)
  }
  hist[hist.length - 1] = target
  return hist
}

export function chartPoints(hist: number[], cw: number, ch: number): Array<[number, number]> {
  const n = hist.length
  return hist.map((v, i) => [ (n === 1 ? 0 : (i / (n - 1)) * cw), ch - (v / 100) * ch ])
}

export function jitterWinProb(prevA: number, rng: () => number = Math.random) {
  let pa = prevA + Math.round((rng() - 0.5) * 9)
  pa = Math.min(96, Math.max(4, pa))
  const pb = 100 - pa
  return { pa, pb, oa: fmtOdds(pa), ob: fmtOdds(pb), delta: pa - prevA }
}

export function computeKpis(matches: Match[]): Kpis {
  const live = matches.filter(m => m.status === 'Live')
  const lowCoverage = live.filter(m => m.confidence === 'low').length
  let biggest = { pct: 0, label: '' }
  for (const m of live) {
    if (Math.abs(m.movement15m) > Math.abs(biggest.pct)) {
      biggest = { pct: m.movement15m, label: `${m.pair1.name.split(' / ')[0]}/${m.pair1.name.split(' / ')[1] ?? ''} vs ${m.pair2.name.split(' / ')[0]}` }
    }
  }
  return {
    liveMatches: live.length,
    preMatchModeled: matches.filter(m => m.status === 'Scheduled').length,
    biggestSwing: biggest,
    lowCoverage,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/ops && npx vitest run "src/app/(app)/live-odds/_lib/__tests__/odds-math.test.ts"`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/ops/src/app/(app)/live-odds/_lib/odds-math.ts" "apps/ops/src/app/(app)/live-odds/_lib/__tests__/odds-math.test.ts"
git commit -m "feat(ops): odds math (fmtOdds, seedHistory, chartPoints, kpis, jitter)"
```

---

## Task 10: Stub provider (seed data + simulated feed)

**Files:**
- Create: `apps/ops/src/app/(app)/live-odds/_lib/stub-provider.ts`

- [ ] **Step 1: Implement seed data + a tiny event-emitter feed**

Port the 8 seed rows from `_reference/Padel Admin.html` `<tbody>` (`data-*` attributes give p1/p2/pa/pb/oa/ob/tour/meta/status/serve) into typed `Match` objects. Add the simulated motion from `_reference/admin.js` `updRow`/`pump` using `jitterWinProb`.

```ts
// apps/ops/src/app/(app)/live-odds/_lib/stub-provider.ts
import type { LiveOddsSnapshot, Match } from './types'
import { fmtOdds, seedHistory, jitterWinProb, computeKpis } from './odds-math'

// 8 matches — values from _reference/Padel Admin.html <tbody>. `winProbHistory` is seeded at runtime.
const SEED: Match[] = [
  {
    id: 'm1',
    pair1: { name: 'Martínez / Rodríguez', gender: 'men', serving: true },
    pair2: { name: 'Bidahorria / Maldonado', gender: 'men', serving: false },
    tournament: 'Premier Padel Italy Major', tournamentShort: 'Italy Major', court: 'Court 3', round: 'QF',
    setScores: [{ a: 6, b: 3, current: false }, { a: 4, b: 2, current: true }],
    gamePoints: { a: '15', b: '30' }, status: 'Live',
    winProbA: 82, fairOddsA: 1.22, fairOddsB: 5.55, movement15m: 6, confidence: 'full', lastUpdatedSeconds: 5,
    winProbHistory: [], drivers: { firstServe: [72, 61], breakPts: ['3/5', '2/4'], totalPts: [58, 47] },
  },
  {
    id: 'm2',
    pair1: { name: 'Orsi / Zielinski', gender: 'men', serving: false },
    pair2: { name: 'Mornia / Salvado', gender: 'men', serving: true },
    tournament: 'Premier Padel Italy Major', tournamentShort: 'Italy Major', court: 'Court 1', round: 'QF',
    setScores: [{ a: 2, b: 6, current: false }, { a: 6, b: 5, current: true }],
    gamePoints: { a: '40', b: 'AD' }, status: 'Live',
    winProbA: 46, fairOddsA: 2.17, fairOddsB: 1.85, movement15m: -34, confidence: 'full', lastUpdatedSeconds: 8,
    winProbHistory: [],
  },
  {
    id: 'm3',
    pair1: { name: 'Bengoechea / Villa', gender: 'women', serving: false },
    pair2: { name: 'Goyeneche / Ryzhova', gender: 'women', serving: true },
    tournament: 'Premier Padel Italy Major', tournamentShort: 'Italy Major', court: 'Court 2', round: 'QF',
    setScores: [{ a: 4, b: 6, current: false }, { a: 1, b: 2, current: true }],
    gamePoints: null, status: 'Break',
    winProbA: 37, fairOddsA: 2.70, fairOddsB: 1.59, movement15m: -11, confidence: 'full', lastUpdatedSeconds: 6,
    winProbHistory: [],
  },
  {
    id: 'm4',
    pair1: { name: 'Granados / Esbri', gender: 'men', serving: true },
    pair2: { name: 'Sager / Serjani', gender: 'men', serving: false },
    tournament: 'FIP Platinum Sardegna', tournamentShort: 'FIP Sardegna', court: 'Court 1', round: 'R16',
    setScores: [{ a: 7, b: 6, current: false }, { a: 2, b: 1, current: true }],
    gamePoints: { a: '30', b: '15' }, status: 'Live',
    winProbA: 71, fairOddsA: 1.41, fairOddsB: 3.45, movement15m: 4, confidence: 'full', lastUpdatedSeconds: 11,
    winProbHistory: [],
  },
  {
    id: 'm5',
    pair1: { name: 'Herrera / Pons', gender: 'men', serving: false },
    pair2: { name: 'Lacabe / Alonso', gender: 'men', serving: false },
    tournament: 'FIP Platinum Sardegna', tournamentShort: 'FIP Sardegna', court: 'Court 2', round: 'R16',
    setScores: [{ a: 5, b: 3, current: true }],
    gamePoints: { a: '15', b: '15' }, status: 'Live',
    winProbA: 64, fairOddsA: 1.56, fairOddsB: 2.78, movement15m: 0, confidence: 'med', lastUpdatedSeconds: 14,
    winProbHistory: [],
  },
  {
    id: 'm6',
    pair1: { name: 'Gala / Sirvent', gender: 'men', serving: true },
    pair2: { name: 'Ruiz / Sanz', gender: 'men', serving: false },
    tournament: 'Premier Padel Italy Major', tournamentShort: 'Italy Major', court: 'Court 4', round: 'QF',
    setScores: [{ a: 6, b: 3, current: false }, { a: 6, b: 4, current: true }],
    gamePoints: { a: '40', b: '30' }, status: 'Live',
    winProbA: 91, fairOddsA: 1.10, fairOddsB: 9.20, movement15m: 12, confidence: 'full', lastUpdatedSeconds: 5,
    winProbHistory: [],
  },
  {
    id: 'm7',
    pair1: { name: 'Nieto / Bautista', gender: 'men', serving: false },
    pair2: { name: 'Martín / Vicente', gender: 'men', serving: false },
    tournament: 'Premier Padel Italy Major', tournamentShort: 'Italy Major', court: 'Court 3', round: 'QF',
    setScores: [], gamePoints: null, status: 'Scheduled', scheduledTime: '11:00',
    winProbA: 58, fairOddsA: 1.72, fairOddsB: 2.38, movement15m: 0, confidence: 'med', lastUpdatedSeconds: 0,
    winProbHistory: [],
  },
  {
    id: 'm8',
    pair1: { name: 'Sánchez / García', gender: 'women', serving: false },
    pair2: { name: 'Diestro / González', gender: 'women', serving: false },
    tournament: 'FIP Platinum Sardegna', tournamentShort: 'FIP Sardegna', court: 'Court 1', round: 'R16',
    setScores: [], gamePoints: null, status: 'Scheduled', scheduledTime: '11:30',
    winProbA: 52, fairOddsA: 1.92, fairOddsB: 2.08, movement15m: 0, confidence: 'low', lastUpdatedSeconds: 0,
    winProbHistory: [],
  },
]

function snapshot(matches: Match[]): LiveOddsSnapshot {
  return { matches, kpis: computeKpis(matches) }
}

export type FeedListener = (s: LiveOddsSnapshot) => void

export function createStubFeed(reduced: boolean) {
  const matches = SEED.map(m => ({ ...m, winProbHistory: seedHistory(m.winProbA) }))
  let listeners: FeedListener[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false

  const emit = () => listeners.forEach(l => l(snapshot(matches)))

  function pump() {
    const live = matches.filter(m => m.status === 'Live')
    const k = 1 + Math.floor(Math.random() * 2)
    for (let i = 0; i < k; i++) {
      const m = live[Math.floor(Math.random() * live.length)]
      if (!m) continue
      const j = jitterWinProb(m.winProbA)
      m.winProbA = j.pa
      m.fairOddsA = parseFloat(j.oa); m.fairOddsB = parseFloat(j.ob)
      m.movement15m += Math.abs(j.delta) >= 1 ? j.delta : 0
      m.winProbHistory.push(j.pa); if (m.winProbHistory.length > 30) m.winProbHistory.shift()
      m.lastUpdatedSeconds = 3 + Math.floor(Math.random() * 6)
    }
    emit()
    timer = setTimeout(pump, 2200 + Math.random() * 1600)
  }

  return {
    subscribe(fn: FeedListener) { listeners.push(fn); fn(snapshot(matches)); return () => { listeners = listeners.filter(l => l !== fn) } },
    start() { if (running || reduced) return; running = true; timer = setTimeout(pump, 1400) },
    stop() { running = false; if (timer) { clearTimeout(timer); timer = null } },
  }
}
```

- [ ] **Step 2: Verify it compiles + the existing math tests still pass**

Run: `cd apps/ops && npx tsc --noEmit && npx vitest run "src/app/(app)/live-odds/_lib"`
Expected: compiles; odds-math tests pass.

- [ ] **Step 3: Commit**

```bash
git add "apps/ops/src/app/(app)/live-odds/_lib/stub-provider.ts"
git commit -m "feat(ops): stub live-odds feed with seed data + simulated motion"
```

---

## Task 11: useLiveOdds hook + connection state machine

**Files:**
- Create: `apps/ops/src/app/(app)/live-odds/_lib/useLiveOdds.ts`

- [ ] **Step 1: Implement the hook**

Boots `loading → (1.15s) → live`; subscribes to the stub feed; exposes connection, autoRefresh, selection, filters, and a `retry()`. Sets `data-conn` on `<html>`. Honors reduced-motion (no feed start).

```ts
// apps/ops/src/app/(app)/live-odds/_lib/useLiveOdds.ts
'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ConnectionState, Filters, LiveOddsSnapshot } from './types'
import { createStubFeed } from './stub-provider'

export function useLiveOdds() {
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion:reduce)').matches
  const feed = useMemo(() => createStubFeed(reduced), [reduced])
  const [snapshot, setSnapshot] = useState<LiveOddsSnapshot | null>(null)
  const [connection, setConnection] = useState<ConnectionState>('loading')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>({ tournament: 'Premier Padel Italy Major', gender: 'all', tier: null, round: null, status: 'all', swingingOnly: false })
  const started = useRef(false)

  useEffect(() => { document.documentElement.setAttribute('data-conn', connection) }, [connection])

  // boot sequence
  useEffect(() => {
    const unsub = feed.subscribe(s => { setSnapshot(s); setSelectedId(id => id ?? s.matches[0]?.id ?? null) })
    const t = setTimeout(() => setConnection('live'), 1150)
    return () => { clearTimeout(t); unsub() }
  }, [feed])

  // run/stop motion based on connection + autoRefresh
  useEffect(() => {
    if (connection === 'live' && autoRefresh) { if (!started.current) { feed.start(); started.current = true } }
    else { feed.stop(); started.current = false }
    return () => { feed.stop(); started.current = false }
  }, [connection, autoRefresh, feed])

  const retry = () => setConnection('live')
  // demo: cycle live→reconnecting→offline via rail footer click
  const cycleConnection = () => setConnection(c => (c === 'live' ? 'reconnecting' : c === 'reconnecting' ? 'offline' : 'live'))

  return { snapshot, connection, retry, cycleConnection, autoRefresh, setAutoRefresh, selectedId, setSelectedId, filters, setFilters }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/ops && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/ops/src/app/(app)/live-odds/_lib/useLiveOdds.ts"
git commit -m "feat(ops): useLiveOdds hook + connection state machine"
```

---

## Task 12: Live Odds component styles

**Files:**
- Create: `apps/ops/src/app/(app)/live-odds/live-odds.css`

- [ ] **Step 1: Copy the page-scoped styles from the reference**

Create `live-odds.css` and copy, verbatim from `_reference/admin.css`:
- KPIs: `.kpis`…`.kpi .trend` (lines 304–325).
- 2-col content + panel + table + odds bar + movement + confidence + footer: lines 327–438.
- Detail panel: `.detail`…`.dbtn.primary svg` (lines 440–481).
- Responsive container queries: lines 482–488.
- Connection states: lines 490–531.
- Reduced motion: line 533.

These reference tokens already in globals.css. Do not change values.

- [ ] **Step 2: Verify CSS parses**

Run: `cd apps/ops && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add "apps/ops/src/app/(app)/live-odds/live-odds.css"
git commit -m "feat(ops): live odds component styles"
```

---

## Task 13: WinProbChart + OddsBar (leaf components)

**Files:**
- Create: `apps/ops/src/app/(app)/live-odds/_components/WinProbChart.tsx`
- Create: `apps/ops/src/app/(app)/live-odds/_components/OddsBar.tsx`

- [ ] **Step 1: Implement OddsBar**

```tsx
// apps/ops/src/app/(app)/live-odds/_components/OddsBar.tsx
export function OddsBar({ pa, pb, oa, ob }: { pa: number; pb: number; oa: number; ob: number }) {
  return (
    <div className="odds">
      <div className="obar mono">
        <div className="a" style={{ width: `${pa}%` }}>{pa}%</div>
        <div className="b">{pb}%</div>
      </div>
      <div className="osub mono"><span className="fo">{oa.toFixed(2)}</span><span className="fo">{ob.toFixed(2)}</span></div>
    </div>
  )
}
```

- [ ] **Step 2: Implement WinProbChart using chartPoints**

```tsx
// apps/ops/src/app/(app)/live-odds/_components/WinProbChart.tsx
import { chartPoints } from '../_lib/odds-math'

const CW = 348, CH = 120
export function WinProbChart({ history }: { history: number[] }) {
  const pts = chartPoints(history.length ? history : [50], CW, CH)
  const line = 'M' + pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L')
  const area = `${line} L${CW},${CH} L0,${CH} Z`
  const last = pts[pts.length - 1]
  return (
    <div className="chart">
      <svg width="100%" height={CH} viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="wp" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--lime)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--lime)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" y1={CH / 2} x2={CW} y2={CH / 2} stroke="var(--border)" strokeDasharray="3 4" />
        <path d={area} fill="url(#wp)" />
        <path d={line} fill="none" stroke="var(--lime)" strokeWidth="2.2" />
        <circle cx={last[0]} cy={last[1]} r="3.5" fill="var(--lime)" stroke="var(--bg-sunken)" strokeWidth="1.5" />
      </svg>
    </div>
  )
}
```

- [ ] **Step 3: Verify compile**

Run: `cd apps/ops && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/ops/src/app/(app)/live-odds/_components/OddsBar.tsx" "apps/ops/src/app/(app)/live-odds/_components/WinProbChart.tsx"
git commit -m "feat(ops): odds bar + win-prob chart components"
```

---

## Task 14: MatchRow + LiveMatchesTable + KpiRow + DetailPanel

**Files:**
- Create: `apps/ops/src/app/(app)/live-odds/_components/MatchRow.tsx`
- Create: `apps/ops/src/app/(app)/live-odds/_components/KpiRow.tsx`
- Create: `apps/ops/src/app/(app)/live-odds/_components/DetailPanel.tsx`
- Create: `apps/ops/src/app/(app)/live-odds/_components/TableSkeleton.tsx`
- Create: `apps/ops/src/app/(app)/live-odds/_components/ConnectionBanner.tsx`
- Create: `apps/ops/src/app/(app)/live-odds/_components/LiveMatchesTable.tsx`

- [ ] **Step 1: MatchRow** (markup mirrors `_reference/Padel Admin.html` `tbody tr`)

```tsx
// apps/ops/src/app/(app)/live-odds/_components/MatchRow.tsx
import type { Match } from '../_lib/types'
import { OddsBar } from './OddsBar'

function Pairs({ m }: { m: Match }) {
  const lead = m.winProbA >= 50 ? 1 : 2
  const row = (p: Match['pair1'], n: 1 | 2) => (
    <div className={`pp ${n === lead ? 'lead' : 'trail'} ${p.serving ? 'serving' : ''}`}>
      <span className="srv" />{p.name}
      <span className={`gtag ${p.gender === 'men' ? 'g-men' : 'g-women'}`}>{p.gender === 'men' ? 'M' : 'W'}</span>
    </div>
  )
  return <td className="match">{row(m.pair1, 1)}{row(m.pair2, 2)}</td>
}

export function MatchRow({ m, selected, onSelect }: { m: Match; selected: boolean; onSelect: () => void }) {
  const mv = m.movement15m
  return (
    <tr className={selected ? 'sel' : ''} onClick={onSelect}>
      <Pairs m={m} />
      <td className="tour">{m.tournamentShort}<small>{m.court} · {m.round}</small></td>
      <td>
        <div className="score scoreflash">
          <div className="scols mono">
            {m.setScores.map((s, i) => (
              <div key={i} className={`col ${s.current ? 'cur' : ''}`}><span className="a">{s.a}</span><span className="b">{s.b}</span></div>
            ))}
          </div>
          {m.status === 'Scheduled'
            ? <><span className="schedtime mono">{m.scheduledTime}</span><span className="badge b-sched">Sched</span></>
            : <>
                <div className={`gpcol mono ${m.pair1.serving ? 'serveA' : m.pair2.serving ? 'serveB' : ''}`}>
                  <span className="a">{m.gamePoints?.a ?? '—'}</span><span className="b">{m.gamePoints?.b ?? '—'}</span>
                </div>
                <span className={`badge ${m.status === 'Live' ? 'b-live' : 'b-break'}`}>{m.status}</span>
              </>}
        </div>
      </td>
      <td className="c-odds"><OddsBar pa={m.winProbA} pb={100 - m.winProbA} oa={m.fairOddsA} ob={m.fairOddsB} /></td>
      <td className="r c-mv"><span className={`mv mono ${mv > 0 ? 'up' : mv < 0 ? 'dn' : 'flat'}`}><span className="ar">{mv > 0 ? '▲' : mv < 0 ? '▼' : '—'}</span>{mv === 0 ? ' 0' : (mv > 0 ? '+' : '') + mv}</span></td>
      <td className="c-conf"><span className={`conf ${m.confidence}`}><span className="bars"><i style={{ height: 6 }} /><i style={{ height: 9 }} /><i style={{ height: 13 }} /></span><span className="t">{m.confidence === 'full' ? 'Full' : m.confidence === 'med' ? (m.status === 'Scheduled' ? 'Pre' : 'Settling') : 'Thin'}</span></span></td>
      <td className="r upd mono c-upd">{m.status === 'Scheduled' ? '—' : `${m.lastUpdatedSeconds}s`}</td>
    </tr>
  )
}
```

- [ ] **Step 2: KpiRow**

```tsx
// apps/ops/src/app/(app)/live-odds/_components/KpiRow.tsx
import type { Kpis } from '../_lib/types'
import { Icon } from './icons'

export function KpiRow({ kpis }: { kpis: Kpis }) {
  return (
    <div className="kpis">
      <div className="kpi"><div className="l"><Icon id="odds" />Live matches<span className="trend up">▲ +5</span></div><div className="v disp">{kpis.liveMatches}</div><div className="s">across <b>6</b> tournaments · <b>+5</b> in last 15m</div></div>
      <div className="kpi"><div className="l"><Icon id="today" />Pre-match modeled</div><div className="v disp">{kpis.preMatchModeled}</div><div className="s">queued for next <b>48h</b></div></div>
      <div className="kpi orange"><div className="l"><Icon id="odds" />Biggest swing · 15m</div><div className="v disp">{kpis.biggestSwing.pct > 0 ? '+' : ''}{kpis.biggestSwing.pct}%</div><div className="s">{kpis.biggestSwing.label}</div></div>
      <div className="kpi muted"><div className="l"><Icon id="eye" />Low coverage</div><div className="v disp">{kpis.lowCoverage}</div><div className="s">live, <span className="dn">no point-by-point</span> yet</div></div>
    </div>
  )
}
```

- [ ] **Step 3: DetailPanel**

```tsx
// apps/ops/src/app/(app)/live-odds/_components/DetailPanel.tsx
import type { Match } from '../_lib/types'
import { WinProbChart } from './WinProbChart'
import { Icon } from './icons'

export function DetailPanel({ m }: { m: Match }) {
  const leadA = m.winProbA >= 50
  return (
    <div className="panel detail">
      <div className="dhead">
        <div className="lab"><span className="d" />Selected match</div>
        <div className="ttl">{m.pair1.name} vs {m.pair2.name}</div>
        <small>{m.tournament} · {m.court} · {m.round} · {m.status}</small>
      </div>
      <div className="dbody">
        <div className={`prow`}>
          <div className={`pname ${m.pair1.serving ? 'serving' : ''}`}><span className="sv" />{m.pair1.name}</div>
          <div className="pright"><span className={`big disp ${leadA ? 'lead' : 'trail'}`}>{m.winProbA}%</span><span className="fair mono">{m.fairOddsA.toFixed(2)}</span></div>
        </div>
        <div className="prow">
          <div className={`pname ${m.pair2.serving ? 'serving' : ''}`}><span className="sv" />{m.pair2.name}</div>
          <div className="pright"><span className={`big disp ${!leadA ? 'lead' : 'trail'}`}>{100 - m.winProbA}%</span><span className="fair mono">{m.fairOddsB.toFixed(2)}</span></div>
        </div>

        <div className="dh"><span className="lab">Win probability · this match</span><span className="seg2"><span>Set</span><span className="on">Match</span></span></div>
        <WinProbChart history={m.winProbHistory} />
        <div className="legend"><span><i style={{ background: 'var(--lime)' }} />{m.pair1.name}</span><span><i style={{ background: 'var(--border-strong)' }} />{m.pair2.name}</span></div>

        <div className="dh"><span className="lab">Live drivers</span></div>
        {m.drivers && (
          <>
            <div className="stat"><div className="name">1st serve win %</div></div>
            <div className="stat mono"><div className="l">{m.drivers.firstServe[0]}%</div><div className="stbar"><div className="a" style={{ width: `${m.drivers.firstServe[0]}%` }} /><div className="b" style={{ width: `${100 - m.drivers.firstServe[0]}%` }} /></div><div className="r">{m.drivers.firstServe[1]}%</div></div>
            <div className="stat"><div className="name">Break points won</div></div>
            <div className="stat mono"><div className="l">{m.drivers.breakPts[0]}</div><div className="stbar"><div className="a" style={{ width: '60%' }} /><div className="b" style={{ width: '40%' }} /></div><div className="r">{m.drivers.breakPts[1]}</div></div>
            <div className="stat"><div className="name">Total points won</div></div>
            <div className="stat mono"><div className="l">{m.drivers.totalPts[0]}</div><div className="stbar"><div className="a" style={{ width: '55%' }} /><div className="b" style={{ width: '45%' }} /></div><div className="r">{m.drivers.totalPts[1]}</div></div>
          </>
        )}
        <div className="dcta">
          <button className="dbtn primary"><Icon id="pin" />Pin to wall</button>
          <button className="dbtn"><Icon id="share" />Share</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: TableSkeleton + ConnectionBanner**

```tsx
// apps/ops/src/app/(app)/live-odds/_components/TableSkeleton.tsx
export function TableSkeleton() {
  return (
    <div className="skel">
      {Array.from({ length: 6 }).map((_, i) => (
        <div className="skrow" key={i}>
          <div className="skb" style={{ width: 160 }} />
          <div className="skb" style={{ width: 120 }} />
          <div className="skb skb-bar" style={{ width: 150 }} />
        </div>
      ))}
    </div>
  )
}
```

```tsx
// apps/ops/src/app/(app)/live-odds/_components/ConnectionBanner.tsx
import type { ConnectionState } from '../_lib/types'
import { Icon } from './icons'

const TEXT: Partial<Record<ConnectionState, [string, string]>> = {
  reconnecting: ['Reconnecting to Padelgod feed', 'last update 14s ago'],
  offline: ['Padelgod feed disconnected — odds frozen', 'frozen at 09:42:18 · auto-retry 5s'],
}
export function ConnectionBanner({ state, onRetry }: { state: ConnectionState; onRetry: () => void }) {
  const t = TEXT[state]
  if (!t) return null
  return (
    <div className="connbanner">
      <span className="cb-ic"><Icon id="retry" /></span>
      <span>{t[0]}</span>
      <span className="cb-meta">{t[1]}</span>
      {state === 'offline' && <button className="cb-retry" onClick={onRetry}>Retry now</button>}
    </div>
  )
}
```

- [ ] **Step 5: LiveMatchesTable** (header, filters, summary, banner, skeleton, table, footer)

```tsx
// apps/ops/src/app/(app)/live-odds/_components/LiveMatchesTable.tsx
import type { ConnectionState, Filters, Match } from '../_lib/types'
import { MatchRow } from './MatchRow'
import { ConnectionBanner } from './ConnectionBanner'
import { TableSkeleton } from './TableSkeleton'

export function LiveMatchesTable({ matches, selectedId, onSelect, connection, filters, setFilters, onRetry }: {
  matches: Match[]; selectedId: string | null; onSelect: (id: string) => void
  connection: ConnectionState; filters: Filters; setFilters: (f: Filters) => void; onRetry: () => void
}) {
  const liveCount = matches.filter(m => m.status === 'Live').length
  const shown = matches // real filtering applied in Task 15
  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Live Matches</h3><span className="mut">Premier Padel Italy Major · QF</span>
        <span className="livecount"><span className="d" />{liveCount} live</span>
      </div>
      <div className="filters">
        <span className="fsel on"><span className="k">Tournament</span> Italy Major <span className="caret">▾</span></span>
        <span className="fsel"><span className="k">Gender</span> All <span className="caret">▾</span></span>
        <span className="fsel"><span className="k">Tier</span> All <span className="caret">▾</span></span>
        <span className="fsel"><span className="k">Round</span> All <span className="caret">▾</span></span>
        <div className="seg">{['All', 'Live', 'Break', 'Sched'].map((s, i) => <span key={s} className={i === 0 ? 'on' : ''}>{s}</span>)}</div>
        <div className="right"><span className="chiptog"><span className="sw2" />Swinging</span><span className="clearbtn">Clear</span></div>
      </div>
      <div className="fsummary"><span className="fcount">Showing <b>{shown.length}</b> of <b>{matches.length}</b></span><span className="ftag">Premier Padel Italy Major <span className="x">✕</span></span></div>
      <ConnectionBanner state={connection} onRetry={onRetry} />
      <TableSkeleton />
      <div className="tablescroll">
        <table>
          <thead><tr>
            <th>Match</th><th>Tournament</th><th className="c">Sets · Pts</th><th>Win probability</th>
            <th className="r c-mv">15m</th><th className="c-conf">Conf.</th><th className="r c-upd">Upd</th>
          </tr></thead>
          <tbody>
            {shown.map(m => <MatchRow key={m.id} m={m} selected={m.id === selectedId} onSelect={() => onSelect(m.id)} />)}
          </tbody>
        </table>
      </div>
      <div className="tfoot">View all {matches.length} live matches →</div>
    </div>
  )
}
```

- [ ] **Step 6: Verify compile**

Run: `cd apps/ops && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add "apps/ops/src/app/(app)/live-odds/_components"
git commit -m "feat(ops): live odds table, rows, kpis, detail panel, banner, skeleton"
```

---

## Task 15: LiveOddsView orchestrator + page + page header

**Files:**
- Create: `apps/ops/src/app/(app)/live-odds/_components/LiveOddsView.tsx`
- Create: `apps/ops/src/app/(app)/live-odds/page.tsx`

- [ ] **Step 1: LiveOddsView (client orchestrator)** — wires hook → page header + KPIs + 2-col content; applies real filtering.

```tsx
// apps/ops/src/app/(app)/live-odds/_components/LiveOddsView.tsx
'use client'
import { useEffect, useMemo, useState } from 'react'
import './../live-odds.css'
import { useLiveOdds } from '../_lib/useLiveOdds'
import { KpiRow } from './KpiRow'
import { LiveMatchesTable } from './LiveMatchesTable'
import { DetailPanel } from './DetailPanel'

function useClock() {
  const [t, setT] = useState('09:42:18')
  useEffect(() => {
    let d = new Date(); d.setHours(9, 42, 18, 0)
    const id = setInterval(() => { d = new Date(d.getTime() + 1000); setT(d.toTimeString().slice(0, 8)) }, 1000)
    return () => clearInterval(id)
  }, [])
  return t
}

export function LiveOddsView() {
  const { snapshot, connection, retry, cycleConnection, autoRefresh, setAutoRefresh, selectedId, setSelectedId, filters, setFilters } = useLiveOdds()
  const clock = useClock()

  // wire rail footer demo cycle (rail lives in shell; attach by id)
  useEffect(() => {
    const el = document.getElementById('railFoot'); if (!el) return
    const h = () => cycleConnection(); el.addEventListener('click', h); return () => el.removeEventListener('click', h)
  }, [cycleConnection])

  const matches = snapshot?.matches ?? []
  const filtered = useMemo(() => matches.filter(m => {
    if (filters.gender !== 'all' && m.pair1.gender !== filters.gender) return false
    if (filters.status === 'live' && m.status !== 'Live') return false
    if (filters.status === 'break' && m.status !== 'Break') return false
    if (filters.status === 'scheduled' && m.status !== 'Scheduled') return false
    if (filters.swingingOnly && Math.abs(m.movement15m) < 5) return false
    return true
  }), [matches, filters])
  const selected = matches.find(m => m.id === selectedId) ?? matches[0]

  const modelPill = connection === 'live' ? 'Model live' : connection === 'reconnecting' ? 'Model stale' : connection === 'offline' ? 'Model frozen' : 'Connecting'

  return (
    <>
      <div className="pagehead">
        <span className="crumb">Live Odds<span className="modelpill" id="mpTx"><span className="dot" />{modelPill}</span></span>
        <span className="spacer" />
        <span className={`toggle ${autoRefresh ? 'on' : ''}`} onClick={() => setAutoRefresh(a => !a)}>Auto-refresh <span className="sw" /></span>
        <span className="clock mono">{clock}<span className="upd"> · upd 2s</span></span>
      </div>
      <div className="pagebody">
        {snapshot && <KpiRow kpis={snapshot.kpis} />}
        <div className="content2">
          <LiveMatchesTable matches={filtered} selectedId={selected?.id ?? null} onSelect={setSelectedId}
            connection={connection} filters={filters} setFilters={setFilters} onRetry={retry} />
          {selected && <DetailPanel m={selected} />}
        </div>
        <div className="foot">Model odds are <b>PadelNachos-computed</b> from live match state — no external bookmaker data. Internal tool · operators only.</div>
      </div>
    </>
  )
}
```

- [ ] **Step 2: page.tsx**

```tsx
// apps/ops/src/app/(app)/live-odds/page.tsx
import { LiveOddsView } from './_components/LiveOddsView'
export default function LiveOddsPage() { return <LiveOddsView /> }
```

- [ ] **Step 3: Verify the page renders and matches the light screenshot**

Run: `cd apps/ops && npm run dev`, open `/live-odds`.
Expected: matches `screenshots/01-live-odds-light.png` — header, KPIs, table with green odds bars, sticky detail panel; rows update live; clicking a row repoints the detail panel; toggling the theme button matches `02-live-odds-dark.png`.

- [ ] **Step 4: Commit**

```bash
git add "apps/ops/src/app/(app)/live-odds/_components/LiveOddsView.tsx" "apps/ops/src/app/(app)/live-odds/page.tsx"
git commit -m "feat(ops): live odds page + orchestrator (KPIs, table, detail, page header)"
```

---

## Task 16: Connection states + offline screenshot parity

**Files:**
- Modify: `apps/ops/src/app/(app)/live-odds/_lib/useLiveOdds.ts` (wire banner ids if needed)

- [ ] **Step 1: Verify the four states render correctly**

Run dev. With the page open:
1. On load you briefly see the **skeleton** (`loading`) then it goes **live**.
2. Click the **rail footer** ("Padelgod online…") once → `reconnecting`: orange model pill, orange banner with spinner, motion paused.
3. Click again → `offline`: red banner with **Retry now**, model pill "Model frozen", odds bars desaturated, LIVE badges + live count grayed. Compare to `screenshots/03-offline-state-dark.png` (toggle dark theme to match).
4. Click **Retry now** → back to `live`.

If the model pill text/connection banner text doesn't update, ensure `data-conn` is set on `<html>` (it is, in `useLiveOdds`) and that `live-odds.css` `[data-conn=...]` rules are present (Task 12).

- [ ] **Step 2: Commit any fixes**

```bash
git add -A
git commit -m "fix(ops): connection-state parity for live odds"
```

---

## Task 17: Responsive column shedding + reduced-motion + final polish

**Files:** (verification-focused; fixes as needed)

- [ ] **Step 1: Verify container-query column shedding**

Run dev, narrow the window / collapse the rail. As the table panel narrows, columns drop in order **Upd → Conf → 15m** (the `c-upd`/`c-conf`/`c-mv` classes + `@container tbl` rules). Under ~1200px the detail panel stacks below the table.
Expected: no horizontal page scroll; graceful degradation.

- [ ] **Step 2: Verify reduced motion**

Enable OS "Reduce motion". Reload `/live-odds`.
Expected: no pulsing/sweep/shimmer animations; the simulated feed does **not** run (numbers hold static). The page is fully usable.

- [ ] **Step 3: Run the full test + build**

Run: `cd apps/ops && npx vitest run && npm run build`
Expected: all tests pass; production build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ops): responsive column shedding + reduced-motion polish"
```

---

## Task 18: Documentation note

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a short Live Odds section to CLAUDE.md**

Add under the Ops dashboard area: a note that `apps/ops` now has a `/live-odds` console rendered against a **stub provider** (`_lib/stub-provider.ts`) and a typed contract (`_lib/types.ts`); the real win-probability model + Padelgod WebSocket feed are a **separate, not-yet-built workstream**; theme (`padel.theme`) and brand (`padel.brand`) persist in localStorage; the app shell (`components/shell/`) is the new chrome that other pages will migrate onto.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note live odds console + stub provider in CLAUDE.md"
```

---

## Out of scope (tracked separately)
- Real **win-probability model** + **Padelgod WebSocket** provider replacing the stub (the contract in `_lib/types.ts` is the integration seam).
- Real Padel Labs identity/accent.
- Migrating the other 18 admin pages onto the new shell.
- Real filter semantics beyond the basics wired in Task 15, "view all 28" pagination, deeper empty states.
- Font substitution sign-off (Bricolage Grotesque / JetBrains Mono / Inter Tight).

# Admin Design-System Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the "stadium scoreboard" design system to the **production** `apps/ops` admin — port the proven shell (global header + collapsible accordion rail + light/dark theme), retune the accent to `#6abf3a`, build a shared primitive library, and migrate all ~29 `(app)` pages onto it in light **and** dark — incrementally, without regressing the working admin.

**Architecture:** The shell exists only on the un-merged prototype branch `claude/vibrant-wilson-56f223`. **Phase 0** ports it onto `feat/admin-design-system` (off `origin/main`): scoreboard tokens + `#6abf3a` accent + a legacy→new *compat shim*, the `components/shell/*` files (Rail rewired to main's routes), and a rewritten `(app)/layout.tsx` that mounts `AppShell`, keeps the PlayerDrawer provider/host, and drops `ActivityRail`. **Phase 1** builds a token-driven primitive library (`components/ui/`). **Phase 2** migrates each page off legacy tokens/inline layout onto primitives, area-by-area, behind the shim. **Phase 3** adds a ⌘K command palette and deletes the legacy `Sidebar*`/`ActivityRail`/shim.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, vitest. Styling = CSS classes in `*.css` + inline `CSSProperties` for dynamic values + CSS variables. **No Tailwind utility classes in components.** Work dir: `apps/ops` (dev server port 3004 via `npm run dev`; `npm run build`, `npm run lint`, `npx vitest run` from `apps/ops/`).

**Branch/worktree:** `feat/admin-design-system` at `.claude/worktrees/admin-design-system` (off `origin/main`). The prototype shell source is the branch ref `claude/vibrant-wilson-56f223` (same repo — accessible via `git show <ref>:<path>`).

**Spec:** `docs/superpowers/specs/2026-05-31-admin-design-system-rollout-design.md`

**Convention reminders:**
- Every primitive reads tokens only (never hardcodes a hex) so both themes work.
- Never put a CSS `transition` on `<body>` background/color (Chromium freezes it on theme flip).
- Verify each migrated page in **both** themes (toggle in the GlobalHeader) before committing.
- No new product behavior — visual/structural migration only.

---

## File Structure

**Phase 0 — port**
- Replace: `apps/ops/src/app/globals.css` (scoreboard tokens + `#6abf3a` retune + compat shim)
- Create: `apps/ops/src/components/shell/{AppShell,GlobalHeader,Rail,ThemeProvider,BrandProvider}.tsx`, `apps/ops/src/components/shell/shell.css` (ported)
- Rewrite: `apps/ops/src/app/(app)/layout.tsx`

**Phase 1 — primitives**
- Create: `apps/ops/src/app/ui.css`, `apps/ops/src/components/ui/{PageHeader,Panel,Kpi,Pill,DataTable}.tsx`, `apps/ops/src/components/ui/index.ts`
- Modify: `apps/ops/src/app/layout.tsx` (import `ui.css`)

**Phase 2 — migration:** each `(app)` page + its `_components` (per task).

**Phase 3 — search + cleanup**
- Create: `apps/ops/src/lib/command-palette.ts` (+ test), `apps/ops/src/components/shell/CommandPalette.tsx`, possibly `apps/ops/src/app/api/ops/search/route.ts`
- Delete: `apps/ops/src/components/{Sidebar,SidebarPrimary,SidebarSecondary,SidebarUserMenu,ActivityRail}.tsx` + compat shim

---

## Token → primitive migration map (used by every Phase-2 task)

| Legacy token / pattern | Replace with |
|---|---|
| `var(--bg-canvas)` | drop (page bg comes from shell `--bg-app`) |
| `var(--bg-card)` | keep (theme-aware after Phase 0) or use `<Panel>` |
| `var(--border-subtle)` | `var(--border-card)` |
| `var(--brand-primary)` / `var(--lime)` | `var(--lime)` (now `#6abf3a`) |
| `var(--brand-primary-fg)` | `var(--text-1)` |
| `var(--status-neutral)` | `var(--text-3)` |
| `var(--status-live)` (operational) | `var(--lime)` |
| `var(--status-live)` (a match is live) | `var(--live)` |
| `var(--status-warn)` | `var(--orange)` |
| `var(--status-urgent)` | `var(--live)` |
| hardcoded `borderRadius: 12` | `var(--r-lg)` (8→`--r-sm`,10→`--r-md`,16→`--r-xl`) |
| ad-hoc `<h1>` page title + flex row | `<PageHeader title subtitle actions>` |
| inline white card box | `<Panel>` / `<Section>` |
| inline KPI grid | `<KpiStrip><Kpi/></KpiStrip>` |
| inline status chip | `<Pill tone>` |
| inline `<button>` | `<Button variant>` |
| inline `<input>/<select>` | `<Field>` + `.ui-input`/`.ui-select` |
| hand-rolled `<table>` | `<DataTable>` |

---

# PHASE 0 — Port the shell

## Task 0a: Scoreboard tokens + #6abf3a accent + compat shim

**Files:** Replace `apps/ops/src/app/globals.css`.

- [ ] **Step 1: Copy the prototype globals.css verbatim.** It already contains the fonts `@import`, `@import 'tailwindcss'`, the legacy `:root` block, and the scoreboard dark-default + `[data-theme="light"]` blocks.

Run:
```bash
cd apps/ops && git show claude/vibrant-wilson-56f223:apps/ops/src/app/globals.css > src/app/globals.css
```

- [ ] **Step 2: Retune the dark `--lime` ramp** to `#6abf3a` (rgb 106,191,58). In the dark `:root` block, replace the `--lime` … `--track-ink` lines with:

```css
  /* lime — hero accent (#6abf3a-derived) */
  --lime:#6ABF3A;
  --lime-2:#82D24F;
  --lime-deep:#4F9E28;
  --lime-ink:#08160A;
  --lime-text:#8FD867;
  --lime-bg:rgba(106,191,58,.13);
  --lime-bg-2:rgba(106,191,58,.20);
  --lime-border:rgba(106,191,58,.36);
  --lime-glow:0 0 0 1px rgba(106,191,58,.40),0 6px 22px rgba(106,191,58,.20);
  --track:#2C2C2C;
  --track-ink:#9A9384;
```

- [ ] **Step 3: Retune the light `--lime` ramp** (deeper green for contrast on parchment, rgb 90,167,47). In `:root[data-theme="light"]`, replace `--lime` … `--track-ink` with:

```css
  --lime:#5AA72F;
  --lime-2:#6FBF3A;
  --lime-deep:#3F7D1F;
  --lime-ink:#0A1605;
  --lime-text:#3D7A14;
  --lime-bg:rgba(90,167,47,.13);
  --lime-bg-2:rgba(90,167,47,.20);
  --lime-border:rgba(90,167,47,.38);
  --lime-glow:0 0 0 1px rgba(90,167,47,.30),0 6px 20px rgba(90,167,47,.18);
  --track:#DDE2D2;
  --track-ink:#6E7563;
```

- [ ] **Step 4: Turn the legacy `:root` block into a compat shim.** Replace the legacy block (the first `:root{…}` with `--brand-primary`/`--bg-canvas`/`--status-*`) with aliases to the new tokens (forward `var()` references resolve at use-time). Keep the fonts/tailwind `@import`s untouched above it. Do **not** redefine `--bg-card`/`--lime` (the scoreboard blocks own those):

```css
/* Legacy → new compat shim. Keeps un-migrated pages theming in light AND dark
   during the page-by-page migration. DELETE in Task 17. */
:root {
  --brand-primary: var(--lime);
  --brand-primary-fg: var(--text-1);
  --bg-canvas: var(--bg-app);
  --bg-attention: var(--bg-sunken);
  --fg-on-attention: var(--text-1);
  --status-live: var(--lime);
  --status-warn: var(--orange);
  --status-urgent: var(--live);
  --status-neutral: var(--text-3);
  --border-subtle: var(--border-card);
  --font-body: var(--font);
}
```

- [ ] **Step 5: Build.** Run: `cd apps/ops && npm run build` — Expected: PASS (no Lightning CSS `@import`/parse errors; fonts `@import` must precede `@import 'tailwindcss'`).

- [ ] **Step 6: Commit.**

```bash
git add apps/ops/src/app/globals.css
git commit -m "feat(ops): port scoreboard tokens + #6abf3a accent + legacy compat shim"
```

## Task 0b: Port shell components + rewire Rail to main's routes

**Files:** Create `apps/ops/src/components/shell/{AppShell,GlobalHeader,Rail,ThemeProvider,BrandProvider}.tsx` + `shell.css`.

- [ ] **Step 1: Copy the six shell files from the prototype branch.**

```bash
cd apps/ops && mkdir -p src/components/shell
for f in AppShell.tsx GlobalHeader.tsx Rail.tsx ThemeProvider.tsx BrandProvider.tsx shell.css; do
  git show claude/vibrant-wilson-56f223:apps/ops/src/components/shell/$f > src/components/shell/$f
done
```

- [ ] **Step 2: Read the copied files** (`AppShell.tsx`, `GlobalHeader.tsx`, `Rail.tsx`) to learn the exact `Group`/nav-item shape, the icon ids the sprite supports (look for an icon sprite/`icons` reference inside `AppShell`/`GlobalHeader`), and the active-route detection. **If `AppShell`/`GlobalHeader` reference an icon-sprite or icons module that wasn't copied, also copy it** (e.g. `git show claude/vibrant-wilson-56f223:apps/ops/src/app/(app)/live-odds/_components/icons.tsx` or wherever it lives) and fix the import path.

- [ ] **Step 3: Rewire `Rail.tsx`'s `GROUPS`** to main's real routes/IA. Use icon ids that exist in the sprite (pick the closest; reuse a generic one if needed). Active detection must highlight a parent for nested routes (e.g. `/odds/calibration` highlights `/odds`, `/system/seo/opportunities` highlights `/system/seo`) — use `pathname === href || pathname.startsWith(href + '/')`.

```tsx
const GROUPS: Group[] = [
  { items: [
    { href: '/today', label: 'Today', icon: 'today' },
    { href: '/odds', label: 'Live Odds', icon: 'odds', pill: 'live' },
  ] },
  { label: 'Tournament Ops', items: [
    { href: '/tournament-explorer', label: 'Tournament Explorer', icon: 'grid' },
    { href: '/entry-lists', label: 'Entry Lists', icon: 'list' },
    { href: '/needs-review', label: 'Needs Review', icon: 'flag' },
    { href: '/simulator', label: 'Simulator', icon: 'play' },
  ] },
  { label: 'Catalogs', items: [
    { href: '/players', label: 'Players', icon: 'user' },
    { href: '/brands', label: 'Brands', icon: 'tag' },
    { href: '/streams', label: 'Streams', icon: 'video' },
    { href: '/yt-channels', label: 'YouTube Channels', icon: 'video' },
    { href: '/partners', label: 'Partners', icon: 'star' },
  ] },
  { label: 'Content', items: [
    { href: '/news', label: 'News', icon: 'news' },
    { href: '/news-sources', label: 'News Sources', icon: 'list' },
    { href: '/highlights', label: 'Highlights', icon: 'play' },
  ] },
  { label: 'System', items: [
    { href: '/system/integration-health', label: 'Integration Health', icon: 'pulse' },
    { href: '/system/data-quality', label: 'Data Quality', icon: 'check' },
    { href: '/system/padelgod-health', label: 'Padelgod Health', icon: 'server' },
    { href: '/system/shadow-mode', label: 'Shadow Mode', icon: 'eye' },
    { href: '/system/coverage-matrix', label: 'Coverage Matrix', icon: 'grid' },
    { href: '/system/feature-flags', label: 'Feature Flags', icon: 'flag' },
    { href: '/system/ocr-health', label: 'OCR Health', icon: 'scan' },
    { href: '/system/seo', label: 'SEO', icon: 'search' },
    { href: '/system/architecture', label: 'Architecture', icon: 'diagram' },
  ] },
]
```

(If the `Group`/`NavItem` type names differ in the copied file, match them — keep the copied types, just swap the data. If the copied Rail hardcoded a `cnt`/`pill` only for `/live-odds`, keep the `pill:'live'` on `/odds`; drop any stale `/live-odds`, `/tournament-explorer` count that no longer applies.)

- [ ] **Step 4: Preserve sign-out in `GlobalHeader`.** Main's old chrome put the signed-in email + sign-out in `SidebarUserMenu.tsx`. Read it and ensure the GlobalHeader's avatar/menu exposes **sign-out** (reuse the same `signOut` call/route `SidebarUserMenu` uses). If the ported header has only a static avatar, add a small dropdown (email + Sign out). Do not lose the sign-out affordance.

- [ ] **Step 5: Typecheck the shell in isolation.** Run: `cd apps/ops && npx tsc --noEmit` — Expected: no errors in `components/shell/*` (imports resolve, icon ids valid). Fix any unresolved imports/types from the port.

- [ ] **Step 6: Commit.**

```bash
git add apps/ops/src/components/shell
git commit -m "feat(ops): port shell (AppShell/GlobalHeader/Rail/Theme/Brand) + rewire rail to main routes"
```

## Task 0c: Mount AppShell in the (app) layout (keep PlayerDrawer, drop ActivityRail)

**Files:** Rewrite `apps/ops/src/app/(app)/layout.tsx`.

- [ ] **Step 1: Rewrite the layout** to mount `AppShell`, keep the PlayerDrawer provider/host, drop `ActivityRail` and the old `Sidebar`.

```tsx
// apps/ops/src/app/(app)/layout.tsx
// Auth + operator gate. Mounts the new AppShell chrome (global header +
// collapsible accordion rail + light/dark theme) and keeps the PlayerDrawer
// provider/host so any surface can open the drawer via useOpenPlayerDrawer().

import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/shell/AppShell'
import { PlayerDrawerProvider } from '@/components/player-drawer-context'
import { PlayerDrawerHost } from '@/components/PlayerDrawerHost'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (!session.user.isOperator) redirect('/not-authorized')

  return (
    <PlayerDrawerProvider>
      <AppShell userEmail={session.user.email ?? null}>{children}</AppShell>
      <PlayerDrawerHost />
    </PlayerDrawerProvider>
  )
}
```

- [ ] **Step 2: Adapt `AppShell` to accept `userEmail`.** If the ported `AppShell` signature is `AppShell({ children })`, add an optional `userEmail?: string | null` prop and thread it to `GlobalHeader` (for the user menu from Task 0b Step 4). If `AppShell` manages rail collapse + theme/brand providers already, leave that intact.

- [ ] **Step 3: Build.** Run: `cd apps/ops && npm run build` — Expected: PASS.

- [ ] **Step 4: Smoke every route inside the new chrome.** `npm run dev` → log in → visit `/today`, `/odds`, `/players`, `/news-sources`, `/partners`, `/system/integration-health`, `/system/seo`. Expected: each renders inside the global header + accordion rail; rail collapse works and persists; theme toggle flips light↔dark; sign-out works; page bodies still legacy-styled but **readable in both themes** (via the shim). PlayerDrawer still opens from `/players`.

- [ ] **Step 5: Commit.**

```bash
git add apps/ops/src/app/(app)/layout.tsx apps/ops/src/components/shell/AppShell.tsx
git commit -m "feat(ops): mount AppShell in (app) layout; keep PlayerDrawer, drop ActivityRail"
```

---

# PHASE 1 — Shared primitive library

## Task 1: ui.css scaffold + PageHeader

**Files:** Create `apps/ops/src/app/ui.css`, `apps/ops/src/components/ui/PageHeader.tsx`; modify `apps/ops/src/app/layout.tsx`.

- [ ] **Step 1: Create `apps/ops/src/app/ui.css` with PageHeader classes.**

```css
/* apps/ops/src/app/ui.css — shared admin primitives. Token-driven (both themes). */

/* ---- PageHeader ---- */
.ui-page { padding: 28px 32px; max-width: 1320px; }
.ui-ph { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin:0 0 22px; }
.ui-ph-title { font-family: var(--display); font-size:22px; font-weight:700; color:var(--text-1); margin:0; line-height:1.1; letter-spacing:-.01em; }
.ui-ph-sub { font-size:13px; color:var(--text-3); margin:5px 0 0; }
.ui-ph-actions { display:flex; align-items:center; gap:10px; flex-shrink:0; }
```

- [ ] **Step 2: Import `ui.css` from the root layout.** In `apps/ops/src/app/layout.tsx`, add after the `globals.css` import:

```tsx
import './globals.css'
import './ui.css'
```

- [ ] **Step 3: Create `apps/ops/src/components/ui/PageHeader.tsx`.**

```tsx
import type { ReactNode } from 'react'

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="ui-ph">
      <div>
        <h1 className="ui-ph-title">{title}</h1>
        {subtitle != null && <p className="ui-ph-sub">{subtitle}</p>}
      </div>
      {actions != null && <div className="ui-ph-actions">{actions}</div>}
    </div>
  )
}
```

- [ ] **Step 4: Build.** Run: `cd apps/ops && npm run build` — Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/ops/src/app/ui.css apps/ops/src/app/layout.tsx apps/ops/src/components/ui/PageHeader.tsx
git commit -m "feat(ops): add ui.css + PageHeader primitive"
```

## Task 2: Panel / Section

**Files:** Create `apps/ops/src/components/ui/Panel.tsx`; modify `ui.css`.

- [ ] **Step 1: Append to `ui.css`.**

```css
/* ---- Panel / Section ---- */
.ui-panel { background:var(--bg-card); border:1px solid var(--border-card); border-radius:var(--r-lg); box-shadow:var(--shadow-sm); }
.ui-panel-pad { padding:18px 20px; }
.ui-panel-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 18px; border-bottom:1px solid var(--border-inner); }
.ui-panel-title { font-size:13px; font-weight:600; color:var(--text-1); margin:0; }
.ui-section { margin:0 0 22px; }
.ui-section-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin:0 0 10px; }
.ui-section-label { font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--text-3); margin:0; }
```

- [ ] **Step 2: Create `apps/ops/src/components/ui/Panel.tsx`.**

```tsx
import type { ReactNode } from 'react'

export function Panel({
  title,
  actions,
  padded = true,
  children,
}: {
  title?: ReactNode
  actions?: ReactNode
  padded?: boolean
  children: ReactNode
}) {
  return (
    <div className="ui-panel">
      {(title != null || actions != null) && (
        <div className="ui-panel-head">
          {title != null ? <h3 className="ui-panel-title">{title}</h3> : <span />}
          {actions != null && <div className="ui-ph-actions">{actions}</div>}
        </div>
      )}
      <div className={padded ? 'ui-panel-pad' : undefined}>{children}</div>
    </div>
  )
}

export function Section({
  label,
  actions,
  children,
}: {
  label: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="ui-section">
      <div className="ui-section-head">
        <h2 className="ui-section-label">{label}</h2>
        {actions != null && <div className="ui-ph-actions">{actions}</div>}
      </div>
      {children}
    </section>
  )
}
```

- [ ] **Step 3: Build.** Run: `cd apps/ops && npm run build` — Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add apps/ops/src/app/ui.css apps/ops/src/components/ui/Panel.tsx
git commit -m "feat(ops): add Panel + Section primitives"
```

## Task 3: KpiStrip / Kpi

**Files:** Create `apps/ops/src/components/ui/Kpi.tsx`; modify `ui.css`.

- [ ] **Step 1: Append to `ui.css`.**

```css
/* ---- KPI ---- */
.ui-kpis { display:grid; grid-template-columns:repeat(var(--ui-kpi-cols,4),1fr); gap:14px; margin:0 0 22px; }
.ui-kpi { background:var(--bg-card); border:1px solid var(--border-card); border-radius:var(--r-lg); padding:16px 18px 14px; box-shadow:var(--shadow-sm); }
.ui-kpi-label { display:flex; align-items:center; gap:8px; font-size:11px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; color:var(--text-3); }
.ui-kpi-dot { width:8px; height:8px; border-radius:var(--r-full); flex-shrink:0; }
.ui-kpi-value { font-family:var(--display); font-variant-numeric:tabular-nums; font-size:30px; font-weight:700; color:var(--text-1); margin-top:8px; line-height:1; }
@media (max-width:900px){ .ui-kpis{ grid-template-columns:repeat(2,1fr);} }
```

- [ ] **Step 2: Create `apps/ops/src/components/ui/Kpi.tsx`.**

```tsx
import type { CSSProperties, ReactNode } from 'react'

type Tone = 'lime' | 'live' | 'warn' | 'urgent' | 'neutral'

const TONE_VAR: Record<Tone, string> = {
  lime: 'var(--lime)',
  live: 'var(--live)',
  warn: 'var(--orange)',
  urgent: 'var(--live)',
  neutral: 'var(--text-3)',
}

export function KpiStrip({ cols = 4, children }: { cols?: number; children: ReactNode }) {
  return (
    <div className="ui-kpis" style={{ '--ui-kpi-cols': cols } as CSSProperties}>
      {children}
    </div>
  )
}

export function Kpi({
  label,
  value,
  tone = 'neutral',
  pulse = false,
}: {
  label: string
  value: ReactNode
  tone?: Tone
  pulse?: boolean
}) {
  return (
    <div className="ui-kpi">
      <div className="ui-kpi-label">
        <span className={pulse ? 'ui-kpi-dot live-pulse' : 'ui-kpi-dot'} style={{ background: TONE_VAR[tone] }} />
        {label}
      </div>
      <div className="ui-kpi-value">{value}</div>
    </div>
  )
}
```

(The `live-pulse` keyframe ships in `globals.css` from the port.)

- [ ] **Step 3: Build.** Run: `cd apps/ops && npm run build` — Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add apps/ops/src/app/ui.css apps/ops/src/components/ui/Kpi.tsx
git commit -m "feat(ops): add KpiStrip + Kpi primitives"
```

## Task 4: Pill / Button

**Files:** Create `apps/ops/src/components/ui/Pill.tsx`; modify `ui.css`.

- [ ] **Step 1: Append to `ui.css`.**

```css
/* ---- Pill ---- */
.ui-pill { display:inline-flex; align-items:center; gap:6px; padding:3px 9px; border-radius:var(--r-full); font-size:11px; font-weight:600; line-height:1.5; border:1px solid transparent; }
.ui-pill[data-tone="lime"]    { color:var(--lime-text);   background:var(--lime-bg);   border-color:var(--lime-border); }
.ui-pill[data-tone="live"]    { color:var(--live-text);   background:var(--live-bg);   border-color:var(--live-border); }
.ui-pill[data-tone="warn"],
.ui-pill[data-tone="urgent"]  { color:var(--orange-text); background:var(--orange-bg); border-color:var(--orange-border); }
.ui-pill[data-tone="men"]     { color:var(--men);   background:var(--men-bg);   border-color:var(--men-border); }
.ui-pill[data-tone="women"]   { color:var(--women); background:var(--women-bg); border-color:var(--women-border); }
.ui-pill[data-tone="neutral"] { color:var(--text-2); background:var(--bg-hover); border-color:var(--border); }
.ui-pill-dot { width:7px; height:7px; border-radius:var(--r-full); background:currentColor; }

/* ---- Button ---- */
.ui-btn { display:inline-flex; align-items:center; justify-content:center; gap:7px; font-family:var(--font); font-size:13px; font-weight:600; padding:8px 14px; border-radius:var(--r-sm); border:1px solid var(--border-strong); background:var(--bg-card); color:var(--text-1); cursor:pointer; transition:background var(--t-fast), border-color var(--t-fast); }
.ui-btn:hover { background:var(--bg-hover); }
.ui-btn[data-size="sm"] { font-size:12px; padding:5px 10px; }
.ui-btn[data-variant="primary"] { background:var(--lime); border-color:var(--lime); color:var(--lime-ink); }
.ui-btn[data-variant="primary"]:hover { background:var(--lime-2); border-color:var(--lime-2); }
.ui-btn[data-variant="ghost"] { background:transparent; border-color:transparent; color:var(--text-2); }
.ui-btn[data-variant="ghost"]:hover { background:var(--bg-hover); color:var(--text-1); }
.ui-btn[data-variant="danger"] { background:var(--live-bg); border-color:var(--live-border); color:var(--live-text); }
.ui-btn:disabled { opacity:.5; cursor:not-allowed; }
```

- [ ] **Step 2: Create `apps/ops/src/components/ui/Pill.tsx` (exports `Pill` + `Button`).**

```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Tone = 'lime' | 'live' | 'warn' | 'urgent' | 'men' | 'women' | 'neutral'

export function Pill({
  tone = 'neutral',
  dot = false,
  pulse = false,
  children,
}: {
  tone?: Tone
  dot?: boolean
  pulse?: boolean
  children: ReactNode
}) {
  return (
    <span className="ui-pill" data-tone={tone}>
      {dot && <span className={pulse ? 'ui-pill-dot live-pulse' : 'ui-pill-dot'} />}
      {children}
    </span>
  )
}

export function Button({
  variant = 'default',
  size = 'md',
  children,
  ...rest
}: {
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  children: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className="ui-btn"
      data-variant={variant === 'default' ? undefined : variant}
      data-size={size === 'md' ? undefined : size}
      {...rest}
    >
      {children}
    </button>
  )
}
```

- [ ] **Step 3: Build.** Run: `cd apps/ops && npm run build` — Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add apps/ops/src/app/ui.css apps/ops/src/components/ui/Pill.tsx
git commit -m "feat(ops): add Pill + Button primitives"
```

## Task 5: Field / DataTable / EmptyState / Skeleton

**Files:** Create `apps/ops/src/components/ui/DataTable.tsx`; modify `ui.css`.

- [ ] **Step 1: Append to `ui.css`.**

```css
/* ---- Field ---- */
.ui-field { display:flex; flex-direction:column; gap:5px; }
.ui-field-label { font-size:11px; font-weight:600; letter-spacing:.03em; text-transform:uppercase; color:var(--text-3); }
.ui-input, .ui-select { font-family:var(--font); font-size:13px; color:var(--text-1); background:var(--bg-input); border:1px solid var(--border); border-radius:var(--r-sm); padding:8px 10px; outline:none; transition:border-color var(--t-fast); }
.ui-input:focus, .ui-select:focus { border-color:var(--lime-border); }
.ui-input::placeholder { color:var(--text-4); }

/* ---- DataTable ---- */
.ui-table-wrap { background:var(--bg-card); border:1px solid var(--border-card); border-radius:var(--r-lg); overflow:hidden; box-shadow:var(--shadow-sm); }
.ui-table { width:100%; border-collapse:collapse; font-size:13px; }
.ui-table thead th { position:sticky; top:0; background:var(--bg-card-2); color:var(--text-3); font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; text-align:left; padding:10px 14px; border-bottom:1px solid var(--border-inner); }
.ui-table tbody td { padding:11px 14px; color:var(--text-1); border-bottom:1px solid var(--border-inner); }
.ui-table tbody tr:last-child td { border-bottom:none; }
.ui-table tbody tr:hover td { background:var(--bg-hover); }

/* ---- EmptyState / Skeleton ---- */
.ui-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; padding:48px 24px; text-align:center; color:var(--text-3); }
.ui-empty-title { font-size:14px; font-weight:600; color:var(--text-2); }
.ui-empty-hint { font-size:12px; color:var(--text-4); }
.ui-skel { background:linear-gradient(90deg,var(--bg-hover),var(--bg-card-2),var(--bg-hover)); background-size:200% 100%; border-radius:var(--r-sm); height:14px; animation:ui-shimmer 1.3s ease-in-out infinite; }
@keyframes ui-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
@media (prefers-reduced-motion: reduce){ .ui-skel{ animation:none } }
```

- [ ] **Step 2: Create `apps/ops/src/components/ui/DataTable.tsx`.**

```tsx
import type { ReactNode } from 'react'

export function DataTable({ children }: { children: ReactNode }) {
  return (
    <div className="ui-table-wrap">
      <table className="ui-table">{children}</table>
    </div>
  )
}

export function Field({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <label className="ui-field">
      {label != null && <span className="ui-field-label">{label}</span>}
      {children}
    </label>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="ui-empty">
      <div className="ui-empty-title">{title}</div>
      {hint != null && <div className="ui-empty-hint">{hint}</div>}
    </div>
  )
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="ui-skel" style={{ width: `${100 - i * 8}%` }} />
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Build.** Run: `cd apps/ops && npm run build` — Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add apps/ops/src/app/ui.css apps/ops/src/components/ui/DataTable.tsx
git commit -m "feat(ops): add Field, DataTable, EmptyState, Skeleton primitives"
```

## Task 6: Primitives barrel

**Files:** Create `apps/ops/src/components/ui/index.ts`.

- [ ] **Step 1: Create the barrel.**

```ts
export { PageHeader } from './PageHeader'
export { Panel, Section } from './Panel'
export { KpiStrip, Kpi } from './Kpi'
export { Pill, Button } from './Pill'
export { DataTable, Field, EmptyState, Skeleton } from './DataTable'
```

- [ ] **Step 2: Build + lint.** Run: `cd apps/ops && npm run build && npm run lint` — Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add apps/ops/src/components/ui/index.ts
git commit -m "feat(ops): add ui primitives barrel export"
```

---

# PHASE 2 — Page migration

**Recipe (every page):** (a) read the page + its `_components`; (b) apply the **Token → primitive migration map**; (c) wrap the body in `<div className="ui-page">` and replace the ad-hoc header with `<PageHeader>`; (d) swap inline cards→`<Panel>`/`<Section>`, KPIs→`<KpiStrip>/<Kpi>`, chips→`<Pill>`, buttons→`<Button>`, inputs→`<Field>`+`.ui-input`, tables→`<DataTable>`, empties→`<EmptyState>`, loading→`<Skeleton>`; (e) keep all data-fetching/behavior identical; (f) `npm run build && npm run lint`; (g) verify **both** themes on the dev server; (h) commit per the task message.

## Task 7: `/today` (reference migration)

**Files:** `apps/ops/src/app/(app)/today/page.tsx` + any `today/_components` or top-level `Today*` components it imports.

- [ ] **Step 1: Read `today/page.tsx` and its imported components** to see the current structure (KPIs, live-now, requires-attention, schedule, status pill, refresh button).
- [ ] **Step 2: Migrate the page shell** → `<div className="ui-page">` + `<PageHeader title="Today" subtitle={…welcome} actions={…refresh + status pill} />`.
- [ ] **Step 3: Migrate KPIs** → `<KpiStrip cols={4}>` with `<Kpi label value tone pulse>` (live=red+pulse, needs-review=warn, urgent=urgent, streams=lime).
- [ ] **Step 4: Migrate the status pill** to `<Pill tone dot>` and the refresh button to `<Button>`.
- [ ] **Step 5: Migrate live-now / requires-attention / schedule** containers to `<Panel>`/`<Section>` + the token map.
- [ ] **Step 6: Build + lint; verify both themes** (`/today` light + dark; live KPI dot pulses red; no white/black surfaces).
- [ ] **Step 7: Commit:** `refactor(ops): migrate /today onto ui primitives + tokens`.

## Task 8: Catalogs — `/players` + PlayerDrawer restyle

**Files:** `players/page.tsx` + `players/_components/*` + the PlayerDrawer system (`player-drawer-context.tsx`, `PlayerDrawerHost.tsx`, `players/_components/PlayerDrawer*` / wherever the drawer UI lives).

- [ ] **Step 1:** Migrate `players/page.tsx` shell → `ui-page` + `<PageHeader title="Players" actions={…search/filter}>`.
- [ ] **Step 2:** Players table → `<DataTable>`; filters → `<Field>`/`.ui-input`/`.ui-select`; filter chips → `<Pill>`; bulk-action buttons → `<Button>`.
- [ ] **Step 3:** Restyle the PlayerDrawer UI: keep `PlayerDrawerProvider`/`PlayerDrawerHost`/`useOpenPlayerDrawer()` wiring **unchanged**; swap legacy tokens via the map; drawer panel `--bg-surface`, `--border-card`; form rows → `<Field>`; save → `<Button variant="primary">`, delete → `<Button variant="danger">`. Scrim `rgba(0,0,0,.5)` (theme-neutral).
- [ ] **Step 4:** Build + lint; verify both themes incl. opening the drawer in dark + light.
- [ ] **Step 5:** Commit: `refactor(ops): migrate /players + PlayerDrawer onto ui primitives`.

## Task 9: Catalogs — `/players/[id]`, `/brands`, `/streams`, `/yt-channels`, `/partners`

**Files:** each page dir + `_components` (note `players/[id]/_components/*`: `ProfileHeader`, `IdentitySection`, `EarningsSection`, `MatchHistorySection`, `CoachesSection`, `ProfileSection`).

- [ ] **Step 1:** `/players/[id]` → `<PageHeader>` (player name + meta via `ProfileHeader`), each `*Section` → `<Panel title>`/`<Section>`, history/earnings tables → `<DataTable>`.
- [ ] **Step 2:** `/brands` → `<DataTable>` + add/edit forms via `<Field>`/`<Button>`.
- [ ] **Step 3:** `/streams` → `<DataTable>` + status `<Pill tone="lime|live">`.
- [ ] **Step 4:** `/yt-channels` → `<DataTable>` + quality-score cells.
- [ ] **Step 5:** `/partners` → `<PageHeader>` + `<Panel>`/`<DataTable>` per its `PartnersClient`.
- [ ] **Step 6:** Build + lint; verify both themes; commit: `refactor(ops): migrate remaining Catalogs pages onto ui primitives`.

## Task 10: Content — `/news`, `/news-sources`, `/highlights`

**Files:** `news/`, `news-sources/` (`NewsSourcesTabs`, `SourcesTable`, `ArticlesTable`, `SuggestionsTable`, `AddSourceDrawer`, `EditSourceDrawer`, `DiscoverWithAIModal`, `DiscoveryHealth`, `SourceFilters`, `ClusterChip`, `TranslationChips`), `highlights/` (`HighlightPickerTab`).

- [ ] **Step 1:** `/news` → `<PageHeader>`, article rows → `<DataTable>`/`<Panel>`, source pills → `<Pill>`.
- [ ] **Step 2:** `/news-sources` → tabs header → `<PageHeader>`; `SourcesTable`/`ArticlesTable`/`SuggestionsTable` → `<DataTable>`; `SourceFilters` → `<Field>`; `ClusterChip`/`TranslationChips` → `<Pill>`; `Add/EditSourceDrawer` + `DiscoverWithAIModal` → token map + `<Field>`/`<Button>`; `DiscoveryHealth` → `<KpiStrip>`/`<Panel>`.
- [ ] **Step 3:** `/highlights` → `<PageHeader>`, video grid cards → `<Panel padded={false}>`, quality chip → `<Pill>`.
- [ ] **Step 4:** Build + lint; verify both themes; commit: `refactor(ops): migrate Content pages onto ui primitives`.

## Task 11: Tournament Ops — `/tournament-explorer`, `/entry-lists`, `/needs-review`, `/simulator`

**Files:** the four page dirs + `_components` (incl. `needs-review/_components/{NeedsReviewShell,DuplicatePlayersTab,TournamentDedupTab}`).

- [ ] **Step 1:** `/tournament-explorer` → `<PageHeader>`, tournament cards/table, live-state pills → `<Pill tone>`.
- [ ] **Step 2:** `/entry-lists` → `<DataTable>` + upload `<Button>`/`<Field>`.
- [ ] **Step 3:** `/needs-review` (`NeedsReviewShell`) → `<PageHeader>`, the dedup tabs → `<DataTable>` + action `<Button>`s; keep any count polling.
- [ ] **Step 4:** `/simulator` → `<PageHeader>`, controls → `<Field>`/`<Button>`, output → `<Panel>`.
- [ ] **Step 5:** Build + lint; verify both themes; commit: `refactor(ops): migrate Tournament Ops pages onto ui primitives`.

## Task 12: Model & Odds — `/odds` (+ `calibration`, `methodology`, `tournament/[id]`, `match/[id]`)

**Files:** `odds/page.tsx` + `odds/{calibration,methodology,tournament/[id],match/[id]}/page.tsx` + odds components (`LiveOddsTable`, `OddsMovementChart`, `PairOddsRow`, `CalibrationKpiStrip`, `CalibrationBreakdownTable`, `ModelFreshnessPanel`, `MethodologyMarkdown`, `LiveNowSection`).

- [ ] **Step 1:** `/odds` → `<PageHeader title="Live Odds">`; keep `LiveNowSection` (real-time) intact — only restyle its container to `<Section>`/`<Panel>` + token map; `LiveOddsTable`/`PairOddsRow` → `<DataTable>`; `ModelFreshnessPanel` → `<Panel>`.
- [ ] **Step 2:** `/odds/calibration` → `CalibrationKpiStrip` → `<KpiStrip>/<Kpi>`; `CalibrationBreakdownTable` → `<DataTable>`.
- [ ] **Step 3:** `/odds/methodology` → `<PageHeader>` + `<Panel>` wrapping `MethodologyMarkdown`.
- [ ] **Step 4:** `/odds/tournament/[id]` + `/odds/match/[id]` → `<PageHeader>` + token map; `OddsMovementChart` colors should read from tokens (use `--lime`/`--track`).
- [ ] **Step 5:** Build + lint; verify both themes; **confirm real-time odds still flow** on `/odds`. Commit: `refactor(ops): migrate Model & Odds pages onto ui primitives`.

## Task 13: System — 9 pages

**Files:** `system/{integration-health,data-quality,padelgod-health,shadow-mode,coverage-matrix,feature-flags,ocr-health,seo,architecture}/` (+ `seo/opportunities/`) + `_components`.

- [ ] **Step 1:** `integration-health` → `<PageHeader>`, health cards → `<Panel>` + status `<Pill>`, metrics → `<KpiStrip>`.
- [ ] **Step 2:** `data-quality` → `<DataTable>` + `<EmptyState>`.
- [ ] **Step 3:** `padelgod-health` → `<Panel>`/`<Pill>` worker status.
- [ ] **Step 4:** `shadow-mode` → cards → `<Panel>` (migrate any `ShadowMatchCard`).
- [ ] **Step 5:** `coverage-matrix` → `<DataTable>` matrix.
- [ ] **Step 6:** `feature-flags` → `<DataTable>` + toggle `<Button>`.
- [ ] **Step 7:** `ocr-health` → `<KpiStrip>`/`<Panel>`/`<DataTable>` per its content.
- [ ] **Step 8:** `seo` + `seo/opportunities` → `<PageHeader>` + `<DataTable>`/`<Panel>`.
- [ ] **Step 9:** `architecture` → `<PageHeader>` + `<Panel padded={false}>` around the SVG (SVG unchanged; ensure its colors read on dark — wrap on `--bg-card`).
- [ ] **Step 10:** Build + lint; verify both themes; commit: `refactor(ops): migrate System pages onto ui primitives`.

## Task 14: Auth pages

**Files:** `login/`, `forgot-password/`, `reset-password/`, `not-authorized/` (outside `(app)`, no shell).

- [ ] **Step 1:** `login` form → centered `<Panel>` + `<Field>`/`.ui-input` + `<Button variant="primary">`; page bg `var(--bg-app)`.
- [ ] **Step 2:** Same for `forgot-password` + `reset-password`.
- [ ] **Step 3:** `not-authorized` → centered `<Panel>` + `<EmptyState>`-style copy.
- [ ] **Step 4:** Build + lint; verify login in both themes; commit: `refactor(ops): migrate auth pages onto ui primitives`.

---

# PHASE 3 — Search + cleanup

## Task 15: Command-palette data + filter (TDD)

**Files:** Create `apps/ops/src/lib/command-palette.ts`, `apps/ops/src/lib/__tests__/command-palette.test.ts`.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from 'vitest'
import { PAGE_COMMANDS, filterPages } from '../command-palette'

describe('command-palette pages', () => {
  it('indexes the main (app) pages', () => {
    expect(PAGE_COMMANDS.length).toBeGreaterThanOrEqual(20)
    expect(PAGE_COMMANDS.map((c) => c.href)).toContain('/news-sources')
    expect(PAGE_COMMANDS.map((c) => c.href)).toContain('/partners')
  })
  it('matches by label, case-insensitive', () => {
    expect(filterPages('player').map((c) => c.href)).toContain('/players')
  })
  it('matches by group', () => {
    expect(filterPages('system').length).toBeGreaterThanOrEqual(9)
  })
  it('returns all pages for empty query', () => {
    expect(filterPages('').length).toBe(PAGE_COMMANDS.length)
  })
  it('returns nothing for gibberish', () => {
    expect(filterPages('zzzznope')).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails.** Run: `cd apps/ops && npx vitest run src/lib/__tests__/command-palette.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `command-palette.ts`.** The page list must match `Rail.tsx`'s `GROUPS` (hrefs/labels/groups).

```ts
export interface PageCommand {
  href: string
  label: string
  group: string
}

export const PAGE_COMMANDS: PageCommand[] = [
  { href: '/today', label: 'Today', group: 'Dashboard' },
  { href: '/odds', label: 'Live Odds', group: 'Dashboard' },
  { href: '/odds/calibration', label: 'Odds · Calibration', group: 'Dashboard' },
  { href: '/odds/methodology', label: 'Odds · Methodology', group: 'Dashboard' },
  { href: '/tournament-explorer', label: 'Tournament Explorer', group: 'Tournament Ops' },
  { href: '/entry-lists', label: 'Entry Lists', group: 'Tournament Ops' },
  { href: '/needs-review', label: 'Needs Review', group: 'Tournament Ops' },
  { href: '/simulator', label: 'Simulator', group: 'Tournament Ops' },
  { href: '/players', label: 'Players', group: 'Catalogs' },
  { href: '/brands', label: 'Brands', group: 'Catalogs' },
  { href: '/streams', label: 'Streams', group: 'Catalogs' },
  { href: '/yt-channels', label: 'YouTube Channels', group: 'Catalogs' },
  { href: '/partners', label: 'Partners', group: 'Catalogs' },
  { href: '/news', label: 'News', group: 'Content' },
  { href: '/news-sources', label: 'News Sources', group: 'Content' },
  { href: '/highlights', label: 'Highlights', group: 'Content' },
  { href: '/system/integration-health', label: 'Integration Health', group: 'System' },
  { href: '/system/data-quality', label: 'Data Quality', group: 'System' },
  { href: '/system/padelgod-health', label: 'Padelgod Health', group: 'System' },
  { href: '/system/shadow-mode', label: 'Shadow Mode', group: 'System' },
  { href: '/system/coverage-matrix', label: 'Coverage Matrix', group: 'System' },
  { href: '/system/feature-flags', label: 'Feature Flags', group: 'System' },
  { href: '/system/ocr-health', label: 'OCR Health', group: 'System' },
  { href: '/system/seo', label: 'SEO', group: 'System' },
  { href: '/system/architecture', label: 'Architecture', group: 'System' },
]

export function filterPages(query: string): PageCommand[] {
  const q = query.trim().toLowerCase()
  if (q === '') return PAGE_COMMANDS
  return PAGE_COMMANDS.filter(
    (c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q),
  )
}

export interface EntityHit {
  kind: 'player' | 'tournament' | 'match'
  id: string
  label: string
  sub?: string
  href: string
}

/** Debounced entity search. Best-effort: returns [] on empty query or any error. */
export async function searchEntities(query: string, signal?: AbortSignal): Promise<EntityHit[]> {
  const q = query.trim()
  if (q.length < 2) return []
  try {
    const res = await fetch(`/api/ops/search?q=${encodeURIComponent(q)}`, { signal })
    if (!res.ok) return []
    const data = (await res.json()) as { hits?: EntityHit[] }
    return data.hits ?? []
  } catch {
    return []
  }
}
```

- [ ] **Step 4: Run tests to verify pass.** Run: `cd apps/ops && npx vitest run src/lib/__tests__/command-palette.test.ts` — Expected: PASS (5 tests).

- [ ] **Step 5: Confirm/implement the search endpoint.** Check whether `apps/ops/src/app/api/ops/search/route.ts` exists. If not, **read an existing `apps/ops/src/app/api/ops/*` route first** for the auth + Supabase-client pattern, then create a `GET` that reads `q`, queries `players` (by `normalized_name`/name), `tournaments` (by name), `matches` (by player names), caps 5 each, and returns `{ hits: EntityHit[] }` with `href` = `/players/{id}` / `/odds/tournament/{id}` / `/odds/match/{id}`. Do not invent a new auth scheme — reuse the existing one.

- [ ] **Step 6: Commit.**

```bash
git add apps/ops/src/lib/command-palette.ts apps/ops/src/lib/__tests__/command-palette.test.ts apps/ops/src/app/api/ops/search
git commit -m "feat(ops): command-palette page index + entity search"
```

## Task 16: Command-palette UI + wire to GlobalHeader

**Files:** Create `apps/ops/src/components/shell/CommandPalette.tsx`; modify `GlobalHeader.tsx`, `ui.css`.

- [ ] **Step 1: Append palette classes to `ui.css`.**

```css
/* ---- Command palette ---- */
.ui-cmd-scrim { position:fixed; inset:0; background:rgba(0,0,0,.45); display:flex; align-items:flex-start; justify-content:center; padding-top:12vh; z-index:80; }
.ui-cmd { width:min(620px,92vw); background:var(--bg-surface); border:1px solid var(--border-strong); border-radius:var(--r-xl); box-shadow:var(--shadow-lg); overflow:hidden; }
.ui-cmd-input { width:100%; font-family:var(--font); font-size:15px; color:var(--text-1); background:transparent; border:none; border-bottom:1px solid var(--border-inner); padding:15px 18px; outline:none; }
.ui-cmd-list { max-height:48vh; overflow:auto; padding:6px; }
.ui-cmd-group { font-size:10px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--text-4); padding:10px 12px 4px; }
.ui-cmd-item { display:flex; align-items:center; gap:10px; padding:9px 12px; border-radius:var(--r-sm); cursor:pointer; color:var(--text-1); font-size:13px; }
.ui-cmd-item[data-active="true"], .ui-cmd-item:hover { background:var(--bg-hover); }
.ui-cmd-item-sub { color:var(--text-3); font-size:12px; margin-left:auto; }
```

- [ ] **Step 2: Create `CommandPalette.tsx`** (`'use client'`).

```tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { filterPages, searchEntities, type EntityHit, type PageCommand } from '@/lib/command-palette'

export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [entities, setEntities] = useState<EntityHit[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) {
      setQ('')
      setActive(0)
      setEntities([])
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      searchEntities(q, ctrl.signal).then(setEntities)
    }, 180)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [q, open])

  const pages = useMemo<PageCommand[]>(() => filterPages(q), [q])
  const flat = useMemo(
    () => [
      ...pages.map((p) => ({ href: p.href, label: p.label, sub: p.group })),
      ...entities.map((e) => ({ href: e.href, label: e.label, sub: e.sub ?? e.kind })),
    ],
    [pages, entities],
  )

  if (!open) return null

  function go(href: string) {
    setOpen(false)
    router.push(href)
  }

  return (
    <div className="ui-cmd-scrim" onClick={() => setOpen(false)}>
      <div className="ui-cmd" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="ui-cmd-input"
          placeholder="Jump to a page or search players, tournaments, matches…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setActive(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
            else if (e.key === 'Enter' && flat[active]) { go(flat[active].href) }
          }}
        />
        <div className="ui-cmd-list">
          {pages.length > 0 && <div className="ui-cmd-group">Pages</div>}
          {pages.map((p, i) => (
            <div key={p.href} className="ui-cmd-item" data-active={active === i} onMouseEnter={() => setActive(i)} onClick={() => go(p.href)}>
              <span>{p.label}</span>
              <span className="ui-cmd-item-sub">{p.group}</span>
            </div>
          ))}
          {entities.length > 0 && <div className="ui-cmd-group">Results</div>}
          {entities.map((e, i) => {
            const idx = pages.length + i
            return (
              <div key={`${e.kind}-${e.id}`} className="ui-cmd-item" data-active={active === idx} onMouseEnter={() => setActive(idx)} onClick={() => go(e.href)}>
                <span>{e.label}</span>
                <span className="ui-cmd-item-sub">{e.sub ?? e.kind}</span>
              </div>
            )
          })}
          {flat.length === 0 && <div className="ui-cmd-group">No matches</div>}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Mount in `GlobalHeader.tsx`.** Render `<CommandPalette />` once in the header tree (⌘K works immediately). Make the existing header search box open it: simplest reliable approach — render the search box as a `readOnly` input/button whose `onClick`/`onFocus` dispatches `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))`, or lift `open` state if the ported header already owns the input. Read the ported `GlobalHeader` first and pick whichever matches its structure.

- [ ] **Step 4: Build + lint + test.** Run: `cd apps/ops && npm run build && npm run lint && npx vitest run` — Expected: PASS.

- [ ] **Step 5: Manual check.** Dev server → ⌘K → "play" → Enter → `/players`; type a real player name → entity result → Enter navigates. Both themes.

- [ ] **Step 6: Commit.**

```bash
git add apps/ops/src/components/shell/CommandPalette.tsx apps/ops/src/components/shell/GlobalHeader.tsx apps/ops/src/app/ui.css
git commit -m "feat(ops): ⌘K command palette (pages + entities) in global header"
```

## Task 17: Cleanup — delete legacy chrome, shim; audit

**Files:** Modify `globals.css` (remove shim); delete `Sidebar.tsx`, `SidebarPrimary.tsx`, `SidebarSecondary.tsx`, `SidebarUserMenu.tsx`, `ActivityRail.tsx`.

- [ ] **Step 1: Confirm nothing still imports the legacy chrome.**

Run:
```bash
cd apps/ops && grep -rl -e "components/Sidebar" -e "SidebarPrimary" -e "SidebarSecondary" -e "SidebarUserMenu" -e "ActivityRail" src
```
Expected: **no output** (the layout no longer imports them after Task 0c). If anything prints, resolve it first.

- [ ] **Step 2: Audit remaining legacy-token usage.**

Run:
```bash
cd apps/ops && grep -rl -e "--status-neutral" -e "--bg-canvas" -e "--border-subtle" -e "--brand-primary" -e "--status-live" -e "--status-warn" -e "--status-urgent" -e "--bg-attention" -e "--fg-on-attention" -e "--font-body" src/app src/components | grep -vE "Sidebar|ActivityRail|globals.css"
```
Expected: **no output.** Migrate any straggler (token map) before continuing.

- [ ] **Step 3: Delete the dead legacy chrome.**

```bash
git rm apps/ops/src/components/Sidebar.tsx apps/ops/src/components/SidebarPrimary.tsx apps/ops/src/components/SidebarSecondary.tsx apps/ops/src/components/SidebarUserMenu.tsx apps/ops/src/components/ActivityRail.tsx
```

- [ ] **Step 4: Remove the compat shim** from `globals.css` (the `:root { --brand-primary: var(--lime); … }` block added in Task 0a Step 4).

- [ ] **Step 5: Build + lint + test.** Run: `cd apps/ops && npm run build && npm run lint && npx vitest run` — Expected: PASS.

- [ ] **Step 6: Re-run the legacy-token audit to confirm zero.**

Run: `cd apps/ops && grep -rln -e "--brand-primary" -e "--bg-canvas" -e "--status-neutral" -e "--border-subtle" src | wc -l`
Expected: `0`.

- [ ] **Step 7: Commit.**

```bash
git add -A apps/ops/src/app/globals.css apps/ops/src/components
git commit -m "chore(ops): remove legacy Sidebar/ActivityRail + compat shim"
```

## Task 18: Final verification + docs

**Files:** `CLAUDE.md`.

- [ ] **Step 1: Full build + lint + test.** Run: `cd apps/ops && npm run build && npm run lint && npx vitest run` — Expected: all PASS.

- [ ] **Step 2: Walk every route in both themes.** For each `(app)` route (+ 4 auth pages), toggle light↔dark: no legacy white/black surfaces, accent is `#6abf3a` green, panels/tables/pills/buttons consistent, rail collapse + ⌘K palette work, PlayerDrawer opens, sign-out works. Fix stragglers with the token map.

- [ ] **Step 3: Confirm `/odds` real-time parity.** Live odds still flow on `/odds` (LiveNowSection) with the retuned green in both themes — no regression from the port.

- [ ] **Step 4: Update CLAUDE.md.** Under the Live Odds console section, note: `apps/ops` now runs the shared **AppShell** chrome on **all** `(app)` routes (global header + collapsible accordion rail + light/dark), a shared **`components/ui/`** primitive library (`PageHeader`, `Panel`/`Section`, `KpiStrip`/`Kpi`, `Pill`/`Button`, `DataTable`/`Field`/`EmptyState`/`Skeleton`), accent `--lime` = `#6abf3a`, legacy `Sidebar*`/`ActivityRail` removed, and a ⌘K command palette in the header. PlayerDrawer retained.

- [ ] **Step 5: Commit.**

```bash
git add CLAUDE.md
git commit -m "docs: note AppShell rollout + ui primitives + #6abf3a accent across apps/ops"
```

---

## Self-Review notes (author)

- **Spec coverage:** Phase 0 ports shell/tokens (0a–0c, incl. keep-PlayerDrawer / drop-ActivityRail / preserve sign-out); primitives (T1–T6); incremental migration of all ~29 `(app)` pages + auth (T7–T14); PlayerDrawer restyle (T8); global search pages+entities (T15–T16); cleanup/audit (T17); dual-theme acceptance + `/odds` parity (T18). ✅
- **Base correctness:** built on `feat/admin-design-system` off `origin/main`; page list verified against `git ls-tree origin/main` (news-sources, partners, odds sub-pages, system/seo + ocr-health included). ✅
- **Type consistency:** `PageCommand`/`PAGE_COMMANDS`/`filterPages`/`searchEntities`/`EntityHit` defined in T15, consumed unchanged in T16; `Pill` `tone` + `Button` `variant` unions defined in T4, referenced consistently in T7–T14.
- **Known judgment calls:** (a) the ported shell's exact prop/type shapes are read at port time (0b/0c) and adapted — full source lives at ref `claude/vibrant-wilson-56f223`, not invented here; (b) T15 assumes `/api/ops/search`, with a create-if-absent step that reuses the existing `/api/ops/*` auth pattern.
- **Scope guards:** no standalone `/live-odds` console page (restyle existing `/odds`); main-app `src/app/ops` out of scope; no ActivityRail.

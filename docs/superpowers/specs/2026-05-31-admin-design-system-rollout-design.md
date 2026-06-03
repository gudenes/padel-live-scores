# Admin Design-System Rollout — Design

**Date:** 2026-05-31
**Status:** Approved (brainstorm) → ready for plan
**App:** `apps/ops` (admin.padelnachos.com)
**Base branch:** `feat/admin-design-system` off `origin/main`
**Related:** [Live Odds admin design](2026-05-30-live-odds-admin-design.md), [Realtime live odds](2026-05-31-realtime-live-odds-design.md)

## Problem

The "stadium scoreboard" look (global header + always-dark collapsible accordion rail + light/dark
theme + panel/table/token system) was prototyped for the Live Odds console **on a feature branch
that was never merged to `main`.** Production `main`'s `apps/ops` admin still runs the **old chrome**:
a two-tier `Sidebar` (`SidebarPrimary` icon rail + `SidebarSecondary` page list) + a right-side
`ActivityRail`, light-only, on **legacy tokens** (`--brand-primary #7ed321`, `--lime #84cc16`,
`--bg-canvas`, `--status-*`, `--border-subtle`). There is **no `ThemeProvider`, no dark mode, no
shared primitive library** — every page hand-rolls its layout with inline `CSSProperties` + legacy
tokens.

Goal: bring the scoreboard design system to the **real** production admin — port the proven shell,
retune the accent, build a shared primitive library, and migrate all `(app)` pages onto it in light
**and** dark — incrementally, without regressing the working admin.

## Decisions (locked in brainstorm)

| Decision | Choice | Notes |
|---|---|---|
| **Base** | Fresh branch off `origin/main` | Avoids a risky 123-commit merge of the prototype branch; targets production's real page set. |
| **Nav model** | **Single collapsible accordion rail** (Option B / the mockup) | Port `Rail.tsx` (236↔70px, grouped accordions, page counts, persisted collapse). Replaces the two-tier `Sidebar`. |
| **Theme** | **Light + dark** | Port `ThemeProvider` (`data-theme`, `padel.theme`); every primitive is token-driven so both themes work. |
| **Rollout** | **Incremental** | Phase 0 ports the shell; then primitives; then migrate pages area-by-area behind a legacy→new token *compat shim* so un-migrated pages keep theming. |
| **Canonical accent** | **Scoreboard green `#6abf3a`** | Retune the `--lime` ramp. Becomes the admin-wide accent. |
| **Side panels** | **Keep PlayerDrawer, drop ActivityRail** | Keep main's `PlayerDrawerProvider`/`PlayerDrawerHost`/`useOpenPlayerDrawer()` (restyled); remove the always-on `ActivityRail`. |
| **Global search** | **Pages + entities** (⌘K command palette) | Jump to any page AND search players/tournaments/matches. |

## Current state on `origin/main` (verified)

- **Shell (to PORT, absent on main):** the prototype branch `claude/vibrant-wilson-56f223` has
  `apps/ops/src/components/shell/` → `AppShell`, `GlobalHeader`, `Rail`, `ThemeProvider`,
  `BrandProvider`, `shell.css`. These get copied in and adapted to main's routes.
- **`(app)/layout.tsx` on main** wraps every route in `<PlayerDrawerProvider>` → flex(`Sidebar` +
  `main` + `ActivityRail`) + `<PlayerDrawerHost>`. Background `var(--bg-canvas)`. This file is
  rewritten to mount `AppShell` (keeping the PlayerDrawer provider/host, dropping `ActivityRail`).
- **Tokens on main:** `globals.css` has **only** the legacy `:root` block (no scoreboard tokens, no
  `data-theme`). Phase 0 replaces it with the scoreboard token file (dark default + light override)
  and a legacy compat shim.
- **Pages (real, ~29 `(app)` routes):**
  - **Dashboard:** `/today`, `/odds` (+ `/odds/calibration`, `/odds/methodology`, `/odds/tournament/[id]`, `/odds/match/[id]`)
  - **Tournament Ops:** `/tournament-explorer`, `/entry-lists`, `/needs-review`, `/simulator`
  - **Catalogs:** `/players` (+ `/players/[id]`), `/brands`, `/streams`, `/yt-channels`, `/partners`
  - **Content:** `/news`, `/news-sources`, `/highlights`
  - **System:** `/system/{integration-health,data-quality,padelgod-health,shadow-mode,coverage-matrix,feature-flags,architecture,ocr-health,seo}` (+ `/system/seo/opportunities`)
- **Legacy shell components on main:** `Sidebar.tsx`, `SidebarPrimary.tsx`, `SidebarSecondary.tsx`, `SidebarUserMenu.tsx`, `ActivityRail.tsx` — removed at the end of the rollout.
- **PlayerDrawer system on main:** `player-drawer-context.tsx`, `PlayerDrawerHost.tsx`, `PlayerDrawer*` — kept, restyled.
- **Styling convention:** CSS classes (`*.css`) + inline `CSSProperties` for dynamic values + CSS variables. **No Tailwind utility classes in components.** Primitives follow the same convention.

## Approach

### Phase 0 — Port the shell (foundation)
1. Drop in the scoreboard token file (`globals.css`): scoreboard dark-default + `[data-theme="light"]` override, accent retuned to `#6abf3a`, plus a legacy→new **compat shim** so the 29 un-migrated pages theme correctly during migration.
2. Copy `components/shell/*` from the prototype branch; **rewire `Rail.tsx`'s `GROUPS`** to main's real routes/IA; keep `BrandProvider` (Nachos/Labs).
3. Rewrite `(app)/layout.tsx`: mount `AppShell`, keep `PlayerDrawerProvider`/`PlayerDrawerHost`, **drop `ActivityRail`**. Every route now renders inside the new chrome (bodies still legacy-styled, but theming via the shim).

### Phase 1 — Shared primitive library
`apps/ops/src/components/ui/` + `ui.css`: `PageHeader`, `Panel`/`Section`, `KpiStrip`/`Kpi`,
`Pill`/`Button`, `DataTable`/`Field`/`EmptyState`/`Skeleton`. Token-driven; both themes free.

### Phase 2 — Page migration (incremental, area-by-area)
Each page: legacy tokens → primitives + new tokens; ad-hoc header → `<PageHeader>`; verify **both**
themes; behavior identical. Order: `/today` first (proof), then Catalogs (+ PlayerDrawer restyle),
Content, Tournament Ops, Model & Odds, System, auth pages.

### Phase 3 — Global search + cleanup
⌘K command palette (pages index + entity search); then delete legacy `Sidebar*`/`ActivityRail` +
compat shim; grep audit must hit 0 legacy-token references.

## Out of scope
- New product features — visual/structural migration only.
- The standalone `/live-odds` console page from the prototype branch (main serves odds via `/odds` +
  its `LiveNowSection`; we restyle `/odds`, we don't introduce a competing console).
- The main-app `src/app/ops` dashboard (separate surface).
- Re-introducing `ActivityRail`.

## Risks & mitigations
- **Shell port mismatch with main routes** → Phase 0 rewires `Rail` `GROUPS` to main's real routes and verifies every route loads inside `AppShell` before any migration.
- **Compat shim masking a missed migration** → grep audit (count legacy-token files) gates shim deletion (must be 0).
- **Dark-mode regressions on data-dense pages** → explicit light+dark check per page PR.
- **PlayerDrawer regressions** → keep the provider/host wiring intact; restyle only.

## Acceptance
- All `(app)` routes render correctly in light **and** dark inside the new `AppShell`, using only new tokens + `ui/` primitives.
- Old `Sidebar*`/`ActivityRail` + compat shim removed; legacy-token grep returns 0 in `apps/ops/src`.
- Accent is `#6abf3a`-derived (`--lime`) everywhere.
- PlayerDrawer works (open from `/players`, restyled) in both themes.
- ⌘K palette jumps to pages and finds players/tournaments/matches.
- `npm run build` + `npm run lint` clean in `apps/ops`; no behavioral regressions.

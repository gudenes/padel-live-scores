# Sidebar 2-Column + Activity Feed — Design

**Date:** 2026-05-24
**Status:** design approved, awaiting implementation plan

## Summary

Re-layout the existing `apps/ops` sidebar from a single tall column with section headers into a **two-column drilldown** (Sentry / Discord / VS Code pattern): a narrow primary column with icon+label entries, and a wider secondary column showing the active area's pages. Add a **stub activity feed rail** on the right side of the admin app so operators see a live-looking event stream without leaving any page.

Light theme + lime accent. **No IA changes** — same 5 sections, same 14 pages, just presented differently.

## Goals

- Stronger relationship between section headers and their items (today the headers look like just-another-row)
- Familiar pattern operators recognize from Sentry / Discord / VS Code / Linear
- Activity rail gives the dashboard an "ops console" feel — a real-time pulse of what's happening
- Active page state and hover state are visually satisfying (ripple, spring transitions, lime glow)

## Non-goals (v1)

- No IA reorganization. Same 5 areas, same pages-per-area assignments
- No new pages. No content/page-body changes
- No real activity feed backend (stub data only — real `/api/internal/activity-feed` endpoint is a follow-up PR)
- No top status bar (no system-health KPIs, jurisdiction selector, etc. — sportsbook mockup territory)
- No theme switch. Stays light. Lime is the accent.
- No keyboard shortcuts visible (defer)
- No dot indicators (per existing feedback)

## Current state

`apps/ops/src/components/Sidebar.tsx` renders a single column with 5 section headers (HOME, TOURNAMENT OPS, CATALOGS, CONTENT, SYSTEM). Section labels are 9px gray uppercase and sit at the same indent as the items below them, which makes them feel like dividers rather than headers.

Active page: blue 2px left border + faint blue tinted background.

Needs Review badge: amber pill on the right of the Needs Review row in the secondary list.

## Design

### Visual tokens (already exist in globals.css)

| | |
|---|---|
| `--brand-primary-fg` | `#0a0a0a` |
| `--bg-canvas` | `#fafafa` |
| `--bg-card` | `#ffffff` |
| `--status-neutral` | `#71717a` |
| `--border-subtle` | `#e5e7eb` |
| NEW `--lime` | `#84cc16` |
| NEW `--lime-bright` | `#a3e635` |
| NEW `--lime-deep` | `#65a30d` |
| NEW `--lime-glow` | `rgba(163, 230, 53, 0.45)` |
| NEW `--lime-tint` | `rgba(132, 204, 22, 0.12)` |

### Layout

```
┌──────┬────────────────┬────────────────────────────────┬──────────────┐
│ PRIM │ SECONDARY      │ CONTENT (page body unchanged)  │ ACTIVITY     │
│ 78px │ 248px          │                                 │ 280px        │
│      │                │                                 │              │
│ Hm   │ Today          │                                 │ Activity     │
│ TO   │                │   <page renders here unchanged> │ ─── feed ─── │
│ Cat  │ Tournament Ex. │                                 │              │
│ Cnt  │ Entry Lists    │                                 │ ● Match      │
│ Sys  │ Needs Review 3 │                                 │ ● Worker ok  │
│      │ Simulator      │                                 │ ● Dups       │
│      │                │                                 │              │
│      │                │                                 │              │
│      │  signed in as  │                                 │              │
└──────┴────────────────┴────────────────────────────────┴──────────────┘
```

Total horizontal sidebar footprint: 78 + 248 = **326px** (vs ~232px today). The Activity rail adds 280px on the right side — can be hidden on narrower viewports OR collapsed by the operator.

### Primary column — 5 areas

Same as today, just rendered as icon + label vertical stacks:

| Icon (Lucide) | Label | Pages |
|---|---|---|
| `calendar-clock` | Home | Today |
| `trophy` | Tournament Ops | Tournament Explorer, Entry Lists, Needs Review, Simulator |
| `layers` | Catalogs | Players, Brands & Equipment, Streams, YT Channels |
| `file-text` | Content | News, Highlights |
| `settings` | System | Integration Health, Data Quality, Padelgod Health, Shadow Mode, Coverage Matrix, Feature Flags, Architecture |

The Needs Review badge is shown **on the Tournament Ops icon** (so operators see it even when in a different area) AND on the Needs Review row in the secondary column.

### Secondary column

Shows the active area's pages. Items render simply:
- Label (left)
- Optional badge (right) — only Needs Review has one today

No metric / no last-tick / no keyboard hint in v1 (defer to a "denser ops mode" follow-up).

Active state: lime-tint background pill + `lime-deep` text + bold + a 2.5px lime-gradient left edge that springs in. **No dots.**

Hover state: subtle gray tint + a chevron `›` slides in from the right (small affordance that the row is clickable).

### URL → active area mapping

The active primary area is derived from the current `pathname`:

```ts
const areaFor = (path: string): AreaId => {
  if (path === '/today') return 'home'
  if (
    path.startsWith('/tournament-explorer') ||
    path.startsWith('/entry-lists') ||
    path.startsWith('/needs-review') ||
    path.startsWith('/simulator')
  ) return 'tournament-ops'
  if (
    path.startsWith('/players') ||
    path.startsWith('/brands') ||
    path.startsWith('/streams') ||
    path.startsWith('/yt-channels')
  ) return 'catalogs'
  if (path.startsWith('/news') || path.startsWith('/highlights')) return 'content'
  if (path.startsWith('/system') || path.startsWith('/architecture')) return 'system'
  return 'home'
}
```

Clicking a primary icon navigates to the **first page** of that area (e.g. Tournament Ops → Tournament Explorer).

### Interactions (satisfying button feel)

All hover/active/click transitions use `cubic-bezier(0.16, 1, 0.3, 1)` (smooth out) or `cubic-bezier(0.34, 1.56, 0.64, 1)` (light spring) at 200ms.

- **Primary icon hover** → background gets `bg-hover` tint, icon scales to 1.06×
- **Primary icon active** → background gets `lime-tint`, icon container glows with 1px lime ring + inner highlight; left edge bar springs in from scaleY(0) to scaleY(1); label goes bold
- **Primary icon click** → ripple effect (lime, 580ms fade-out from click point) + brief scale-down to 0.93
- **Secondary row hover** → soft lime-tint background, chevron `›` slides in
- **Secondary row active** → lime pill background + 1px lime-edge highlight + small inset shadow + bold lime-deep text + lime gradient left bar springs in
- **Secondary row click** → ripple (lime, ~580ms) + brief scale-down to 0.985
- **Brand mark hover** → tilts -3° + scales 1.08× with spring curve + bigger lime glow

All animations respect `prefers-reduced-motion`.

### Activity rail (right side)

A 280px-wide column on the right of the app shell. Renders sample activity events as a vertical feed.

Header: "Activity" + a small live-pulse dot + (optional) collapse arrow.

Each event has:
- Type-color dot (left): `live` (green pulse), `warn` (amber), `info` (blue), `risk` (red)
- Text (middle): one-line summary with `<strong>` for the noun
- Attribution (below): `source · age` (e.g. `padelapi · 14s ago`)

For v1: ~8 stub events hardcoded in the component matching real padel event types:

```ts
const STUB_EVENTS = [
  { type: 'live', text: 'Match started: Galán/Chingotto vs Yanguas/Garrido · P2 Vienna', source: 'padelapi', age: '14s ago' },
  { type: 'info', text: 'Set finished: Bea González took set 1 (6-3)', source: 'relay', age: '32s ago' },
  { type: 'warn', text: 'OOP changes detected on FIP Silver Dubai — 3 court swaps', source: 'padelgod', age: '2m ago' },
  { type: 'info', text: 'Rankings updated · race-men week 21', source: 'padelgod', age: '4m ago' },
  { type: 'live', text: 'Operator Sofia merged 2 player duplicates (Brea variants)', source: 'manual', age: '7m ago' },
  { type: 'warn', text: 'New tournament duplicate cluster: FIP Promises Teheran', source: 'auto', age: '11m ago' },
  { type: 'info', text: 'Push fanout: 3,420 subscribers for Premier P2 final', source: 'cron', age: '14m ago' },
  { type: 'live', text: 'Worker ok: tournament-discovery → 4 new events', source: 'padelgod', age: '18m ago' },
]
```

Collapsing: a small `»` button in the rail header collapses it to a 0-width state (smooth 340ms ease). When collapsed, a small `«` button reappears at the right edge of the app shell to re-open.

State is **persisted in localStorage** as `ops_activity_collapsed: 'true' | 'false'` so the operator's preference survives page navigation.

### Responsive

Below 1280px viewport, the activity rail collapses by default. Below 1024px, the secondary column also collapses (operator clicks a primary icon to drill in). Below 768px, the primary column becomes icon-only (no labels) — but we don't optimize for mobile beyond "doesn't break".

## Files to modify / create

| File | Action | Notes |
|---|---|---|
| `apps/ops/src/components/Sidebar.tsx` | rewrite | Replaces the 1-column sidebar with the 2-column structure |
| `apps/ops/src/components/SidebarPrimary.tsx` | NEW | Icon column |
| `apps/ops/src/components/SidebarSecondary.tsx` | NEW | Pages column |
| `apps/ops/src/components/ActivityRail.tsx` | NEW | Right-side feed with stub data |
| `apps/ops/src/app/(app)/layout.tsx` | modify | Mount the new sidebar + activity rail |
| `apps/ops/src/lib/sidebar-areas.ts` | NEW | Area registry: id, label, icon, pages, `areaFor(pathname)` helper |
| `apps/ops/src/app/globals.css` | append | Add `--lime`, `--lime-bright`, `--lime-deep`, `--lime-glow`, `--lime-tint` tokens |
| `apps/ops/README.md` | append | Document the new sidebar IA |

## Out of scope (for follow-ups)

- Real activity feed backend — `/api/internal/activity-feed` endpoint that polls multiple tables (matches, padelgod-runs, audit-log) → ranked event stream
- Keyboard shortcuts (⌘1-⌘7) for area jumps
- Top status bar (live matches count, coverage %, etc.)
- Dense ops mode (per-row metrics + ticks + shortcut hints, like the sportsbook mockup)
- Mobile-first polish

## Open questions

1. **Should the activity rail show on every page?** My instinct: yes (operators want global context). Easy to gate per-page later if needed.
2. **Should the brand mark live above the sidebar or in the top-left corner of the app shell?** My instinct: inside the primary column at top — keeps the sidebar self-contained.
3. **Animate the secondary column's page-list re-population when switching areas?** My instinct: fade-out / fade-in over 120ms each. Subtle, not necessary, but adds polish.
4. **Where does `signed in as` footer go?** My instinct: bottom of the secondary column (preserves current behavior).

## Mockups

Live previews on the dev server:

- `/mockup-sidebar-two-column.html` — light + lime + no dots (closest to what we'll ship — minus the activity rail addition)
- `/mockup-sidebar-sportsbook.html` — dark sportsbook iteration (reference for the activity rail interaction + density only — NOT for theme)

## Rollout plan

Standard worktree → spec → plan → subagent-driven execution → PR. Aim for 6–7 bite-sized tasks. Plan title: **Plan 6 — Sidebar 2-column + Activity Rail**.

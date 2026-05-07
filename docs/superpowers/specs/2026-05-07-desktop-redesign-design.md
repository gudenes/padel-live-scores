# PadelNachos Desktop Redesign — Design Spec

**Date:** 2026-05-07
**Status:** Draft, ready for implementation planning
**Implementation note:** This spec covers a multi-wave project (~10–12 weeks). Each wave gets its own implementation plan; do not attempt to plan all four waves in a single document. Start with the Wave 1 plan once this spec is approved.
**Reference mockups:**
- [public/mockup-desktop-full.html](../../../public/mockup-desktop-full.html) — original 3-column reference
- `.superpowers/brainstorm/36788-1778134513/content/two-column.html` — 2-col with 96px header + real logo (the agreed visual direction)
- `.superpowers/brainstorm/36788-1778134513/content/architecture.html` — page-level branching pattern
- `.superpowers/brainstorm/36788-1778134513/content/design-overview.html` — wave plan + page inventory

## Background

Today, viewports ≥1100px render the mobile UI inside an iPhone-style "phone-frame" chrome on an ambient brand canvas (commit `9167980`, 2026-04-26). It's the "Spotify Web before they had a desktop" answer — better than a 412px column floating in black, but doesn't use the viewport.

This spec replaces phone-frame with a real desktop experience across every route in the app.

## Goals

1. Every route in `src/app/[locale]/(app)/*` plus the top-level `match/[id]` and `player/[id]` gets a desktop layout that uses the full viewport at ≥1100px.
2. Mobile UX is unchanged — mobile is the source of truth; desktop branches off where the page diverges.
3. One URL serves both viewports — no shadow routes (`/desktop/*`).
4. Phone-frame chrome retired entirely on desktop after Wave 4 ships.
5. Foundation built in Wave 1 so each subsequent wave is "add a desktop page", not "design a new pattern".

## Non-Goals

1. No new product features. Desktop is a layout project; the rail surfaces existing data.
2. No tablet hybrid. Single hard breakpoint at 1100px. Below = mobile, above = desktop.
3. No shadow routes. Same URL serves both viewports.
4. No retroactive mobile redesign. Touching a component for desktop work doesn't trigger a mobile redesign.
5. No CMS / customizable layouts.

## Visual design language

- **Header.** 96px tall, sticky, blurred dark background (`rgba(0,0,0,0.7)` + 22px backdrop blur), `border-bottom` faint. Holds the real PadelNachos wordmark (`/padelnachos-logo-v2.png`, 56px tall), primary nav (Home / Matches / Ranking / Tournaments / Feed), search box (280px, opens command palette — see Decisions §1), Sign in button (chunky polygon clip-path, brand green).
- **Layout.** 2 columns. Max-width 1280px, centered. Main column flexes; rail is 360px fixed. 36px gutter, 32px page padding-top, 80px page padding-bottom.
- **Rail.** Per-page contextual content. Always-on `LiveTickerRail` block at the top of every desktop page; below it, page-specific blocks (e.g., `WatchTonightRail` + `RankingsRail` + `NewsRail` on Home; `DateJumperRail` on Matches; `MoversRail` on Ranking).
- **Color & component vocabulary.** Reuses the existing CSS custom-property palette (`--p1`, `--green`, `--break`, `--accent`, `--women`, etc. from `src/app/globals.css`). No new design tokens.
- **Typography.** Existing font stack. Slight uplift in scale for desktop: page titles 28–36px (vs mobile 22–28px), body 13–15px (vs mobile 11–13px). Mobile values unchanged.

## Architecture

### Branching point: page level

Each route's `page.tsx` becomes a thin orchestrator:

```tsx
'use client'
export default function HomePage() {
  const isDesktop = useIsDesktop()
  return isDesktop ? <HomeDesktop /> : <HomeMobile />
}
```

The current page implementation is renamed to `<Route>Mobile.tsx` (untouched). A new `<Route>Desktop.tsx` sibling owns the wide layout and the page-specific rail content. Data fetching, types, and small atoms (flag SVGs, score helpers, `MatchCard`, `Spinner`, `BrandedLoader`) are shared.

### `useIsDesktop()` hook

- Returns `true` for viewport ≥1100px.
- SSR-safe: returns `false` on first server render, then re-evaluates after `useEffect` mount.
- To narrow the hydration-mismatch flicker window, root layout `(app)/layout.tsx` reads a `device-class` cookie (set on first request via UA sniff, same pattern as the existing `geo-timezone` cookie). The cookie informs initial render; client JS confirms on mount.
- Listens to `resize` (debounced 100ms) so dragging the window across the threshold gives a clean swap.

### `DesktopShell` composition

`src/components/desktop/DesktopShell.tsx` renders the topbar plus a 2-column grid with two named slots: `children` (main) and `rail` (side). Each route's `<*Desktop>` component composes:

```tsx
<DesktopShell rail={<><LiveTickerRail /><WatchTonightRail /><RankingsRail /><NewsRail /></>}>
  {/* main column content */}
</DesktopShell>
```

The shell has no knowledge of which page is rendering; it just lays things out.

### Layout-level cleanup

`src/app/[locale]/(app)/layout.tsx` changes:
- When `isDesktop`, suppress `<BottomNav>` rendering.
- When `isDesktop`, suppress the `.app-frame` phone-bezel chrome.
- The existing `.app-canvas / .app-frame / .app-screen` divs from commit `9167980` are gradually retired across waves and fully deleted at end of Wave 4.

### Folder layout

```
src/components/desktop/
  DesktopShell.tsx
  Topbar.tsx
  rail/
    LiveTickerRail.tsx        ← always-on, every desktop page
    WatchTonightRail.tsx
    RankingsRail.tsx
    NewsRail.tsx
    DateJumperRail.tsx        ← Matches page
    SourceWeightsRail.tsx     ← Feed page
    CalendarRail.tsx          ← Tournaments page
    MoversRail.tsx            ← Ranking page
    RelatedMatchesRail.tsx    ← Match detail
    PlayerStatsRail.tsx       ← Player detail

src/hooks/
  useIsDesktop.ts             ← new

src/app/[locale]/(app)/<route>/
  page.tsx                    ← thin orchestrator
  <Route>Mobile.tsx           ← extracted from current page.tsx, untouched
  <Route>Desktop.tsx          ← new
```

### Bottom-sheet → polymorphic `<Sheet>` (Wave 3)

The mobile sheets — `LoginCtaSheet`, `PredictionSheet`, `ShareSheet`, `LateHintSheet` — become a polymorphic `<Sheet variant="bottom" | "modal">` that picks the right surface based on `useIsDesktop()`. One component, two surfaces. Refactored before any desktop usage so a regression-only mobile release verifies zero breakage.

### What stays untouched

- next-intl routing + locale prefix
- `geo-timezone` cookie + format patterns
- Auth.js session machinery
- Service-worker / PWA / offline page
- All API routes, cron jobs, padelgod workers, relay

## Page inventory

~17 routes. Each gets a desktop layout in the wave indicated.

| Route | Wave | Layout treatment | Effort |
|---|---|---|---|
| `/home` | W1 | 2-col, main + per-page rail, spotlight hero | L |
| `/matches`, `/matches/[date]` | W2 | 2-col, date jumper rail, grouped by tournament | M |
| `/rankings` | W2 | 2-col, race/official + movers rail, wider rows | M |
| `/tournaments` | W2 | 2-col, calendar rail, 3-col tournament tile grid | M |
| `/feed`, `/feed/article/[id]` | W2 | 2-col, trending + sources rail, wider cards | M |
| `/match/[id]` | W3 | Hero + tabs widen (Overview, Scores, Stats, Momentum), related-matches rail | L |
| `/player/[id]` | W3 | Bio hero + stats grid, season chart full-width, upcoming/recent rail | L |
| `/tournaments/[id]` | W3 | Multi-tab dashboard (Matches, Draw, Schedule, Players, Stats), live ticker rail | L |
| `/profile`, `/profile/settings/*` | W4 | Bio header, settings as section list, sub-pages get sidebar nav | M |
| `/search` | W4 | Header command palette + dedicated `/search` results page | M |
| `/following` | W4 | Grid of followed players, upcoming-matches rail | S |
| `/notifications` | W4 | Single-column inbox, settings rail | S |
| `/achievements` | W4 | Badge grid, progress sidebar | S |
| `/padelgenius` | W4 | Game UX — keyboard input + click hot-zones; needs its own mini-design | XL |
| `/about`, `/welcome`, `/offline` | W4 | Marketing-style 1-col, max-width capped, big type | S |

Effort legend: S = a few days · M = ~1 week · L = ~2 weeks · XL = its own project (allow extra time inside W4).

## Wave plan

Each wave ends with shippable, observable progress in production. Total ~10–12 weeks.

### Wave 1 — Foundation + Home (~1.5–2 weeks)

**Ships:** Desktop home goes live.

- `useIsDesktop` hook + breakpoint logic + cookie-based first-paint hint
- `DesktopShell` + `Topbar` + grid layout
- Topbar search box renders, but click navigates to existing `/search` page (real command palette is W4)
- Topbar Sign-in button calls the existing `openLoginSheet()` from `LoginSheetProvider` — Wave 1 reuses the existing bottom-sheet UI (it'll look slightly off on desktop until W3); Wave 3 swaps the underlying `<LoginSheet>` to use the polymorphic `<Sheet variant="modal">` so it renders as a centered desktop modal
- `LiveTickerRail` (always-on, used by every later page)
- `HomeDesktop` — full 2-col implementation matching the agreed mockup
- `(app)/layout.tsx` updates: always render `<Topbar>` on desktop; suppress `<BottomNav>` on desktop; suppress `.app-frame` only for routes that have a `<*Desktop>`
- Page-level branching pattern proven on one route

### Wave 2 — List pages (~2–3 weeks)

**Ships:** 5 main routes feel "desktop native".

- `MatchesDesktop` + `matches/[date]Desktop` + `DateJumperRail`
- `RankingsDesktop` + `MoversRail`
- `TournamentsDesktop` + `CalendarRail`
- `FeedDesktop` + `feed/article/[id]Desktop` + `SourceWeightsRail`
- `WatchTonightRail`, `RankingsRail`, `NewsRail` shared across pages where they fit

### Wave 3 — Detail pages + sheet→modal (~3–4 weeks)

**Ships:** Click-through experience coherent end-to-end.

- Polymorphic `<Sheet>` refactor (mobile-only release first to verify no regressions)
- `match/[id]` desktop with `RelatedMatchesRail`
- `player/[id]` desktop with `PlayerStatsRail`
- `tournaments/[id]` desktop dashboard
- All 4 mobile bottom sheets (`LoginCtaSheet`, `PredictionSheet`, `ShareSheet`, `LateHintSheet`) opt into the modal variant on desktop

### Wave 4 — Utility + game + retirement (~2–3 weeks)

**Ships:** Phone-frame fully retired. Desktop site complete.

- Profile + settings + notifications + following + achievements
- Search topbar input upgraded to inline command palette (instant results dropdown); `Enter` still navigates to `/search`
- About + welcome + offline (marketing-style)
- PadelGenius desktop variant (keyboard + click hot zones) — **may be deferred to a follow-up project** if its design exercise turns out to be larger than estimated; in that case, PadelGenius keeps phone-frame chrome until then
- **Delete** `.app-canvas / .app-frame / .app-screen` CSS from `src/app/globals.css` (only after every other route has a `<*Desktop>` or PadelGenius is the explicit holdout)

## Decisions resolved

These were settled during brainstorming so the implementation plan can act on them.

1. **Search UX in topbar.** Final form is an inline command palette dropdown (Spotlight-style, instant results). No page transition on search-input click. Submitting `Enter` navigates to the existing `/search` page with the query. Phased delivery: Wave 1 ships the search box but click navigates to `/search` (placeholder); Wave 4 upgrades to the live-results palette.
2. **Sign-in button on desktop.** Auth modal in place — built on the polymorphic `<Sheet variant="modal">` from W3. Until W3 ships, the topbar Sign-in button calls the existing `openLoginSheet()` from `LoginSheetProvider`, which renders the current bottom-sheet on desktop (acceptable interim — slightly off-brand for desktop but fully functional).
3. **Topbar persistence on still-phone-framed pages during Waves 1–3.** Yes — keep the new topbar above the phone-frame body during the rollout. Avoids the "navigation disappeared" cliff. Implementation: `(app)/layout.tsx` always renders `<Topbar>` for desktop, and the phone-frame chrome only wraps `<main>` content.
4. **Tournament detail tabs (W3).** Same horizontal pill tabs, just wider. Vertical sidebar tabs deferred — revisit if it feels cramped after W3 ships.
5. **Match detail momentum chart (W3).** Stretch to fill the wide column (~700px). Side context (player heads, set timeline) is future polish, not in scope.

## Top risks

1. **Hydration mismatch on first paint.** First server render assumes mobile, client mounts and re-renders desktop. The `device-class` cookie narrows the window; the first paint may still flicker for ~50ms.  *Mitigation:* accepted trade-off vs SSR-only branching, which complicates the `useIsDesktop` API and forces awkward server/client splits.
2. **Component drift between mobile and desktop.** Adding a feature to mobile only, forgetting desktop. *Mitigation:* PR template checkbox ("Desktop variant updated or N/A"); per-feature acceptance review.
3. **Bottom-sheet → modal port** breaks existing mobile interactions. *Mitigation:* refactor `<Sheet>` to be polymorphic before any desktop usage; ship one mobile-only release first to verify zero regressions.
4. **PadelGenius desktop UX.** Swipe gestures have no mouse equivalent. *Mitigation:* keyboard-driven (left/right arrows = swipe direction) + clickable hot zones. May need its own mini-design exercise inside W4.
5. **Tournament detail tabs (`tournaments/[id]`) are already info-dense.** Widening Matches / Draw / Schedule / Players / Stats panels without bloating won't be trivial. *Mitigation:* budget extra time in W3 for this specific page.

## References

- Mobile UI source: `src/app/[locale]/(app)/*`
- Existing phone-frame chrome: `src/app/globals.css` lines 260+ (under `@media (min-width: 1100px)`)
- Original phone-frame commit: `9167980` (2026-04-26)
- Reference mockups: see top of doc

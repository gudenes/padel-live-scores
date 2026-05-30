# Live Odds Admin Console — Implementation Design

**Status:** Draft for review
**Date:** 2026-05-30
**Source design:** External handoff "Padel Admin — Live Odds Console" (Claude Design), bundled at `design_handoff_padel_admin/` (`README.md`, `reference/admin.css`, `reference/admin.js`, `reference/Padel Admin.html`, screenshots). That handoff is the **visual + behavioral contract**; this doc adapts it to the `apps/ops` codebase.

---

## 1. Overview & scope

Build the **Live Odds** screen in the `apps/ops` admin app (`admin.padelnachos.com`): a real-time, scoreboard-style operations view of **model-computed win probabilities and fair odds** for live padel matches. Internal tool, operators only — **not** a consumer surface, **no external bookmaker data**.

The handoff also introduces an app-shell redesign (global header, always-dark rail, theme toggle, brand-workspace switcher, connection-state system) that this screen sits inside. We implement the shell + the Live Odds page; other pages keep their current rendering for now and adopt the new shell incrementally.

### In scope
- New app shell: global header, always-dark collapsible rail (the 19-page IA), page header.
- Light/dark theme toggle (light default), persisted.
- Brand-workspace switcher (Nachos / Labs) in the header, persisted — Labs is a placeholder identity.
- Live Odds page: KPI row, 2-column content (live matches table + sticky selected-match detail panel), filters, footer note.
- Connection-state system (`loading | live | reconnecting | offline`) driving skeleton, model pill, rail status, banner, and frozen-odds treatment.
- A typed **data contract** for the model output, behind a provider seam, with a **stub/mock provider** so the UI is buildable and demoable before the real model/feed exist.

### Explicitly out of scope (dependencies / later)
- **The win-probability model itself.** No odds/model code exists in the repo today (confirmed by search). This screen consumes model output; producing it (the model + the Padelgod live feed wiring) is a **separate workstream**. This spec builds the UI against a stub provider and a defined contract.
- Real **Padel Labs** identity (logo, whether it gets its own accent).
- Migrating the other 18 admin pages to the new shell (incremental, follow-up).
- Real filtering of the dataset beyond visual state, pagination for "all 28", deep empty states.

---

## 2. Key decisions (please confirm during review)

1. **Styling approach — ship a dedicated CSS file, not inline CSS-in-JS.**
   `apps/ops` currently styles via inline `CSSProperties`. This design depends on `:hover`, `::before`/`::after` (speed-line nav, score-flash sweep, serve dots), `@keyframes` (pulse, shimmer, sweep, spin), `@container` queries (column shedding), and `[data-conn]`/`[data-theme]` descendant selectors — **none of which inline styles can express.** Recommendation: adapt `reference/admin.css` into a co-located stylesheet imported by the Live Odds route (and a shared shell stylesheet), with the **design tokens added to `apps/ops/src/app/globals.css`** as CSS custom properties under `:root` and `:root[data-theme="light"]`. This is a deliberate, scoped deviation from the inline convention, justified by the design's needs.
2. **Tailwind usage.** `globals.css` already `@import 'tailwindcss'`. We can mirror tokens into Tailwind 4 `@theme` for utility ergonomics, but bespoke components (odds bar, connection states) stay as plain CSS. Recommendation: tokens as CSS variables (authoritative) + optional `@theme` mirror; do **not** rewrite the components as utility soup.
3. **Fonts.** Handoff specifies **Bricolage Grotesque** (display) + **JetBrains Mono** (mono) + **Inter Tight** (body) — all *substitution-flagged* (not in the production design system yet). Recommendation: gate behind review — either (a) load via Google Fonts as the handoff does, or (b) ship with the system stack first and swap later. Default to (a) for fidelity, with a single `@import`/`next/font` switch.
4. **Theme default.** Light is the default per handoff (note: the main consumer app is dark-only "Forge Dark v2" — these are different products; the admin gets its own light-default scoreboard theme). Persist `localStorage["padel.theme"]`.
5. **Brand switcher scope.** Include the header switcher + persistence now (cheap, in the design), with Labs as a placeholder mark. Actual Labs accent/identity deferred.

---

## 3. Where it lives in `apps/ops`

```
apps/ops/src/
  app/
    globals.css                      # + theme tokens (:root, :root[data-theme=light]) + font import
    (app)/
      layout.tsx                     # adopt new AppShell (global header + rail) — see §4
      live-odds/
        page.tsx                     # server component: fetch initial snapshot, render <LiveOddsView>
        live-odds.css                # component styles adapted from reference/admin.css
        _components/
          LiveOddsView.tsx           # client orchestrator: state, selection, filters, motion
          KpiRow.tsx
          LiveMatchesTable.tsx       # table + filters + connection banner + skeleton
          MatchRow.tsx
          OddsBar.tsx
          DetailPanel.tsx            # selected match: probs, win-prob chart, drivers, CTAs
          WinProbChart.tsx           # SVG area+line (port of admin.js drawChart)
          ConnectionBanner.tsx
        _lib/
          types.ts                   # Match, Pair, ConnectionState, etc. (the data contract)
          useLiveOdds.ts             # provider hook: subscribe → matches[], connection, KPIs
          stub-provider.ts           # mock data + simulated motion (port of admin.js feed)
  components/
    shell/
      AppShell.tsx                   # column layout: GlobalHeader + Rail + main slot
      GlobalHeader.tsx               # brand switcher, search, env pill, theme, bell, avatar
      Rail.tsx                       # always-dark rail; reuses the canonical 19-page IA
      ThemeProvider.tsx              # data-theme on <html>, persistence, no-transition guard
      BrandProvider.tsx              # data-brand on <html>, persistence
```

The Rail's nav data is the **same canonical IA** already in `apps/ops/src/components/Sidebar.tsx` (Today, Tournament Ops, Catalogs, Content, System). Reuse that list; the new `Rail.tsx` supersedes `Sidebar.tsx`'s presentation. Live Odds is added as a new top-group item with a LIVE pill.

A `/live-odds` route is added under the `(app)` group (operator-authenticated like the rest). Add a Rail entry + this route.

---

## 4. App shell

Layout (full-viewport, no shell scroll; only `.pagebody` scrolls):

```
.app  (flex column, height 100vh, overflow hidden)
 ├─ GlobalHeader            (58px)
 └─ .shell (flex, flex:1)
     ├─ Rail                (236px ↔ 70px collapsed, ALWAYS dark)
     └─ .main (flex col, min-width:0)
         ├─ PageHeader      (56px)   — per-page; Live Odds supplies crumb + model pill + auto-refresh + clock
         └─ .pagebody (overflow-y:auto)  — page content
```

- `ThemeProvider` sets `data-theme` on `<html>` (default `light`), persists to `localStorage["padel.theme"]`. **Critical:** do **not** put a CSS `transition` on `<body>` `color`/`background` (Chromium freezes the computed value on theme flip — documented bug). Only transition theme-independent properties.
- `BrandProvider` sets `data-brand` (`nachos|labs`), persists to `localStorage["padel.brand"]`; swaps wordmark, host subtitle, mark glyph. Lime stays the accent for both.
- **Rail is always dark in both themes** (the "court tunnel"): its own token set (`--rail-bg` `#121212` gradient, `--rail-text` `#D6D0C2`, etc.). Collapsible to 70px (icons + hover tooltips); accordion groups; active nav = lime gradient fill with `--lime-glow` + a diagonal speed-line `::before`. Rail footer is the **connection-state indicator** (status dot + "Padelgod online · WebSocket · 42ms").
- **GlobalHeader**: brand switcher (mark tile + two-line lockup + dropdown), centered search (max 540px, `⌘K`, lime focus ring), right cluster (`Prod` env pill, theme sun/moon toggle, notification bell with red unread dot, avatar tile).

The shell is introduced in `layout.tsx`; existing pages render inside it unchanged. Migrating their internal chrome is a follow-up.

---

## 5. Design tokens

Port both token blocks verbatim from `reference/admin.css` (lines 8–139) into `apps/ops/src/app/globals.css`:
- `:root { … }` — dark values (default), plus the **rail tokens (always dark)**, header tokens, radii (`--r-xs:6 … --r-2xl:20 --r-full:9999`), shadows, motion (`--t-fast:.12s ease`, `--t:.2s cubic-bezier(.25,.1,.25,1)`), layout (`--gh:58px --ph:56px`), and fonts.
- `:root[data-theme="light"] { … }` — light overrides for surfaces, borders, text ramp, lime, live, orange, categories, header, shadows.

Token groups: surfaces, borders, text (warm parchment ramp), **lime** (hero accent + `-ink`/`-text`/`-bg`/`-border`/`-glow` + `--track`), **live red** (LIVE only), **orange** (swing/break/game points), category accents (men/women), rail (always-dark set). Exact hex values are in `reference/admin.css`; treat them as the spec.

Color discipline (must hold): **lime = the only hero accent**; **red = LIVE/down-movement only, never decorative**; **orange = hot swing / game points / Break status**.

---

## 6. Data contract (`_lib/types.ts`)

The UI is built against this typed shape, supplied by a provider (stub now, real later):

```ts
type ConnectionState = 'loading' | 'live' | 'reconnecting' | 'offline'
type Confidence = 'full' | 'med' | 'low'
type MatchStatus = 'Live' | 'Break' | 'Scheduled'

interface Pair { name: string; gender: 'men' | 'women'; serving: boolean }
interface Match {
  id: string
  pair1: Pair; pair2: Pair
  tournament: string; tournamentShort: string; court: string; round: string
  setScores: Array<{ a: number; b: number; current: boolean }>
  gamePoints: { a: string; b: string } | null   // null when Break/Scheduled
  status: MatchStatus; scheduledTime?: string
  winProbA: number                               // favorite-side % (pair1)
  fairOddsA: number; fairOddsB: number           // 100 / pct
  movement15m: number                            // signed delta
  confidence: Confidence
  lastUpdatedSeconds: number
  winProbHistory: number[]                       // for the chart (cap 30)
  drivers?: { firstServe: [number, number]; breakPts: [string, string]; totalPts: [number, number] }
}
interface LiveOddsSnapshot {
  matches: Match[]
  kpis: { liveMatches: number; preMatchModeled: number; biggestSwing: { pct: number; label: string }; lowCoverage: number }
  connection: ConnectionState
}
```

`useLiveOdds()` returns `{ snapshot, connection, autoRefresh, setAutoRefresh, selectedId, select, filters, setFilters }` and abstracts the provider. **Stub provider** ports `admin.js`: seeds 8 rows (same seed data as `reference/Padel Admin.html` `<tbody>`), a ticking clock from 09:42:18, the simulated motion engine (jitter win%/odds/movement/upd + score-flash, only when `autoRefresh && connection==='live' && !reduced-motion`), `winProbHistory` seeding (`seedHistory`), and the boot sequence `loading → (1.15s) → live`. **Real provider (later):** subscribe to the Padelgod WebSocket; map socket lifecycle → `connection`; KPIs are aggregates over the live set.

> Dependency flag: the real provider needs an actual win-probability model + the Padelgod live odds feed. Neither exists yet. This spec ships the UI + stub; wiring the real model/feed is tracked separately.

---

## 7. Components & behavior

### KPI row (`KpiRow`)
4 cards, 14px gap. Each: 3px left-edge accent bar (lime; orange for the swing card; neutral for muted), caps label + 14px icon (+ inline lime "▲ +5" trend pill on card 1), big Bricolage 32px number (orange on swing card), sub line with lime/red-bolded figures, bottom-right sparkline SVG. The four: **Live matches** `28`, **Pre-match modeled** `156`, **Biggest swing · 15m** `+34%`, **Low coverage** `2`.

### Live matches table (`LiveMatchesTable` + `MatchRow`)
Panel (16px radius) → panel header (title + subtitle + red live-count pill) → filter bar (Tournament/Gender/Tier/Round pill selectors + All/Live/Break/Sched segmented + Swinging toggle + Clear) → filter summary ("Showing 8 of 28" + removable lime tag) → connection banner (hidden when live) → skeleton (only when `loading`) → `.tablescroll > table` → footer ("View all 28 →").
Columns: **Match · Tournament · Sets·Pts · Win probability · 15m · Conf. · Upd**. Row anatomy: two stacked pair rows (serving dot, lead/trail weighting, M/W gender tag), tournament + court/round subline, per-set columns with current-set lime + orange game-point box (serve `•`) + status badge, the **odds bar** (`OddsBar`), movement chip, 3-bar confidence meter, seconds-since. Row click → `select(id)`. Selected = `--bg-sel` + 3px inset lime bar.

### Odds bar (`OddsBar`)
28px, mono. Left segment = lime gradient filled to favorite %, animates `width .6s`; right = neutral track with underdog %. Below: two fair-odds decimals.

### Detail panel (`DetailPanel` + `WinProbChart`)
366px, sticky. Updates on selection. Head (SELECTED MATCH label + title + meta) → two probability rows (pair name + big 26px % + fair odds) → win-prob trace (sunken well, SVG area+line of favorite history, 50% dashed guide, axis labels, lime end-dot, Set/Match toggle, legend) → three driver stat bars (1st serve / break pts / total pts) → CTA row ("Pin to wall" primary + "Share"). Chart math ports `drawChart` from `admin.js` (CW 348 × CH 120).

### Connection states (`[data-conn]` on `<html>`)
| State | Rail footer | Model pill | Banner | Data |
|---|---|---|---|---|
| `loading` | amber, "connecting…" | neutral "Connecting" | — | **skeleton rows** replace table |
| `live` | green, "online · WebSocket · 42ms" | red "Model live" | hidden | normal; motion runs |
| `reconnecting` | amber pulse, "reconnecting…" | orange "Model stale" | **orange** + spinner | motion paused |
| `offline` | red, "offline · retry 5s" | neutral "Model frozen" | **red** + Retry | odds desaturated, LIVE badges + count grayed |

Driven by `[data-conn]` descendant CSS (port lines 490–531). Retry button → forces reconnect (stub: → `live`).

### Interactions
Theme toggle; brand switch; sidebar collapse + accordion + active; row selection (first selected on load); filter segmented/chip visual state (+ real dataset filtering); ticking clock; live-motion engine; honor `prefers-reduced-motion` (disables all animation + the simulated feed). Persist theme & brand.

### Responsive
Container-query column shedding on the table panel (`container-type:inline-size`): hide **Upd @≤880px → Conf @≤800px → 15m @≤670px** before resorting to horizontal scroll. Under 1200px the 2-col content stacks (detail panel becomes static, below). Keep the `min-width:0` shrink fixes.

---

## 8. Accessibility & quality
- `prefers-reduced-motion`: no animations, no simulated motion (already in contract).
- Focus-visible rings (lime) on interactive controls; search ring as specified.
- Keyboard: rows selectable via keyboard; `Esc` closes brand menu; toggles are buttons with `aria-pressed`.
- Color discipline keeps red semantic (LIVE) — don't let it leak into decoration (a11y + meaning).

## 9. Testing
- Unit: `seedHistory`/motion math, `fmtOdds` (`100/pct`), KPI aggregation, win-prob → chart point mapping.
- Component: row selection updates detail panel + chart; filter state; connection-state rendering (skeleton/banner/frozen); theme/brand persistence.
- Visual: match the three screenshots (light, dark, offline) as pixel targets.
- Guard: assert no CSS transition on `body` color/background (the documented Chromium bug).

## 10. Open items
- Real Padel Labs identity (logo + accent).
- The win-probability **model** + Padelgod live-odds **feed** (prerequisite for the real provider).
- Real filtering semantics, pagination for "all 28", empty states beyond loading/offline.
- Font substitution sign-off (Bricolage / JetBrains Mono / Inter Tight vs system stack).
- Migrating the other admin pages onto the new shell.

## 11. Suggested build phases
1. **Tokens + shell**: theme/brand providers, globals tokens, GlobalHeader, always-dark Rail, PageHeader; mount existing pages inside.
2. **Live Odds static**: page + CSS, KPI row, table + rows + odds bar, detail panel + chart — against the **stub provider** with seed data.
3. **Interactions**: selection, filters, theme/brand persistence, collapse/accordion, clock, simulated motion, reduced-motion.
4. **Connection states**: skeleton, banner, model pill, rail status, frozen treatment; boot sequence.
5. **Responsive**: container-query column shedding + stack.
6. **(Later, separate)** real provider: model + Padelgod WebSocket; replace stub.

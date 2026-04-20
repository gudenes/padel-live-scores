# Matches Page Redesign — Mockups

HTML mockups produced during the two brainstorm cycles that drove the Matches page redesign. Open any `.html` file directly in a browser (no build step). Logos are loaded from `/premier-padel-logo.svg` and `/fip-tour-logo.svg` — if you want those to render, run the Next.js dev server (port 3002) alongside.

## Specs + plans this mockup set drove

- **Spec:** [../../specs/2026-04-19-matches-apple-tabs-design.md](../../specs/2026-04-19-matches-apple-tabs-design.md) (first cycle) + [../../specs/2026-04-19-matches-page-full-redesign-design.md](../../specs/2026-04-19-matches-page-full-redesign-design.md) (full redesign)
- **Plan:** [../../plans/2026-04-19-matches-apple-tabs.md](../../plans/2026-04-19-matches-apple-tabs.md) + [../../plans/2026-04-19-matches-page-full-redesign.md](../../plans/2026-04-19-matches-page-full-redesign.md)
- **Branch:** `claude/badge-system` (29 commits ahead of main)

## Cycle 1 — Apple Sports tabs (Yesterday / Today / Upcoming)

Filename | What it explored | Outcome
---|---|---
`matches-mockups.html` | First pass: 3 variants (pure list, summary strip, live hero) | Pure list chosen — fastest to scores
`matches-mockup-fotmob.html` | FotMob-style structure in the dark chunky brand | Locked: date strip + filter chips + tournament cards
`matches-mockup-v2.html` | Today centred in date strip, tournament logos, Premier-first sort | Logos placeholder with initials; corner dots for circuit
`matches-mockup-v3-modern.html` | Round buttons + lime/gold CSS vars + dark/light preview | Theme tokens captured but direction held for later
`matches-mockup-v4.html` | Removed emojis, filter pills extended | Pills moved to SVG icons
`matches-mockup-v5.html` | Horizontally scrollable filter strip + country-flag tournament tiles | Kept flags, scrollable filters
`button-palette-review.html` | Palette A/B/C reviewer options | **A (Monochrome + signal)** chosen — lime for single active state
`matches-mockup-v6.html` | Palette A applied across the page | Live = outlined red, P2 demoted neutral
`matches-apple-tabs.html` | Simpler Apple-style tabs replacing the 3 status tabs | Yesterday/Today/Upcoming locked
`matches-apple-tabs-filter.html` | Filter icon + bottom sheet (replaces always-on chips) | Sheet wins; chip strip shows active filters
`matches-apple-tabs-filter-dates.html` | Dates under tab labels (Yesterday · Apr 18, Today · Apr 19…) | Dates stacked under label
`matches-no-top-bar.html` | Drop the 2px green/red bar on tournament headers | Bar removed; tournament name + inline live dot instead
`matches-subtle-grouping.html` | Three subtle grouping options (light header / left gutter / inline label) | **Option A — light text header** locked
`matches-option-a-dual-flags.html` | Option A with the dual-player-flag pattern restored | Dual-flag pattern preserved

This cycle shipped as the **Apple-tabs feature** (commits `f7c588a..044416d`, 15 commits on branch).

## Cycle 2 — Full redesign on top of Apple-tabs

Filename | What it explored | Outcome
---|---|---
`matches-2rows.html` | Compress each match to 2 rows (one per pair), remove meta-pill row | 2-row layout locked
`matches-2rows-v2.html` | Bigger tournament header font + flag size | Header type bump
`matches-2rows-v3.html` | Mixed-case tournament names + "matches inside a tournament container" | Contained card locked
`matches-2rows-v4.html` | Vertical divider between sets and live points, stacked "2nd set" label, bookmark + bell on upcoming | Live-row anatomy locked
`matches-2rows-v5.html` | Premier Padel logo replaces initials on the card header; FIP logo for FIP events | Circuit-logo tile locked
`matches-2rows-v6.html` | No country flag in the tournament header; A (flags) vs B (avatars) on match rows | Flags kept, tournament header goes logo-only
`matches-2rows-v7.html` | B variant with real player photos from production DB | Rejected — flags preferred
`matches-2rows-v8.html` | Tappable Live Now strip (one-tap filter to live-only) | Pattern idea superseded by v9
`matches-2rows-v9.html` | Filters + Live as a stacked two-button column | Locked
`matches-2rows-v10.html` | Tabs stretched to match action-column height | Locked
`matches-swipe-dates.html` | Option A (rolling window) vs Option B (full horizontal date strip) | **Option B locked** — ±14 days

This cycle shipped as the **full redesign** (commits `34bcaac..4bdb04c`, 14 commits on branch).

## Final shipped design

- ±14-day horizontal date strip, Today centred, YESTERDAY/TODAY/UPCOMING relative labels on ±1 days
- Stacked Filters + Live toggle action column on the right (same row height as the tabs)
- Contained tournament cards: circuit logo tile (Premier Padel / FIP Tour SVG) → hairline separator → `City, Country` + tier-tinted level pill + round label → `Live · N` chip + count badge
- Compact 2-row match rows with status-keyed right side:
  - **Live:** stacked "2nd set" label + set columns + 1-px vertical divider + live point column
  - **Finished:** tiny `Final` / `RET` / `W/O` label + set scores
  - **Upcoming:** vertical star + bell action cluster + date/time block
- Country flags preserved on each pair (dual overlapping, one per player)
- Live toggle disabled (grey, non-interactive) when the current day has zero live matches

## Viewing the mockups

```bash
# Serve with Python's built-in server (so SVG logo requests work via absolute URLs)
cd docs/superpowers/mockups/2026-04-19-matches-redesign
python3 -m http.server 8000
# Open http://localhost:8000/matches-2rows-v10.html (or any other file)
```

Or open any `.html` file directly. The circuit-logo `<img>` tags reference `/premier-padel-logo.svg` and `/fip-tour-logo.svg`, which only resolve when served from a context that also exposes `public/`. Starting the Next.js dev server (`npm run dev`) at port 3002 and pointing the mockups at `http://localhost:3002/<filename>` isn't viable (Next won't serve these), so: either run a static server from the `public/` directory, or ignore the missing logos (they render as broken `<img>` but the layout is still intact).

# Event Card Readability & Full-Height Layout

**Date:** 2026-06-09
**Status:** Approved design
**Component:** `BigTournamentCard` in `src/components/home/TournamentsView.tsx` (~L1126–1270)

## Problem

After cover images were added to the events-list cards (`b0544e80`), the card layout no longer reads well:

1. **Text legibility over the cover image.** The current overlay is a *horizontal* gradient (`linear-gradient(90deg, rgba(0,0,0,0.7) → 0.2)`). The card's content sits **top-left** at 18px, so the title and CTA land over the brighter, busier right/lower portion of the promo art and compete with the photo. The cover photo itself looks good — the issue is purely text-over-image contrast.
2. **Empty height on no-cover (FIP) cards.** The card is a fixed `aspect-ratio: 360/260`. With no `cover_image_url`, content clusters in the top ~120px and the bottom half is dead space.

Both problems share one root: content is **top-anchored** in a fixed-height card.

## Solution

Switch the card to a **bottom-anchored content stack over a vertical scrim**. The image (when present) owns the top of the card; the textual content gravitates to the bottom and sits on a near-opaque base. This fixes legibility *and* fills the height by design.

This is a **pure presentation change** to one component. No data model, API, or schema changes. The same structure applies to both cover and no-cover variants so the two stay visually consistent.

### Card structure (both variants)

The card container becomes a **flex column** (`display:flex; flex-direction:column`) keeping the existing `aspect-ratio:360/260`, `clipPath: CHUNKY.card`, diagonal gradient background, and state-tinted border.

Layered children, by `z-index`:

| z | Element | When |
|---|---------|------|
| 0 | `TournamentCoverImage` (`variant="hero"`) | cover only |
| 1 | **Top band** scrim — `linear-gradient(180deg, rgba(8,9,6,0.55) 0%, transparent 100%)`, ~64px tall | cover only |
| 1 | **Bottom-up scrim** — `linear-gradient(0deg, rgba(8,9,6,0.94) 0%, 0.82 16%, 0.45 38%, 0.08 60%, transparent 78%)` | cover only |
| 2 | Corner glow (existing, keep) | all |
| 2 | **Status pill** — absolute top-left | all |
| 2 | **Countdown badge** — absolute top-right | upcoming only |
| 2 | **Content stack** — `margin-top:auto` (pins to bottom): title row → meta → bottom row | all |

The content stack uses `margin-top: auto` to fill the flex column and pin to the bottom. On no-cover cards this gives a balanced **pill-top / content-bottom framing** instead of a top cluster with a void below.

### Text treatment

| Element | Over cover image | No cover (FIP) |
|---------|------------------|----------------|
| Status pill | **solid** state color bg, white text, soft shadow (`box-shadow: 0 2px 8px <statecolor>/0.4`) | current translucent style (`rgba(state,0.15)` bg, state-color text) |
| Title (flag + name) | **22–23px / weight 900**, `text-shadow: 0 2px 12px rgba(0,0,0,0.7)` | same size/weight, no shadow needed |
| Date / location meta | `#e6e8ea`, weight 600, `text-shadow: 0 1px 6px rgba(0,0,0,0.8)` | existing `MUTED` color |
| Level pill | frosted chip — `rgba(255,255,255,0.16)` bg, white text, `backdrop-filter: blur(4px)` | existing dim chip — `rgba(255,255,255,0.06)`, `MUTED` text |
| CTA | unchanged (state-colored chip) | unchanged |

Date + location collapse onto **one line** in the proposed mock (`6 – 14 jun. 2026 · Valencia`) to tighten the bottom band; keep two lines if the existing `formatDateRange` + `location` composition is cleaner to retain — non-blocking either way.

### Countdown badge

Use the existing **top-right** badge (`#BCE83B` chip) for `upcoming` in **both** variants, replacing the inline monospace countdown currently used on no-cover upcoming cards. One placement keeps the bottom stack uniform across states.

## Out of scope

- Sourcing cover images for FIP events (a separate data effort; this design makes the no-cover case look intentional regardless).
- The `TournamentCarouselCard` tile in `LiveTournamentsCarousel.tsx` (portrait 196×264 variant) — different layout, not affected.
- Stats / featured-seeds fills explored during brainstorming — dropped; the readability + bottom-anchor change is the agreed scope.

## Verification

- Visually verify in the running app (`npm run dev`, :3002) across the three states (live / ongoing / upcoming) **and** both variants (cover present, cover absent).
- Confirm legibility against a bright/busy cover (Valencia P1) and a no-cover FIP card (FIP Bronze Lanzarote).
- Check `prefers-reduced-motion` is unaffected (no new animation) and the pulsing live dot still renders.
- Reference mock: `.superpowers/brainstorm/.../readability-v2.html` (proposed column).
```

# Prediction Revamp — Design Spec

**Date:** 2026-04-12
**Status:** Approved for implementation

## Overview

Replace the current confusing 3-step prediction wizard with a single-screen "tap to predict" experience. Add community poll visibility, prediction badges on match cards, and post-match result tracking with animations.

**Core goal:** Make predictions feel engaging, quick, and rewarding — not like filling out a form.

## Current Problems

1. **3-step wizard** feels disconnected (pick pair → separate margin screen → confirmation)
2. **No payoff** — prediction sits in localStorage, nobody sees it, no reward
3. **No social proof** — predicting alone, no sense of community
4. **Emoji icons** (🎯😤🔮🔥) — should use branded SVG icons from BadgeIcon system

## Architecture

- **Storage:** localStorage (no change from current — no backend needed for MVP)
- **Icons:** Reuse BadgeIcon SVG icons (`trophy`, `checkmark`, `flame`, `bolt`, `crown`, `lock`) + add new `crystalBall` icon
- **Animations:** CSS transitions + keyframes, following existing app patterns
- **Community poll:** Simulated for MVP (random seeded from match ID), real Supabase table later

## Interaction Flow

### Single-Screen Layout (replaces 3-step wizard)

The prediction section renders as ONE continuous block on the match detail page. No step transitions, no wizard — all visible at once, state changes inline.

**State machine:**
```
empty → picked (pair selected) → confirmed (margin selected) → locked (match live)
```

### State: Empty (no prediction yet)

Shows:
1. **Heading:** "Who takes it?" with `trophy` SVG icon (small, inline)
2. **Two pair cards** side by side:
   - Player avatar circles (stacked, overlapping — existing pattern)
   - Pair surnames in pair colour (Pair 1: `#FF6B2B`, Pair 2: `#FFD166`)
   - Rankings below in muted text
   - Chunky card clip-path on each
3. **Quick comparison strip** below the cards (chunky card shape):
   - 3 columns: Win Rate, H2H, Recent Form
   - Pair 1 value (left, orange) vs Pair 2 value (right, yellow)
   - Data sourced from existing player fields (`win_rate`, `ranking`, `total_matches`)
   - H2H count from existing H2H fetch
4. **Prompt:** "Tap the pair you fancy" in dim text

### State: Picked (pair selected, awaiting margin)

On tap:
- **Selected card** gets bright border (pair colour), glow shadow, checkmark (SVG `checkmark`), "YOUR PICK" label
- **Other card** dims to 35% opacity, border goes to `rgba(255,255,255,0.06)`
- **Margin selector** appears inline below the cards:
  - "How does it end?" label
  - Two chunky buttons side by side:
    - **2–0** (green `#7ED321`) with "Straight sets" sublabel
    - **2–1** (orange `#F5A623`) with "Three-set battle" sublabel

**Animation:** Selected card scales up slightly (1.02) with `cubic-bezier(0.34, 1.56, 0.64, 1)` 300ms. Other card fades with 200ms ease-out.

### State: Confirmed (prediction saved)

On margin tap:
- **Prediction card** replaces the pair cards + margin selector:
  - Green tinted background (`rgba(126,211,33,0.04)`)
  - Green border (`rgba(126,211,33,0.15)`)
  - `checkmark` SVG icon (green) + "Your prediction" label
  - "Barahona / Zapata win 2–0" in bold green
  - "Change" button (chunky badge) on the right
- **Community poll** appears below:
  - "What others think" heading
  - Horizontal bar in chunky card shape:
    - Left side fills with Pair 1 colour, shows percentage + pair name
    - Right side shows Pair 2 percentage + name
  - "47 fans have predicted · You're with the majority" below
  - Bar animates from 0% to final width on first render (700ms ease-out)
- **Margin breakdown** below the poll:
  - Two chunky cards: 2–0 percentage and 2–1 percentage

**Animation:** Prediction card slides down from the pair cards position (300ms). Poll bar fills with staggered animation (500ms delay, 700ms fill).

### State: Locked (match is live)

When match status changes to `live`:
- Prediction section collapses to a compact card:
  - `lock` SVG icon + "Your prediction" label
  - Pair name + margin in green
  - "Predictions are locked once the match starts" in muted text
- No "Change" button — cannot modify

### Community Poll (MVP — Simulated)

For MVP, simulate community data using a deterministic seed from the match ID:

```typescript
function simulatePoll(matchId: string): { pair1Pct: number; totalVotes: number } {
  // Deterministic hash from match ID → consistent "community" percentages
  let hash = 0
  for (let i = 0; i < matchId.length; i++) {
    hash = ((hash << 5) - hash) + matchId.charCodeAt(i)
    hash |= 0
  }
  const pair1Pct = 45 + (Math.abs(hash) % 25) // 45-69%
  const totalVotes = 20 + (Math.abs(hash >> 8) % 80) // 20-99
  return { pair1Pct, totalVotes }
}
```

This gives each match a stable "community split" that looks realistic. When real Supabase persistence is added later, replace with actual counts.

## Match Card Badge

On the matches page and tournament detail, matches with a prediction show a small badge:

- **Position:** Header row, right-aligned (where time usually goes, shifted left)
- **Style:** Chunky badge clip-path, green-tinted background
- **Content:** `crystalBall` SVG icon (tiny, 8px) + "PREDICTED" text (7px, bold, green)
- **Visibility:** Only when localStorage has a prediction for that match ID

Implementation: check `localStorage.getItem('pn_match_predictions')` and parse to see if the match ID exists.

## Post-Match Result

When a finished match has a prediction in localStorage, show a result card on the match detail page:

### Correct prediction (pair + margin both right)
- `bolt` SVG icon (green) — "Spot on!"
- "Barahona / Zapata won 2–0 — just as you called it"
- Streak badge: `flame` icon + "3 in a row"
- Total badge: `crystalBall` icon + "12 predictions"
- Green tinted background

### Right pair, wrong margin
- `trophy` SVG icon (orange) — "Close call"
- "You picked the right pair but it went to three sets instead of two"
- "Right pair, wrong margin (+0.5 pts)" badge in orange
- Orange tinted background

### Wrong pair
- `crown` SVG icon (red, inverted mood) — "Not this time"
- "You backed Barahona / Zapata but Alfonso / Diestro pulled through 2–1"
- Red tinted background

**Animation:** Icon bounces in with `sp-pop` keyframe (scale 0→1.2→1, 400ms). Text fades in with 200ms delay.

## New SVG Icon: Crystal Ball

Add to `BadgeIcon.tsx` ICON_PATHS:

```typescript
crystalBall: (c, s) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="10" r="8"/>
    <path d="M8 18h8"/>
    <path d="M7 21h10"/>
    <path d="M9 14c0-1.5 1-3 3-3s3 1.5 3 3"/>
  </svg>
),
```

## Animations Summary

All animations respect `prefers-reduced-motion: reduce` — skip to final state.

| Moment | Animation | Duration | Easing |
|--------|-----------|----------|--------|
| Pair card tap (select) | Scale 1→1.02, border glow appears | 300ms | cubic-bezier(0.34, 1.56, 0.64, 1) |
| Pair card tap (deselect other) | Opacity 1→0.35 | 200ms | ease-out |
| Margin selector appear | Slide down + fade in | 300ms | ease-out |
| Prediction confirmed | Card transform (replace cards with confirmed card) | 300ms | ease-out |
| Community poll bar fill | Width 0→final% | 700ms | cubic-bezier(0.25, 0.1, 0.25, 1) |
| Poll bar delay | Starts 500ms after confirmed card appears | — | — |
| Post-match icon | Scale 0→1.2→1 bounce | 400ms | cubic-bezier(0.34, 1.56, 0.64, 1) |
| Post-match text | Fade in | 200ms | ease-out, 200ms delay |
| PREDICTED badge shimmer | Subtle opacity pulse 1→0.7→1 | 3s infinite | ease-in-out |

## Brand Alignment

### Colours (from globals.css Forge Dark v2)
- Backgrounds: `#1A1A1A` (base), `#141414` (card), `#1F1F1F` (comparison strip)
- Text: `#EEE4CE` (primary), `#9AAEC4` (secondary), `#6B7280` (muted), `#4A6F8E` (dim)
- Pair 1: `#FF6B2B` (orange), bg `rgba(255,107,43,0.06)`, border `rgba(255,107,43,0.25)`
- Pair 2: `#FFD166` (yellow), bg `rgba(255,209,102,0.06)`, border `rgba(255,209,102,0.25)`
- Green: `#7ED321` (confirmed, correct)
- Orange: `#F5A623` (margin selector, close call)
- Red: `#FF4655` (wrong prediction)
- Accent: `#38C8FF` (prediction count badge)

### Shapes
- All cards: `clip-path: polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)`
- All badges: `clip-path: polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)`
- All buttons: `clip-path: polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)`
- No border-radius anywhere — chunky shapes only

### Icons
- All icons from BadgeIcon SVG system — no emoji
- Stroke-based, outlined, consistent with achievement badges
- New `crystalBall` icon for prediction branding

### Copy (European tone)
- "Who takes it?" (not "Who wins?")
- "Tap the pair you fancy" (not "Select the team")
- "How does it end?" (not "Pick the margin")
- "Spot on!" (not "You got it right!")
- "Not this time" (not "Wrong!")
- "Close call" (not "Nice try")
- "You backed X" (not "You predicted X")
- "just as you called it" (not "exactly as predicted")
- "What others think" (not "Community Predictions")
- "Three-set battle" (not "3-set battle")

## Component Structure

```
src/app/match/[id]/page.tsx
  PredictionSection (rewritten)
    - PredictionEmpty (pair cards + comparison strip)
    - PredictionPicked (selected card + margin selector)
    - PredictionConfirmed (confirmed card + community poll)
    - PredictionLocked (compact locked card)
    - PredictionResult (post-match result)

src/components/BadgeIcon.tsx
  - Add crystalBall icon path
```

All prediction sub-states render within `PredictionSection` — no separate components exported. Internal state drives which sub-view renders.

## Data Requirements

No new database tables. No API changes. Everything uses:
- Existing `useMatchPrediction` hook (localStorage)
- Existing player data on the match object (`win_rate`, `ranking`, `total_matches`)
- Existing H2H data (already fetched in match detail)
- Simulated community poll (deterministic from match ID)

## Scope

### In scope
- Rewrite PredictionSection component
- Add crystalBall icon to BadgeIcon
- Add PREDICTED badge to match cards (matches page + tournament detail)
- Add post-match result card
- All animations listed above

### Out of scope (future)
- Supabase persistence for predictions (replace localStorage)
- Real community poll data (replace simulation)
- Prediction leaderboard
- Prediction streaks tracked server-side
- Share prediction card to social media
- Crystal Ball badge integration (already specced in badge system)

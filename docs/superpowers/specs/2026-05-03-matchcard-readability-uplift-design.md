# MatchCard readability uplift — design

**Date:** 2026-05-03
**Branch:** `claude/optimistic-cartwright-54a507`
**Surface:** [src/components/MatchCard.tsx](../../../src/components/MatchCard.tsx)

## Problem

The home page "Latest Results" section (`ResultCard`) feels noticeably more scannable than the matches-by-date page (`MatchCard`), even though both render the same data shape. Concrete deltas:

| Property | Home (`ResultCard`) | Matches (`MatchCard`) | Effect on matches page |
|---|---|---|---|
| Player name `font-size` | 13px | **12px** | Names smaller → harder to scan |
| Score `font-size` | 16px | **15px** | Result less dominant |
| Winner `font-weight` | 700 | **800** | Over-emphasis adds visual noise to a list |
| Card background | `rgba(255,255,255,0.03)` translucent | **`#141414` solid + `1px solid #222` border** | Each row feels boxed in; list reads as heavy |
| Pill row → pair gap | 6px | **10px** | Meta floats away from the result it describes |

The matches-page settings work for a single-match deep dive but penalise list scanning, which is the dominant use case.

## Decision

Adopt `ResultCard`'s typography scale and surface treatment in `MatchCard`. Preserve the live-state border (it's a status signal, not chrome) and all existing behaviour (loser dimming, monospace scores, chip row content, `<PredictionSection>`, etc.).

## Changes

All in [src/components/MatchCard.tsx](../../../src/components/MatchCard.tsx).

### 1. Player name typography
- `font-size`: `12` → `13`
- Winner `font-weight`: `800` → `700`
- Loser `font-weight`: stays `600`
- Loser color/opacity (`#B0B5BE`, `0.65`): unchanged

### 2. Score typography
- `font-size`: `15` → `16`
- `font-weight`: stays `700`
- `font-family: monospace`: unchanged

### 3. Pill / meta row spacing
- `marginBottom`: `10` → `6`

### 4. Card surface
- Default `background`: `#141414` → `rgba(255,255,255,0.03)`
- Default `border`: `1px solid #222` → `1px solid transparent` (preserve layout box, no visible chrome)
- Live state border + accent: **unchanged** (status signal must remain)
- Border-radius, padding (`12px 14px 12px 16px`): unchanged

## Preserved (non-goals)

- Chip row content (round, court, time)
- Live point indicator
- Winner "W" badge
- Date/time stack on scheduled cards
- Prediction pill
- All three status branches (`scheduled` / `live` / `finished|retired|walkover|ended`)
- Tournament group expansion, court grouping, sorting
- `MatchesTournamentGroup` itself

## Out of scope (deferred)

- Tour-logo redesign on tournament headers (separate spec)
- Changes to `ResultCard` (already good)
- Changes to `CompactMatchCard` (different surface, different constraints)

## Risk + verification

**Risk:** Removing the solid background and visible border on the tournament-detail "Matches" tab may make cards feel weightless when they don't sit inside the tournament group's court sections.

**Mitigation:** Verify on both surfaces before declaring done:

1. `/matches` (matches-by-date page) — cards inside `MatchesTournamentGroup` court sections
2. `/tournaments/[id]` "Matches" tab — cards in a flatter list

If the tournament-detail surface feels too floaty, fall back to a softer border (`1px solid rgba(255,255,255,0.06)`) instead of fully transparent. Decision made empirically from the preview, not in this spec.

**Other surfaces using MatchCard:** upset highlights — same readability gain applies, no regression expected.

## Implementation cost

~5 numeric changes in one file. No new components, no API changes, no migrations.

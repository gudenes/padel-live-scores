# Live Tournaments Carousel — LIVE chip simplification

**Date:** 2026-05-21
**Status:** Design approved, awaiting plan

## Goal

Replace the carousel's current "show red LIVE pill only when a match is `status='live'`/`'on_court'`" rule with a simpler one: **show a small static red `LIVE` chip whenever the tournament has any match scheduled today.** This aligns with how FIP markets its own tournaments — "this event is live this week" regardless of per-match coverage — while staying consistent with the existing calm-FIP philosophy (no pulsing, no false promise of point-by-point).

## Why

The carousel today checks `status='live'`/`'on_court'` per match to decide whether to render the red LIVE pill. For Premier-tier matches this works — padelgod's live-poller flips the status reliably. For FIP-tier matches it doesn't: the OOP writer runs every 15 minutes, so matches that are clearly on court right now may not have `status='live'` in the DB yet. The result: most FIP tournament cards never show a LIVE pill, even on days when FIP's own channel is broadcasting the event.

Tightening the per-match check would require deeper padelgod work. Loosening the rule to "running today with matches" matches reality: if the tournament is in its run window AND today is a match day, it's effectively live from the user's perspective.

## Rule

Per carousel card:

| Condition | Treatment |
|---|---|
| `matchesToday > 0` | Render small red `LIVE` chip (top-left, no pulse) |
| `matchesToday === 0` (rest day) | No chip; existing "Rest day" status line stays |

No Premier-vs-FIP differentiation. No separate `ONGOING` state. No tournament-status fallback for rest days. One rule.

### Chip style

Slimmer than the current pulsing LIVE pill:

```ts
{
  position: 'absolute',
  top: 9,
  left: 9,
  background: '#FF4655',   // unchanged red
  color: '#fff',
  fontSize: 8,             // was 9
  fontWeight: 900,
  padding: '3px 7px',      // was '4px 9px'
  letterSpacing: 0.8,
  clipPath: CHUNKY.badge,
  zIndex: 2,
}
```

No `animation: pulse`. The chip reads as a presence indicator, not a "scores ticking" signal.

## Code changes

### `src/lib/live-tournaments-carousel.ts`

- `MatchInfo` drops `hasLiveMatch`. Final shape:
  ```ts
  interface MatchInfo { matchesToday: number }
  ```
- `MatchForAggregation` drops the `status` field — no longer read.
- `buildMatchInfoMap` simplifies to a pure tournament-id counter (no `isLiveStatus` import or call).
- Module's `import { isLiveStatus }` from `./tournament-tier` becomes unused → remove.

### `src/components/home/LiveTournamentsCarousel.tsx`

- `TournamentWithMatchInfo` drops `hasLiveMatch`.
- Card's pill conditional changes:
  ```tsx
  // Before
  {tournament.hasLiveMatch && (<LIVE pill with pulse and bigger font />)}
  // After
  {tournament.matchesToday > 0 && (<LIVE chip, smaller, no animation />)}
  ```

### `src/app/[locale]/(app)/home/page.tsx`

- The match-counts query at line ~313 narrows:
  ```ts
  // Before
  .select('tournament_id, status')
  // After
  .select('tournament_id')
  ```
- The `decorate()` transform drops `hasLiveMatch: matchInfo.get(r.id)?.hasLiveMatch ?? false`.

### `src/lib/__tests__/live-tournaments-carousel.test.ts`

- Drop the 3 `hasLiveMatch` tests: live-flag-on-live, live-flag-on-on_court, no-live-flag-when-finished.
- Update remaining `buildMatchInfoMap` fixtures: drop the `status` field from rows (interface no longer has it). The "empty input" and "counts per tournament_id" tests stay but with `status`-free fixtures.
- Keep the 7 `compareTournamentsForCarousel` tests and 2 `getLocalDayBoundaryUTC` tests intact.
- New count: 11 tests (was 14).

## Trade-offs accepted

- **Premier tournaments with active live matches lose the pulse animation.** They get the same small static chip as FIP tournaments. If we later want Premier to stand out, it's a one-line keyframe addition.
- **All carousel cards with matches today look the same** regardless of whether scores are ticking right now. The "scores ticking" signal lives at the match-card level (the existing red LIVE pulse on `LiveMatchCard.tsx`), not on the tournament card. Defensible separation of concerns.
- **The `isLiveStatus` import from `tournament-tier.ts`** becomes dead in the carousel utils. Helper stays defined for other consumers.

## What this is NOT

- Not a change to `MatchCard.tsx`, tournament headers, match-detail hero, or any other surface
- Not a change to `isPresenceOnlyLive` semantics
- Not a change to padelgod's status-flagging behavior
- Not a change to the carousel's filtering logic (live/today scope unchanged; UPCOMING chip was already dropped in PR #361)

## Open questions

None.

## Implementation surface

Touched files:
- `src/lib/live-tournaments-carousel.ts`
- `src/lib/__tests__/live-tournaments-carousel.test.ts`
- `src/components/home/LiveTournamentsCarousel.tsx`
- `src/app/[locale]/(app)/home/page.tsx`

No DB migration, no env vars, no new dependencies, no new i18n keys, no padelgod work.

# Hide FIP Promises & Beyond Events (Display-Only)

**Date:** 2026-06-01
**Status:** Approved — ready for implementation plan

## Goal

Temporarily hide FIP **Promises** (`fip_promises`) and FIP **Beyond** (`fip_beyond`)
tournament events from padelnachos.com. This is a display-only, fully reversible
change: data keeps flowing in through padelgod, and re-enabling means emptying a
single constant.

## Scope

**In scope (display surfaces to filter):**

- **Tournaments page** (`src/components/home/TournamentsView.tsx`) — the FIP tab
  listing and the FIP sub-tier chip selector.
- **Home page** (`src/app/[locale]/(app)/home/page.tsx`) — the Live Tournaments
  carousel and the live-matches strip.

**Out of scope (deliberately untouched):**

- **Ingestion** — padelgod's `tournament-discovery` worker keeps discovering and
  storing Promises/Beyond rows. No data is deleted.
- **Matches list / match detail pages, feed, on-site search, sitemap/SEO** — not
  filtered. A Promises/Beyond match remains reachable by direct URL and may appear
  in those un-scoped surfaces.
- **`src/lib/tournament-labels.ts`** — keeps its `fip_promises`/`fip_beyond` label
  and tier-weight entries so any data outside the filtered surfaces still renders
  correctly.

## Background

`fip_promises` and `fip_beyond` are two FIP tournament `level` codes assigned by
padelgod's discovery worker (see `padelgod/src/lib/fip-categories.ts`). Promises is
the FIP youth circuit; Beyond covers FIP B1/B2/B3 sub-categories. Neither carries
Premier-tier live point-by-point, but FIP-tier matches can flip to `status='live'`
via OOP/results widgets, so a Promises/Beyond match can surface in live UI.

The home page's Premier sections already exclude all FIP levels, so the only home
leaks are the level-agnostic Live Tournaments carousel and the live-matches strip.

## Design

### 1. Single source of truth — `src/components/home/shared.tsx`

Add next to the existing `PREMIER_LEVELS`:

```ts
// Levels temporarily hidden from user-facing tournament/event surfaces.
// Empty this array to re-enable them everywhere. Display-only — ingestion
// (padelgod) is unaffected.
export const HIDDEN_TOURNAMENT_LEVELS = ['fip_promises', 'fip_beyond']
export const isHiddenLevel = (level?: string | null) =>
  !!level && HIDDEN_TOURNAMENT_LEVELS.includes(level)
```

This is the one switch: emptying `HIDDEN_TOURNAMENT_LEVELS` restores all surfaces.

### 2. Tournaments page — `src/components/home/TournamentsView.tsx`

- `FIP_LEVELS` stays the full canonical list (it documents every code padelgod can
  stamp). The FIP-tab query derives its level set by filtering hidden levels out:
  ```ts
  const levels =
    tab === 'premier'
      ? PREMIER_LEVELS
      : fipSubTier === 'all'
        ? FIP_LEVELS.filter((l) => !isHiddenLevel(l))
        : [fipSubTier]
  ```
- The FIP sub-tier chip array drops hidden tiers so the UI never offers them:
  filter the chip list through `isHiddenLevel` (removes the `fip_beyond` and
  `fip_promises` chips). The `all` chip has no `value` level and is unaffected.

### 3. Home page — `src/app/[locale]/(app)/home/page.tsx`

Filter client-side after fetch (avoids the PostgREST embedded-resource / `not.in`
null-drop pitfall, and preserves null-level rows that currently show):

- **Live Tournaments carousel** (`home:carousel-live-today`, ~line 311): drop rows
  where `isHiddenLevel(t.level)`.
- **Live matches strip** (`home:live`, ~line 293): drop matches where
  `isHiddenLevel(m.tournament?.level)`.

Both result sets are small (carousel limit 20; live matches bounded), so a
client-side `.filter()` is negligible.

## Testing

Display-only filter — verify in the running app rather than adding unit tests:

1. Tournaments page → FIP tab: no Promises/Beyond rows appear; the "Beyond" and
   "Promises" sub-tier chips are gone.
2. Home page: Live Tournaments carousel and live-matches strip contain no
   Promises/Beyond events.
3. `npm run lint` and `npm run build` pass.

Reversibility check: emptying `HIDDEN_TOURNAMENT_LEVELS` brings the chips, FIP-tab
rows, and home entries back with no other edits.

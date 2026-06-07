# Projection — entry-list pair picker

**Date:** 2026-06-06
**Status:** Design — pending implementation plan
**Extends:** the Road to Trophy "Projection" tab (specs `2026-06-06-road-to-trophy-projection-design.md` + the history/eliminated + polish work).
**Surface:** padelnachos.com public Projection tab.

## Summary

Replace the native `<select>` "Tracking" dropdown with a **tappable entry-list picker**. Opening the Projection tab shows the tournament's pairs as a list; the user taps a pair to see its road. The **top 4 still-active seeds** get a richer "feature card" with the large `photo_url` player image; everyone else is a compact row with the small overlapping headshots. Every row shows the pair's **champion %**. Eliminated pairs are greyed and sink to the bottom.

## Goals

- Kill the clunky system dropdown; make pair selection browsable and on-brand.
- Make the list useful on its own — a "who's favoured" outlook (champion % per pair).
- Two clean levels inside the tab: **list → road**, with a back affordance.
- Visually elevate the top seeds with the (already-existing, dormant) `photo_url` image.

## Non-goals

- No new projection data/worker changes — this is pure public UI over existing `tournament_projections` + `matches`.
- No change to the road view itself (only add a back button).
- No bookmarked-player auto-open (list-first; deep-link is the only auto-road path). Future nicety.

## UX

### Two views inside `ProjectionTab`

- **List view (default):** the entry-list picker (below). Shown when the tab opens with no `?pair=`.
- **Road view:** the existing road for the selected pair, plus a **back** control (‹ Back / pair name) that returns to the list.
- **Deep-link:** `?tab=projection&pair=…` (player card link) opens **straight to the road** for that pair; back → list. A stale/unknown `?pair=` falls back to the list.

### The picker (list view)

Header: "Pick a pair" + "Tap a pair to see its road to the trophy".

1. **Feature cards — top 4 active seeds** (section label "Top seeds"): each card = the two players' `photo_url` images (rounded-rect, ~48×60, top-aligned, slightly overlapped), a seed badge, the pair name, and the champion % (large) with a "champion" caption, and a `›`. Seed #1's card gets a subtle lime tint; the rest a neutral card.
   - `photo_url` falls back to the circular `avatar_url` headshot when missing; if neither, the initial-letter fallback.
2. **All pairs — compact rows** (section label "All pairs"): small overlapping headshot avatars (the smooth momentum-style stack), pair name + seed badge (if seeded), champion %, `›`.
3. **Eliminated pairs:** greyed (reduced opacity + grayscale avatars), an "Out · <round>" tag instead of champion %, sorted to the **bottom**.

Tapping any card/row selects that pair and switches to the road view.

### Ordering (decided)

Partition pairs into **active** and **eliminated**.
- **Active**, ordered: seeded pairs by seed ascending, then unseeded pairs by champion % descending.
- **Feature cards** = the first **4** of the active-ordered list (i.e. the top 4 active seeds; an upset top seed is no longer "active" so it sinks).
- **Compact rows** = the remaining active pairs (same order).
- **Eliminated**, greyed at the bottom: by seed ascending, then by `eliminated_round` depth / champion-prior.

## Data

All from existing sources — no schema/worker change:
- **Pairs + champion % + status + eliminated_round:** the `tournament_projections` rows already fetched by `useProjection`.
- **Seed per pair:** derived from the page's `matches` prop (`pair1_seed` / `pair2_seed`) → a `Map<pairKey, number>` (seeds exist only for the top 8/16; others undefined). Pure helper.
- **Images:** `avatar_url` (headshot) is already resolvable from the `matches` player objects; **`photo_url`** is NOT on those objects, so the picker fetches it for the displayed players — `players.select('id, avatar_url, photo_url').in('id', ids)` (anon, public-read) → `Map<id, {avatarUrl, photoUrl, name, country}>`. Fallback chain: `photo_url` → `avatar_url` → initial.

## Architecture / files

**Create:**
- `src/lib/projection-picker.ts` (+ test) — pure ordering: `buildSeedMap(matches): Map<pairKey, number>` and `orderPickerPairs(rows, seedByPair): { feature: ProjectionRow[]; rest: ProjectionRow[]; eliminated: ProjectionRow[] }` (feature = first 4 active by seed).
- `src/app/[locale]/(app)/tournaments/[id]/ProjectionPickerList.tsx` — the list UI (feature cards + compact rows + eliminated), props: `{ rows, seedByPair, images, onPick }`.
- `src/app/[locale]/(app)/tournaments/[id]/usePairImages.ts` — client hook fetching `photo_url`/`avatar_url` for a set of player ids.

**Modify:**
- `src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx` — add `view: 'list' | 'road'` state (default `list`; `road` when `initialPairKey` set), remove the `<select>`, render `ProjectionPickerList` for the list and the existing road + a back button for the road. Reuse `buildRoadVM` etc. unchanged.
- `src/messages/{en,es,pt,it,fr}.json` — add `pickAPair`, `pickHint`, `topSeeds`, `allPairs`, `back`. (`champion`, `out`, `eliminatedIn`, round labels already exist.)

## Edge cases
- **No seeds at all** (small FIP draw): no feature cards — everyone in the compact list by champion % desc. (Feature section hidden when fewer than ~2 seeds.)
- **Fewer than 4 active pairs:** feature only what exists.
- **Missing `photo_url`:** fall back to headshot; the feature card still renders (headshot scaled into the rounded-rect, or the compact look).
- **All eliminated (tournament over):** champion greyed/first; the champion (if any) featured with their winning road on tap.
- **Loading:** while `useProjection` / `usePairImages` resolve, show the existing loading placeholder.

## Testing
- **Pure ordering** (`vitest`): `orderPickerPairs` — feature = top 4 active by seed; unseeded after seeded; eliminated partitioned to the bottom; <4 active handled; <2 seeds → no feature. `buildSeedMap` derives correct pair→seed from matches.
- **UI:** picker renders feature cards + rows; tapping calls `onPick`; eliminated greyed at bottom; deep-link opens road; back returns to list.
- **Local verification** (per `memory/feedback_test-locally.md`): on ITALY MAJOR, the picker shows top-4 seed feature cards with real `photo_url`, compact rows, eliminated at bottom; tap → road; back → list; the player-card deep-link still lands on the road.

## Rollout
No new flags/migrations — ships under the existing `projection_enabled` feature flag. Pure UI on existing data.

## Branching note
Built stacked on the polish work (`feat/projection-polish` / PR #524) since both edit `ProjectionTab.tsx`. Merge order: polish (#524) → this; rebase on `main` once #524 lands.

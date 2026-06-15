# Money Rankings Tab — Design

**Date:** 2026-06-15
**Status:** Approved (design), pending spec review
**Author:** brainstormed with gudenes

## Summary

Add a third tab — **Money** — to the rankings page (`/rankings`), alongside the
existing **Oficial** and **Race** tabs. It ranks players by **prize money earned
this season (year-to-date)**, reusing the `player_tournament_earnings` data that
already powers the player-profile EarningsTab.

The leaderboard is **not** an official career money list. It is *estimated
prize money on tracked events since 2024*. That caveat is surfaced through a
hint sheet matching the existing **ProjectionExplainSheet** pattern.

## Goals

- A money leaderboard living natively inside the existing rankings UI (same
  header, gender toggle, row chrome, swipe/tab behavior).
- Honest framing of the estimate/coverage limits via a one-tap explainer.
- Zero new write pipelines — read-only over existing earnings data.

## Non-Goals (YAGNI)

- No all-time / career money toggle. **YTD (current calendar year) only.** A
  future iteration can add a year switcher; not now.
- No new earnings computation, backfill, or source changes.
- No doubles-pair money view, no per-event drill-down on this screen (tapping a
  player already routes to their profile EarningsTab for the breakdown).
- No calibration/accuracy guarantees beyond what the earnings engine already
  produces.

## Scope & data reality (drives the framing)

`player_tournament_earnings` (migration `20260504000001`) holds one row per
`(player_id, tournament_id, category)` with:

- `per_player_eur INTEGER` — the player's **half** of the pair prize money.
- `category` — `'men' | 'women'`.
- `round_eliminated` — `'F'`/`'SF'`/… (and `'W'` for champions per `20260522000000`).
- `source` — `premier_rulebook | fip_breakdown_scraped | fip_tour_rulebook_pct | manual`.
- `earned_at TIMESTAMPTZ` — canonicalised on `tournament.ends_at`.

Coverage is **Premier tier + FIP Tour tiers with a known prize table, 2024
onward**. Smaller events and pre-2024 results have no rows. Figures are
estimates from published prize tables and may differ from official numbers.
The hint sheet states all of this.

RLS: `player_tournament_earnings` has a public read policy
(`20260504000002`), so anon browser reads are allowed.

## UI

Matches the production rankings UI verbatim (validated against a live mockup):
global header, **Clasificación** title, big HOMBRES/MUJERES pills + publish
date, and the `SlidingInkTabs` row — now three tabs.

### Tab

- `RankType` becomes `'official' | 'race' | 'money'`.
- `SlidingInkTabs` gains a third `{ key: 'money', label: t('money') }` entry.
- `useSwipeTabs` count → 3; `RANK_KEYS = ['official','race','money']`.
- URL param: `?type=money` (existing pattern; `official` stays param-less).

### Money rows

Reuse the existing `PlayerRow` visual structure, with a money variant:

- **Rank**: computed position in the sorted list (dense rank — equal € share a
  rank, matching the existing gold/silver/bronze `RankBadge`). No delta chip
  (we have no week-over-week money history) — render the delta slot empty (`--`
  is fine, or omit; pick omit for honesty).
- **Avatar / name / flag / country**: unchanged.
- **Trailing**: the € amount (green, `RankBadge`-green styling) with an
  **events-count subline** (e.g. `14 events`) replacing the `PTS` label.
- **Heart** follow button: unchanged.
- Tap row → `/player/{id}` (lands on their profile; EarningsTab is the
  drill-down).

### Hint / "learn more"

The rankings page has no hero corner (unlike the projection tab), so the hint
trigger is a **caption strip directly under the tabs, shown only when Money is
active**:

> **Estimated prize money** · 2026 season  ⓘ

- The strip doubles as the tab's label/date and the hint trigger.
- The ⓘ is the grey, italic, secondary-colored circle from the projection
  `infoIcon` (`#9AAEC4`, 1.4–1.5px border).
- Tapping anywhere on the strip opens the explainer sheet.

**Explainer sheet** — mirrors `ProjectionExplainSheet` exactly: `createPortal`
to `<body>`, full-viewport scrim (`#0009`, tap to close), bottom sheet
(`#1c1e20`, cream `#EEE4CE` text, grab handle, `clip-path` chunky top,
`maxHeight 85vh` scroll), numbered chunky-chip steps (lime mono digits), a lime
callout box, and a right-aligned green `ChunkyPressButton` "Got it".

Content:
- **Title:** "How prize money is counted"
- **Intro:** "A leaderboard of estimated prize money won this season — not an
  official career money list."
- **Step 1 — Per-player split.** Prize money is awarded per pair; we show each
  player's half, summed across the season.
- **Step 2 — Tracked events only, from 2024 on.** Premier Padel & FIP Tour
  events with a known prize table. Smaller events and pre-2024 results aren't
  included.
- **Callout — Estimated.** Figures use published prize tables and may differ
  slightly from official numbers.

(No per-pair personalization — the projection sheet's contender/underdog
highlight block is dropped for this generic version.)

## Data access — server-side aggregation via RPC

The leaderboard needs **per-player season sums** grouped + sorted. A full
season across a category can approach the 10k PostgREST cap, and PostgREST
can't `GROUP BY` from the client. So aggregate in Postgres.

New SQL function (new migration, `SECURITY INVOKER`, runs as anon over the
public-readable table):

```sql
CREATE OR REPLACE FUNCTION public.money_leaderboard(
  p_category text,
  p_year     int,
  p_limit    int DEFAULT 500
)
RETURNS TABLE (
  player_id    uuid,
  total_eur    bigint,
  event_count  int
)
LANGUAGE sql STABLE AS $$
  SELECT player_id,
         SUM(per_player_eur)::bigint AS total_eur,
         COUNT(*)::int               AS event_count
  FROM public.player_tournament_earnings
  WHERE category = p_category
    AND date_part('year', earned_at) = p_year
  GROUP BY player_id
  ORDER BY total_eur DESC
  LIMIT p_limit;
$$;
```

Client flow on the rankings page when `rankType === 'money'`:

1. `supabase.rpc('money_leaderboard', { p_category: gender, p_year: <currentYear> })`.
2. Fetch the matching `players` rows (`id, name, display_name, country,
   avatar_url, category`) by `id IN (…)` — same fields the official/race path
   reads, minus ranking columns.
3. Join in memory, preserve the RPC's ordering, compute dense rank, render.

Current year derived client-side (`new Date().getUTCFullYear()`), consistent
with EarningsTab's YTD logic.

Empty state: if the RPC returns nothing (e.g. very early January before any
event ends), show the existing rankings empty-state pattern with money copy.

## Component boundaries

- `rankings/page.tsx` — extend `RankType`, tabs, swipe count, URL sync, and
  branch data-loading (`load()`): players-table path for official/race, RPC
  path for money. Keep the branch small; factor the money fetch into a helper
  (`loadMoneyLeaderboard(gender, year)`) so `load()` stays readable.
- `PlayerRow` — add a `money` mode (trailing = € + events subline, rank from a
  passed-in `displayRank` instead of `player.ranking`, delta omitted). Prefer a
  small prop extension over a forked component; if the branching gets noisy,
  split a `MoneyPlayerRow`.
- `MoneyExplainSheet` — new component. If building off `origin/main` (which has
  the merged projection feature), **extract a shared `ExplainSheet` chrome**
  from `ProjectionExplainSheet` and have both consume it; otherwise replicate
  its structure. Decision deferred to the implementation plan after confirming
  what's on the build branch.

## i18n

New keys under the `rankings` namespace in all five locales
(`en, es, pt, it, fr`):

- `money` — tab label ("Money" / "Dinero" / …)
- `moneyCaption` — "Estimated prize money" (strip text)
- `prizeColumn` — "Premio €" column header
- `moneyEventsCount` — "{count} events" subline (pluralized)
- `moneyEmpty` — empty-state line
- Explainer keys: `moneyExplainTitle`, `moneyExplainIntro`,
  `moneyExplainStep1`, `moneyExplainStep2`, `moneyExplainCallout`,
  `moneyExplainClose`.

## Testing

- **Unit:** the RPC's contract is covered by a small integration check (sum +
  count + ordering for a seeded category/year); the existing
  `compute-earnings.test.ts` already covers per-row amounts.
- **Manual (local, per project convention):** load `/rankings?type=money`,
  toggle gender, confirm rows/ordering against a known player's EarningsTab
  total, open the hint sheet, verify swipe between all three tabs and URL sync.
- Verify the money path stays under the 10k cap (RPC `LIMIT` + server-side
  aggregation guarantees this).

## Risks / open questions

- **Build branch:** should be a dedicated worktree off `origin/main` (shared
  main dir's branch is volatile per project convention). Confirm whether
  `origin/main` has `ProjectionExplainSheet` to share vs. replicate.
- **Partner near-ties:** players who always play together will have near/equal
  totals → many shared ranks. Acceptable; mirrors the official tab's behavior.
- **Dense rank vs. sequential position:** going with dense rank for visual
  consistency with the existing `RankBadge`. Cheap to change.

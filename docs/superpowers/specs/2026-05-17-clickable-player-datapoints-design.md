# Clickable Player Datapoints — Design

**Date:** 2026-05-17
**Status:** Design (awaiting implementation plan)
**Scope:** Player profile page + Rankings page

## Problem

Stat boxes and rank badges on the player profile (`/player/[id]`) are dead pixels today. A user looking at "Lucas Bergamini · 1 Título · €230.004 ganhos · 4,550 Pts FIP" has no way to drill down: which tournament did he win, which tournaments produced the prize money, where does he sit on the FIP ranking list. Each of these answers exists in our data — we just don't expose a path to it.

## Goal

Make five datapoints on the player profile clickable, each routing to the page that answers the underlying question:

| Click target | Destination | Why |
|---|---|---|
| Hero chip `Títulos` | `Temporada` tab, current year, titles call-out highlighted | "Which tournaments did he win?" |
| Hero chip `Pts FIP` | `/rankings?gender=men&type=official&highlight=<player_id>` scrolled so the player row is centered | "Where does he sit in the ranking?" |
| Hero pill `#14 World` | Same as `Pts FIP` | Same question, same destination |
| Overview card `Ganhos YTD` | New `Ganhos` tab, year chip = current year | "Which tournaments produced this year's prize money?" |
| Overview card `Ganhos Totais` | New `Ganhos` tab, year chip = `Tudo` | "Which tournaments produced career prize money?" |

## Non-Goals

- No changes to Overview, Parceiros, Partidas, or Stats tabs (beyond the two Overview cards becoming clickable)
- No new aggregations, leaderboards, or analytics widgets
- No drill-down beyond the existing tournament page (`/tournaments/[id]`)
- No new schema; no new backfill cron
- Rankings deep-link is not yet wired from other pages (home page, match cards) — out of scope for this phase, but the URL contract is forward-compatible

---

## Architecture overview

Three independent pieces, each shippable on its own:

```
┌─────────────────────────────────┐
│  Player Profile Page             │
│  src/app/[locale]/player/[id]    │
│                                  │
│   Hero chips ──┐                 │
│   Overview cards ┐               │
│                  ▼               │
│   ┌──────────────────────────┐  │
│   │ Tabs: ... · Ganhos (new) │  │ ◀── piece 1: new Ganhos tab
│   └──────────────────────────┘  │
│                                  │
│   Temporada tab body:            │
│   + Titles call-out (new)        │ ◀── piece 2: Temporada enhancements
│   + Tournaments list (new)       │
└─────────────────────────────────┘
              │
              ▼ (Pts FIP / #14 World click)
┌─────────────────────────────────┐
│  Rankings page                   │
│  src/app/[locale]/(app)/rankings │ ◀── piece 3: deep-link + scroll-to
│                                  │
│  ?gender=&type=&highlight=       │
└─────────────────────────────────┘
```

The three pieces share zero state. They can ship in any order, in any combination, behind no feature flag.

---

## Piece 1 — New "Ganhos" tab

### Placement

Tab is appended after `Partidas`. Final order:

```
Visão Geral · Temporada · Parceiros · Partidas · Ganhos
```

### Visibility

The tab is **rendered only when `earnings.allTimeEur > 0`**. This matches the existing rule that hides the Overview earnings widgets when career earnings are zero (page.tsx:902). For amateurs / juniors / players without resolved prize money, the tab list stays at 5 items.

### "NEW" pill

Orange `NEW` badge on the tab label, shown to each user for **30 days from their first visit to any player profile after launch**. Tracked in `localStorage` under key `ganhos_tab_new_until` — value is an ISO timestamp set on the first profile view, after which the badge is gone for that browser. Every user gets the discovery hint regardless of when they first arrive, and we don't have to ship a server-side launch-date constant.

### Body layout (top → bottom)

1. **Two summary widgets** (`Widget` component, side-by-side, 50/50)
   - `YTD 20XX` — current-year prize money + event count subtitle (e.g. "5 eventos")
   - `Carreira` — all-time prize money + "Desde 2024" subtitle (matches existing `earningsSinceLabel`)
2. **Year-chip selector** — `Tudo · 2026 · 2025 · 2024`. Years derived from rows that exist for this player. `Tudo` is the all-time view.
3. **Section head** — `Torneios · N` (count of rows for current filter)
4. **Tournament rows**, sorted by `earned_at` descending (most recent first). Each row links to `/tournaments/[id]` and shows:
   - Level flag stripe (Premier red, FIP Gold yellow, FIP Silver, FIP Bronze)
   - Tournament name (title-cased)
   - Round pill (VENCEDOR / FINAL / SF / QF / R16 / R32 / Q1-3) — from `round_eliminated`
   - Date (month + year)
   - Prize amount in EUR, right-aligned

### Data query

Single query on tab mount:

```ts
const { data } = await supabase
  .from('player_tournament_earnings')
  .select(`
    id,
    per_player_eur,
    round_eliminated,
    earned_at,
    category,
    tournaments (id, name, level, country, starts_at, ends_at)
  `)
  .eq('player_id', playerId)
  .order('earned_at', { ascending: false })
```

Single FK between `player_tournament_earnings.tournament_id` and `tournaments.id` (verified in migration `20260504000001_player_tournament_earnings.sql`) — no FK ambiguity, plain embed works.

Granularity is already 1 row per `(player, tournament, category)` per the `player_tournament_earnings` unique constraint. No aggregation needed.

### Edge cases

- **Year chip filter has zero results** (e.g. selected 2024 but earnings only span 2026): show "Sem ganhos em {year}" empty state in the list area. Year chips remain visible.
- **Earnings still loading**: skeleton rows (same chunky clip-path, dim background) until data resolves.
- **Player has earnings but no `tournaments` join** (orphaned earning row): skip the row in the UI, log warning.

### Coverage caveat (called out in UI)

`player_tournament_earnings` only contains rows where prize money has been resolved by the `recompute-earnings` cron — Premier rulebook, FIP scraped breakdown, FIP rulebook %, or manual. A player may have played tournaments that aren't in the table. **This tab is "tournaments with resolved prize money", not "all tournaments played"**. The "all tournaments" view is the Temporada tab (piece 2). We do not annotate this in the UI in v1 — the year chip count + section head count make the scope self-evident.

---

## Piece 2 — Enhanced "Temporada" tab

The Temporada tab today shows year chips, season summary widget, and monthly W/L bars. We append two things; we change nothing existing.

### Body layout (top → bottom)

1. Year chips (existing)
2. **NEW: Titles call-out** — shown when ≥1 title in selected year
3. Season summary widget (existing — record, win rate, match count)
4. Monthly performance bars (existing)
5. **NEW: Tournaments list**

### Titles call-out design

Gold-tinted card (`linear-gradient(135deg, rgba(212,160,23,0.15), rgba(245,166,35,0.05))` with 3px gold left border, chunky card clip-path):

```
TÍTULOS 20XX · N
[trophy-svg] FIP Gold Lisbon
              Abr 2026 · c/ Javi Garrido
[trophy-svg] (if more)
```

Trophy is an inline SVG icon at 14×14, gold (`#D4A017`) — not an emoji. Add to `src/components/icons/` if no existing trophy icon is available.

Hidden entirely when 0 titles for the selected year (no "0 titles" empty state).

### Tournaments list design

Section head: `Torneios 20XX · N`

Rows sorted date-desc, each linking to `/tournaments/[id]`:
- Level flag stripe
- Tournament name
- Round pill (best round reached this player)
- `N partidas · W-L` (matches the player played in this tournament + their record)
- Gold trophy SVG icon on right edge for title-winning rows (same icon as call-out)

### Derivation logic (no new queries)

The page already loads `derived.finished` (matches array filtered to finished status). The Season tab already filters those by `selectedYear`. We add two pure-function derivations on top:

```ts
// src/lib/derive-titles.ts
function deriveTitles(matches: MatchRow[], playerId: string): TitleEntry[]
// Returns: matches where round === 'F' AND player on winning pair
// Grouped by tournament_id. Includes partner name.

// src/lib/derive-season-tournaments.ts
function deriveSeasonTournaments(
  matches: MatchRow[],
  playerId: string,
  year: number
): TournamentSummary[]
// Returns: { tournament, bestRound, matchCount, wins, losses, isTitle }[]
// Sorted by latest match date desc.
```

`bestRound` ranking: `F > SF > QF > R16 > R32 > Q1-3`. If player won the final, `bestRound = 'W'`.

### Titles count reconciliation (dev-only)

`players.titles` is a stored integer (`page.tsx:235,643`) — its provenance is unclear (could be backfilled, manual, or scraped). Derived titles from finals may not exactly match.

On mount, if `derived.length !== player.titles`, log a `console.warn`:
```
[player-titles] Mismatch for player <id>: stored=<n>, derived=<m>
```

Dev-only, gated by `process.env.NODE_ENV !== 'production'`. This gives us a signal during rollout without gating UI behavior on agreement. **The displayed titles count remains `players.titles`** — the call-out card is a separate concept showing derived data. If they diverge, the UI shows both numbers next to each other without trying to reconcile.

### File extraction

Per the colocation-refactor preference and the fact that `page.tsx` is already 2000+ lines, `SeasonTab` is extracted to its own colocated file before being modified:

- `src/app/[locale]/player/[id]/SeasonTab.tsx` (new file, contents moved from `page.tsx`)
- Page imports it, identical render behavior
- Then titles call-out + tournaments list added in the new file

The original component does not move from its current responsibilities — this is a refactor purely for file size.

---

## Piece 3 — Rankings deep-link + scroll-to-player

The rankings page (`/rankings`) is fully client-rendered, loads top 50 from Supabase paginated by +50, has no URL state, and has no highlight/scroll API today.

### URL contract

```
/rankings?gender=<men|women>&type=<official|race>&highlight=<player_uuid>
```

All three params are optional and independent:
- `gender` defaults to `men`
- `type` defaults to `official`
- `highlight` triggers the scroll-and-pulse behavior

**Side benefit:** promoting `gender` and `type` to URL state makes the page share-friendly and back-button-friendly even without `highlight`. Existing toggle UI calls `router.replace(...)` instead of just `setState`.

### Render-enough-to-find-player

The page already fetches top 1000 in one query and renders 50 at a time via React state `visibleCount` ([rankings/page.tsx:283-302](src/app/[locale]/(app)/rankings/page.tsx#L283)). We don't need additional queries — only to bump `visibleCount` so the target row is in the DOM before scrolling.

After the initial load resolves, if `highlight` is present:

1. Find the player's index in the loaded array (`players.findIndex(p => p.id === highlight)`).
2. **If found in top 1000**: set `visibleCount = max(visibleCount, index + 25)` — renders enough rows that the target plus 25 rows of below-context are in the DOM.
3. **If not found** (player not in top 1000, or wrong gender selected): if the player object can be loaded (we know their `id` from the URL but not their data), fetch them by id to get `category` and `ranking`:
   - If their `category` differs from URL `gender`, update the URL to match and re-run the load — they'll be in the next render's list.
   - If their `ranking` is null or > 1000, show a non-blocking toast `"<Name> não está no top 1000"` and abandon the scroll.

This adds at most one extra row-fetch (only when the URL has the wrong gender or the player is missing from the loaded list).

### Scroll-into-view

After list paints, a `useEffect` keyed on the highlight target finds the row by `data-player-id={player.id}` attribute and calls:

```ts
row.scrollIntoView({ block: 'center', behavior: 'smooth' })
```

Single-shot. The effect's dependency array ensures it runs once per highlight value. After scrolling completes, we clear `highlight` from the URL via `router.replace(...)` — so a tab-refresh or back-navigation doesn't re-trigger the scroll while the user is reading.

### Highlight styling

A 2-second orange outline glow on the highlighted row that fades out:
- 0s: `box-shadow: 0 0 0 2px var(--orange), 0 0 16px rgba(245,166,35,0.4)`
- 2s: shadow fades to transparent, row returns to normal

Respects `prefers-reduced-motion: reduce` — in that case, the row gets a brief solid outline (no animation) and is removed after 2s.

The row itself does not change z-index, height, or position — the pulse is purely visual.

### Player page wiring

```ts
// Pts FIP chip onClick + #14 World pill onClick:
const gender = player.category === 'women' ? 'women' : 'men'
router.push(`/rankings?gender=${gender}&type=official&highlight=${player.id}`)
```

Both elements get `cursor: pointer`, the orange inset stroke + chevron from the mockup, and an `aria-label="View {name} in the rankings"`.

---

## Tab state synced to URL

Today `activeTab` is local `useState`. We promote it to a `?tab=` query param so:
- Hero `Títulos` click sets `?tab=season`
- Hero `Pts FIP` click sets `?tab=` to nothing (it leaves the page)
- Overview earnings cards set `?tab=earnings`
- The tab itself updates `?tab=` when user clicks the tab nav directly
- Back button returns to the previous tab, not the previous page

Initial tab on page load: read `?tab=` if present, else `overview`. If `?tab=earnings` but earnings are zero (tab hidden), fall through to `overview`.

Year chip on Ganhos and Temporada tabs is additionally URL-synced as `?year=`. Default: most recent year.

---

## i18n

New keys added to all 5 locale JSON files (`en`, `es`, `pt`, `it`, `fr`). Per translation-context preference, each gets a `_context` sibling or descriptive path.

```
"player": {
  "earningsTab": "Ganhos",
  "earningsTab_context": "Player profile tab heading — career prize money",
  "ganhosNewPill": "NEW",
  "ytdEarningsCard": "YTD {year}",
  "careerEarningsCard": "Carreira",
  "eventsCount": "{count, plural, one {# evento} other {# eventos}}",
  "tournamentsCount": "{count, plural, one {# torneio} other {# torneios}}",
  "noEarningsForYear": "Sem ganhos em {year}",
  "titlesCalloutLabel": "Títulos {year} · {count}",
  "wonWithPartner": "c/ {partnerName}",
  "playerNotInTop1000": "{name} não está no top 1000",
  "roundLabel": {
    "W": "Vencedor",
    "F": "Final",
    "SF": "SF",
    "QF": "QF",
    "R16": "R16",
    "R32": "R32",
    "Q1": "Q1", "Q2": "Q2", "Q3": "Q3"
  }
}
```

---

## Files touched

| File | Type | Change |
|---|---|---|
| `src/app/[locale]/player/[id]/page.tsx` | edit | Add `'earnings'` to `PageTab`; add 6th tab button (conditional); wire hero chips + Overview cards to setActiveTab / router.push; URL-sync `activeTab` to `?tab=` |
| `src/app/[locale]/player/[id]/EarningsTab.tsx` | new | Tab body — summary widgets, year chips, tournament list |
| `src/app/[locale]/player/[id]/SeasonTab.tsx` | new | Extract existing SeasonTab from page.tsx + add titles call-out + tournaments list |
| `src/app/[locale]/player/[id]/TitlesCallout.tsx` | new | Small component reused by SeasonTab |
| `src/app/[locale]/player/[id]/TournamentRow.tsx` | new | Shared row component used by both new tabs |
| `src/lib/derive-titles.ts` | new | Pure function `deriveTitles(matches, playerId)` |
| `src/lib/derive-season-tournaments.ts` | new | Pure function `deriveSeasonTournaments(matches, playerId, year)` |
| `src/app/[locale]/(app)/rankings/page.tsx` | edit | URL-sync gender + type; read `?highlight=`; load-enough logic; scroll-into-view; pulse highlight; clear param after scroll |
| `src/messages/{en,es,pt,it,fr}.json` | edit | New keys per i18n section above |

No new tests required by user instruction defaults, but pure-function derivations (`derive-titles`, `derive-season-tournaments`) get unit tests under `src/lib/__tests__/` per existing patterns (e.g. `score-inference.test.ts`).

No new migrations, crons, env vars, or external API integrations.

---

## Risks

1. **Titles count drift** — `players.titles` may not match derived count from finals due to historical data inconsistency. Mitigation: dev-only console warning, displayed counts kept as-is. Reconciliation deferred to a future backfill cron if drift is widespread.

2. **Earnings completeness** — Ganhos tab only reflects tournaments where `recompute-earnings` has resolved a prize. Older or unsupported events won't appear. Not a new gap — already true of the Overview cards today. Resolved in v2 if needed via a dedicated backfill.

3. **Rankings page render size** — the page already fetches top 1000 in one query; the deep-link only changes how many of those rows are rendered into the DOM. For a #327 highlight we render ~350 rows instead of 50, which is heavier on initial paint but no extra Supabase round-trip. Acceptable trade-off.

4. **Tab nav overflow** — 6 tabs on a 320px viewport will require horizontal scroll. The tab nav already supports this (`overflow-x: auto` per `page.tsx:773`). On the narrowest devices the rightmost 1-2 tabs may not be visible until scrolled. Acceptable for v1.

5. **`recompute-earnings` is paused via `PADELAPI_PAUSED`?** — No. The earnings cron is FIP/Premier-rulebook + manual; it does not call padelapi. It is unaffected by the kill-switch and continues to run weekly. Confirmed.

---

## Testing approach

- **Unit tests** for `derive-titles` and `derive-season-tournaments` — covering: 0 titles, 1 title, multiple titles in a year, retired finals, walkover finals, mixed-pair-side identity (player on pair1 vs pair2 in the final).
- **Manual QA cases**:
  - Player with 0 earnings: Ganhos tab hidden
  - Player with earnings only in 2024: year chips show `Tudo · 2024`, not 2025/2026
  - Player who won a title that's not in `players.titles` integer: dev console warning, both numbers visible
  - Player ranked #327: Pts FIP click loads enough rows, scrolls them to middle, pulses orange
  - Player not in top 1000: Pts FIP click shows toast, no scroll
  - Tab deep-link `?tab=earnings&year=2025` on a player with earnings — lands correctly
  - Tab deep-link `?tab=earnings` on a player with zero earnings — falls through to Overview
  - Back button from rankings (after scroll) returns to player page on the originating tab

---

## Future work (out of scope)

- Rankings deep-link from `RankingsSection` on home page
- Rankings deep-link from match cards (showing live rank of each player)
- Pro-tier "tournament drill-down" view from a Ganhos row (per-match prize, points earned)
- Charts: career earnings curve, titles-by-year bar chart
- Per-partner earnings filter on Ganhos tab
- Ranking history chart on Rankings deep-link landing (using `player_ranking_snapshots`)

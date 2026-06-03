# Tournament Data Readiness — Design

**Date:** 2026-06-03
**Status:** Approved (design); ready for implementation plan
**Scope:** 2026 events only · main tiers only (Premier Padel + Cupra FIP Tour)
**App:** `apps/ops/` (PadelNachos admin)

## Problem

The ops admin's existing tournament data-quality signals measure the **wrong layer**.

- The Tournament Explorer's four per-tournament dots (Entry List / OOP / Draw / Results) and the `/system/data-quality` tab both measure whether **padelgod captured a snapshot** — not whether that data reached the `public` tables the app actually serves from.
- The `/system/data-quality` tab is **aggregate-only** (global counts), with no per-tournament granularity.

**Concrete failure — FIP Bronze Ijuí (`fip_bronze`, 2026-04-13 → 04-19):** padelgod has full, fresh Draw + OOP + Results snapshots (443 successful scrape jobs, widget `FIP-2026-1608`), so all four explorer dots show **green** — yet `public.matches` has **0 rows** for it. The data was scraped but never populated into the table the app reads. Today this reads as "healthy"; in the app the tournament shows no matches.

## Goal

A dedicated, per-tournament **readiness view** that scores each in-scope 2026 tournament against **status- and tier-aware expectations**, measured against **what is actually present in the public tables** — and surfaces the "scraped but not populated" gap as a first-class signal. This is a **visibility** deliverable: it makes gaps legible so corrections can be planned separately. It does **not** repair data.

## Scope

**In scope (2026 only):**
- Premier Padel: `major`, `p1`, `p2`, `finals`
- Cupra FIP Tour: `fip_platinum`, `fip_gold`, `fip_silver`, `fip_bronze`

**Out of scope:**
- `fip_other` (uncategorized catch-all) and padelapi-only non-tier events
- Auto-repair / re-population of gaps (visibility only)
- Historical trend tracking & alerting (possible follow-up — see "Future")

## Assessment model

### Lifecycle stage (derived per tournament, against today)

`tournaments.status` is a coarse calendar-window signal (per the project's "Tournament-pill / live-state policy") and is not trusted. Stage is derived, evaluated in order:

1. **Completed** — `finalPlayed = true` (a final-round match has a `winner_pair`) **OR** `ends_at < today`.
2. **Ongoing** — not completed **AND** (`starts_at ≤ today ≤ ends_at` **OR** any match has status `live` / `scheduled` / `ended` / `finished`).
3. **Upcoming** — `starts_at > today` and nothing indicates play yet.

`finalPlayed` is computed exactly as the existing tournament-explorer route does (`isFinalRound(round) && winner_pair != null`).

### Dimensions & cell states

Each of the 7 dimensions resolves to one cell state: **ok** · **partial** · **missing** · **na** · **divergent**.

| Dimension | Measured from (public tables) |
|---|---|
| **Matches** | `public.matches` count > 0 for the tournament |
| **Players** | share of the 4 player-FK slots across the tournament's matches that are resolved (non-null FK, not a TBD placeholder name) |
| **OOP** | matches have `court` and/or `scheduled_at` populated |
| **Results** | finished matches carry `winner_pair` + ≥1 `sets` row |
| **Entry list** | `tournament_draws` rows / entry-list snapshot resolved to players |
| **Stats** | `match_stats` rows present — **Premier-tier only** |
| **Streams** | `fip_court_streams` (FIP) / WhereToWatch availability (Premier) |

### Status- & tier-aware expectations

Legend: ✓ required · ◑ partial acceptable · ○ optional · — N/A

| Dimension | Upcoming | Ongoing | Completed | Tier rule |
|---|---|---|---|---|
| Matches | ○ | ✓ | ✓ | — |
| Players | — | ✓ | ✓ | — |
| OOP | — | ✓ | ○ | — |
| Results | — | ◑ | ✓ (all finished) | — |
| Entry list | ✓¹ | ✓ | ○ | ¹optional while registration still open (`tournaments.registration_status`) |
| Stats | — | ✓ | ✓ | **Premier only**; FIP → always N/A |
| Streams | ○ | ◑ | — | FIP via `fip_court_streams`; Premier via WhereToWatch. **Never required** → can never push a verdict to Broken (caps at Gaps). |

### Divergence — the headline catch

For **Matches / OOP / Results**: if padelgod has a **fresh snapshot** (`padelgod.draw_snapshots` / `oop_snapshots` / `results_snapshots`) **but the corresponding public-table data is absent**, the cell is **divergent** ("scraped, not populated") — regardless of stage. This is the Ijuí signal, invisible in the current dashboards.

"Fresh snapshot" reuses the explorer's freshness notion (latest `captured_at` per tournament; the 24h threshold is for the stale/fresh visual, but for divergence what matters is *presence* of a recent snapshot paired with *absence* of public data).

### Headline verdict (roll-up; worst dimension wins)

For each dimension, compare actual cell state against its expected level for the tournament's stage/tier:

- **Broken** — any **required** (✓) dimension is **missing**, OR any cell is **divergent**.
- **Gaps** — not broken, but a required dimension is only **partial**, or an expected-optional dimension is missing/stale.
- **OK** — every required dimension satisfied (partial allowed only where the expectation is ◑); **na** dimensions are ignored.

Verdict precedence: Broken > Gaps > OK.

Exact thresholds for **partial vs ok** on quantitative dimensions (e.g. Players resolved ≥ 95% → ok, > 0% and < 95% → partial, 0% / no matches → missing; Results = all finished matches scored → ok, some → partial) are finalized in `readiness.ts` and locked by its unit tests.

## Architecture (Approach A — live computation + pure rules module)

No new tables, no worker. Recompute on each page load (cheap at ~140 tournaments).

### Data layer
**`apps/ops/src/app/api/internal/tournament-readiness/route.ts`** — auth `isOperator` (matches other `/api/internal/*` routes). Runs **set-based grouped queries** over the in-scope set (never per-tournament):

1. Base tournaments — reuse the explorer route's level/date filtering for 2026 + in-scope levels.
2. Matches rollup grouped by `tournament_id`: total count, status breakdown, `winner_pair`-set count, finished count, player-FK null/TBD counts, `court`/`scheduled_at` non-null counts.
3. `sets` presence, `match_stats` counts, `tournament_draws` presence, `fip_court_streams` presence — grouped by tournament.
4. padelgod snapshot freshness (entry / oop / draw / results) — reuse the explorer's existing `latestPerTournament` query pattern.

The matches rollup can approach the 10k PostgREST cap (~140 tournaments × dozens of matches), so it uses **`paginatedSelect`** (`@/lib/db-paginate`) per the repo's pagination policy.

Response: an array of `{ tournament metadata, stage, cells[7], verdict, divergence details }`, ready for both views.

### Rules engine (pure, testable)
**`apps/ops/src/lib/readiness.ts`** — pure function `(rollup, tier, today) → { stage, cells, verdict }`. No I/O. Holds the stage derivation, expectation matrix, divergence detection, and verdict roll-up. The route is thin glue.

**Tests:** `apps/ops/src/lib/__tests__/readiness.test.ts` (Vitest, TDD). Cover each stage × tier, the divergence/Ijuí case, the Premier-only Stats N/A rule, and verdict edges (required-missing → Broken, required-partial → Gaps, etc.).

### UI
**`apps/ops/src/app/(app)/tournament-readiness/`**
- `page.tsx` (`force-dynamic`) → `_components/ReadinessView.tsx` — shell: view toggle (List / Calendar), filters (tier / stage / verdict), group-by + sort state, KPI strip (in-scope count, Broken / Gaps / OK, "scraped not populated" count).
- `ReadinessList.tsx` — grouped table, default **group-by Tier** (toggle: Stage / Verdict-triage). Each row: headline verdict + expandable `DimensionMatrix`.
- `ReadinessCalendar.tsx` — adapts the existing `CalendarView` lane-packing. Bars **colored by verdict**, tier tag on the left, verdict dot. Month nav (‹ › + **Today**). "Sort lanes by" control (Start date default / Verdict-worst-first / Tier). Hover → per-dimension matrix.
- `types.ts` + shared `DimensionMatrix` / `ReadinessDot` components.

Built on existing ops primitives (`PageHeader`, `Panel`, `KpiStrip`, `Pill`, `DataTable`). Rail entry added under **System** (next to Data Quality).

### Theming (token-driven, light + dark)

No hardcoded hex in components. Add **semantic tokens** to `apps/ops/src/app/globals.css` under both `:root` (dark) and `:root[data-theme="light"]`:

- `--rd-ok`, `--rd-gap`, `--rd-bad`, `--rd-na` — verdict / cell states, tuned per theme for contrast.
- Divergent state reuses `--rd-bad` + a ring (no new hue).
- **Tier tag colors:** extract the existing `LEVEL_COLOR` map out of `CalendarView.tsx` into a shared constant that both calendars import (DRY), expressed through tokens so it is theme-aware.

## Defaults

- List: grouped by **Tier**.
- Calendar: sorted by **Start date**, bars colored by **verdict**.
- Both switchable at runtime.

## Future (not in this build)

- **Precomputed readiness table + worker** (Approach B) for instant loads, trend history ("when did Ijuí break?"), and alerting — would reuse `readiness.ts` unchanged.
- Course-correction tooling to re-populate "scraped, not populated" tournaments.

## Acceptance

- The view lists every in-scope 2026 tournament with a stage, 7-dimension matrix, and headline verdict, in both List and Calendar modes.
- FIP Bronze Ijuí appears as **Broken** with Matches/OOP/Results shown **divergent** ("scraped, not populated").
- Upcoming events are not penalised for empty Matches/Results; FIP tiers show Stats as **N/A**, not a gap.
- `readiness.ts` unit tests pass.
- Both themes render correctly with no hardcoded hex in the new components.

# Today → Live Odds Scoreboard — Implementation Design

**Status:** Draft for review
**Date:** 2026-06-04
**Source design:** The recovered scoreboard mockups at `docs/superpowers/mockups/live-odds-admin.html` (+ `live-odds-admin-iconrail.html`), originally specced in `docs/superpowers/specs/2026-05-30-live-odds-admin-design.md` against a **stub provider**.
**Supersedes that spec's "Phase 5 (separate track)":** the realtime data layer and app shell that were prerequisites have since shipped, so the scoreboard can now be built against **real data**.

**Builds on (existing, shipped):**
- Realtime live odds — `padelgod/src/workers/live-odds-updater.ts`, `match_live_odds` + `match_live_odds_snapshots` tables, Realtime-published. See `docs/superpowers/specs/2026-05-31-realtime-live-odds-design.md`.
- Elo model + `/odds` admin — `model_predictions` / `model_tournament_predictions`, `apps/ops/src/lib/odds-data.ts`, `LiveOddsTable`, `OddsMovementChart`, `LiveNowSection`.
- The `apps/ops` **app shell** — `AppShell`, always-dark `Rail`, `ThemeProvider`, command palette (design-system rollout, already in production).

---

## 1. Overview & scope

Replace the `apps/ops` **`/today`** page with the live-odds **scoreboard**: the operator's daily-driver view of model-computed win probabilities + fair odds for live and upcoming padel matches. Internal tool, operators only — **no external bookmaker data**.

The app shell already exists; this is a **page-content build**, ~90% presentation (the data exists). The original 2026-05-30 console built against a stub because no model existed; that's no longer true.

### In scope
- Replace `/today` route content with the scoreboard: KPI row, unified matches table (live + today's scheduled), sticky selected-match detail panel with a win-probability chart, filters, connection-state system.
- A typed **data contract** fed by a **real provider** (live `match_live_odds` via Realtime + scheduled `model_predictions`).
- Retire the `/odds` **landing** (redirect → `/today`); keep `/odds` **sub-pages**.

### Out of scope
- Operational signals currently on Today (Needs Review, OOP Pending, Today's Schedule, Requires Attention) — **removed from Today**; they remain reachable on their own Rail pages.
- The app shell (done), the Elo model, the hourly snapshot, the in-play engine, calibration.
- New web fonts (decision: keep the current ops font stack).
- `match_live_odds_snapshots` retention policy (noted, deferred).
- Detail-panel "Pin to wall" / "Share" CTAs (dropped for an internal tool).

---

## 2. Decisions (locked during brainstorming)

1. **Placement:** Today becomes the scoreboard — **full replace, odds-only**. Operational signals leave Today.
2. **Match scope:** **live + today's scheduled**, one unified table with an `All / Live / Break / Sched` filter. Live rows carry moving odds (`match_live_odds`); scheduled rows carry static pre-match Elo odds (`model_predictions`).
3. **Fidelity:** **high, phased** — reproduce the mockup faithfully (odds bars, serve dots, score-flash, win-prob chart, connection states), delivered in independently-testable phases.
4. **Existing `/odds`:** **keep sub-pages, retire landing.** `/odds` redirects to `/today`. `/odds/match/[id]`, `/odds/tournament/[id]`, `/odds/calibration`, `/odds/methodology` are unchanged — the win-prob chart's "view full" deep-links to `/odds/match/[id]`.
5. **Fonts:** **keep the current ops font stack**; apply `tabular-nums` on numeric columns (odds/scores/percentages).
6. **CTAs:** drop "Pin to wall" / "Share" in v1.

---

## 3. Architecture & routing

```
/today  ──► NEW live-odds scoreboard (operator daily home)
            ├─ page.tsx (server component): fetch initial snapshot
            │     (today's matches + live odds + per-match snapshot series)
            └─ ScoreboardView (client): Supabase Realtime on match_live_odds
                  → live motion, selection, filters, connection state
/odds   ──► redirect → /today (landing retired)
/odds/match/[id], /odds/tournament/[id], /odds/calibration, /odds/methodology
        ──► UNCHANGED
```

- Renders inside the **existing AppShell** (global header + always-dark Rail). No shell work.
- The current Today pieces (`TodayLiveNow`, `TodayRequiresAttention`, `TodaySchedule`, `TodayStatusPill`, `today-aggregator.ts` / `getTodayPayload`) are **removed from the Today route**. Before deleting any file, confirm it isn't imported elsewhere; orphans are deleted, shared bits stay.
- Rail: "Today" stays the top item (now the live wall). Before deleting Today's ops sections, confirm Needs Review / OOP / Schedule are each still reachable from the Rail.

---

## 4. Data layer

One typed contract, two feeds merged. Replaces the stub provider.

- **Live rows** (`status` in `live`/`break`, point-by-point flowing): `match_live_odds` via Realtime (reuse the `LiveNowSection` island pattern), joined to match/player/tournament display fields.
- **Scheduled rows** (today, upcoming): `getMatchOddsForDay()` (`model_predictions`), already in `odds-data.ts`.

### Contract → real source mapping

| Contract field | Real source |
|---|---|
| pair names | `players.name` → `playerShortName` (last-token, matches the rest of the UI) |
| gender (M/W tag) | `matches.category` |
| `serving` | latest `match_points.server_player_id` → which pair |
| court / round / tournament | `matches.court` / `round_canonical` / `tournaments.name` |
| `setScores` (current flag) | `sets` (`pair1_games`/`pair2_games`/`is_current`) |
| `gamePoints` (40-30 / AD) | current `games.game_score` (reuse `padelgod` `live-score-state.ts` parser logic on the app side) |
| `status` (Live/Break/Scheduled) | `matches.status` |
| `winProbA` / `fairOddsA`/`fairOddsB` | `match_live_odds.pair1_prob` / `*_decimal_odds` (live) · `model_predictions` (scheduled) |
| `movement15m` | `match_live_odds_snapshots`: latest − value ~15 min ago |
| `winProbHistory` | `match_live_odds_snapshots` series for the match (cap 30) |
| `confidence` | `coverage`: `live-pbp`→full, `live-coarse`→low (2 levels onto the 3-bar meter) |
| `lastUpdatedSeconds` | `now() − computed_at` |
| `drivers` (1st serve / break pts / total pts) | `match_stats` — **Premier-tier only; panel hides the block otherwise** |
| KPI: live matches | count of live `match_live_odds` rows |
| KPI: pre-match modeled | count of `model_predictions` for in-scope upcoming matches |
| KPI: biggest swing (15m) | max `|movement15m|` across the live set + that match's label |
| KPI: low coverage | count of `coverage='live-coarse'` (or unresolved anchor) |

### Data flow
Server component renders the initial snapshot (no empty flash). The client orchestrator subscribes to `match_live_odds` Realtime **plus** a ~30s self-clear poll (the pattern just added to `LiveNowSection`) so finished matches drop and KPIs recompute. The detail panel's chart pulls the selected match's `match_live_odds_snapshots` series.

### Honest gaps (graceful-degrade, not blockers)
- Driver bars exist only for Premier-tier (`match_stats` coverage scope) — hidden otherwise.
- `confidence` is 2 real levels mapped onto the mockup's 3-bar meter.
- The mockup's "42ms WebSocket latency" becomes a real **Realtime channel-status + data-freshness** heuristic, not a literal RTT.

---

## 5. Components & file structure

```
apps/ops/src/app/(app)/today/
  page.tsx                    # server component: initial snapshot → <ScoreboardView>
  scoreboard.css              # ported/adapted mockup CSS (odds bar, serve dots,
                              #   score-flash, connection states, win-prob well, @container)
  _components/
    ScoreboardView.tsx        # client orchestrator: state, selection, filters, Realtime, motion
    KpiRow.tsx                # 4 cards: live / pre-match / biggest swing / low coverage
    MatchesTable.tsx          # table shell + filter bar + connection banner + skeleton
    MatchRow.tsx              # stacked pair rows, sets·pts, odds bar, movement, conf, upd
    OddsBar.tsx               # lime-fill favorite % + fair-odds decimals
    DetailPanel.tsx           # selected match: probs + chart + drivers (no CTAs)
    WinProbChart.tsx          # SVG area+line from snapshots (Set/Match toggle)
    ConnectionBanner.tsx      # reconnecting / offline states
  _lib/
    types.ts                  # data contract (Match, Pair, LiveOddsSnapshot, ConnectionState, ...)
    scoreboard-data.ts        # server: build initial snapshot (live + scheduled merge)
    useScoreboard.ts          # client hook: Realtime + poll → matches[], kpis, connection
    movement.ts               # pure: 15m delta, biggest-swing, history-cap mapping (unit-tested)
```

**Reuse, don't duplicate:**
- Evaluate reusing/sharing `OddsMovementChart` for `WinProbChart` rather than authoring a second SVG charter.
- Generalize `LiveNowSection`'s Realtime + self-clear-poll into `useScoreboard.ts`; the old `LiveNowSection` is removed with the `/odds` landing.
- Import `getMatchOddsForDay`, `playerShortName`, and the game-score parsing logic as-is.

**Styling:** co-located `scoreboard.css` (the mockup needs `::before`/`::after`, `@keyframes`, `@container` queries — inline `CSSProperties` can't express these). Tokens already live in `globals.css`; the mockup's **color discipline holds**: lime = the only hero accent, red = LIVE / down-movement only, orange = hot swing / game points / Break.

---

## 6. Build phases (each independently testable)

1. **Scaffold + contract + server snapshot** — `types.ts`, `scoreboard-data.ts` (merge live + scheduled), `movement.ts` (pure). Today renders a static scoreboard from real server data. *Test: page loads with real numbers.*
2. **Table + odds bar + KPIs** — `MatchesTable`, `MatchRow`, `OddsBar`, `KpiRow`, filters (`All/Live/Break/Sched`, tournament/gender/tier/round). *Test: full table, filtering works.*
3. **Realtime + motion** — `useScoreboard.ts` (Realtime + self-clear poll), live prob/odds movement, score-flash, serving dots, ticking seconds-since. *Test: numbers move with live play.*
4. **Detail panel + win-prob chart** — `DetailPanel`, `WinProbChart` from snapshots (Set/Match toggle), driver bars (Premier-only, hidden otherwise), row selection. *Test: click row → chart + drivers.*
5. **Connection states + retire `/odds` landing** — `ConnectionBanner`, model pill, frozen treatment (live/reconnecting/offline from Realtime status + freshness); redirect `/odds` → `/today`; remove old Today components + `LiveNowSection`. *Test: kill worker → frozen; `/odds` redirects.*

---

## 7. Testing & risks

- **Unit:** `movement.ts` (delta/swing/history cap), KPI aggregation, contract mapping, win-prob → chart-point mapping.
- **Component:** row selection updates panel + chart; filter state; connection-state rendering (skeleton/banner/frozen); "live + scheduled" merge correctness.
- **Manual:** verify against a real live match on the local ops server (port 3004), the way `/odds` was just tested.
- **Risks:**
  1. `live-odds-updater` is flag-gated (`enableLiveOddsUpdater`, default **OFF**) — Today has no live rows until enabled; scheduled rows + clear empty states cover the gap.
  2. `match_live_odds_snapshots` has no retention yet — fine short-term, noted.
  3. Removing Today's ops signals — confirm Needs Review / OOP / Schedule remain reachable from the Rail before deleting.
  4. Shared working directory: this is new feature work — implement on a dedicated branch/worktree (per project memory) to avoid the shared `/today`/`/odds` files churning under other sessions.

---

## 8. Open items
- Whether live numbers eventually get their own calibration (vs only pre-match Elo) — unchanged from the realtime spec.
- `match_live_odds_snapshots` retention.
- Confidence: revisit if a third coverage level ever exists.

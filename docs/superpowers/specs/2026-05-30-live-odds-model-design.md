# Live Win-Probability Model & Odds Pipeline — Design

**Status:** Approved (design), pending spec review
**Date:** 2026-05-30
**Related:** [Live Odds admin console design](2026-05-30-live-odds-admin-design.md) — this builds the *real data* behind that console's typed contract (`apps/ops/src/app/(app)/live-odds/_lib/types.ts`), replacing the stub provider.

---

## 1. Overview & goal

Make the Live Odds admin console show **real, live-moving win probabilities + fair odds** for padel matches, instead of the stub feed. Probabilities are computed by a model that:
- **Anchors** to the existing ranking-based pre-match probability (`src/lib/predictions/probability.ts::computeMatchProbability`), and
- **Moves with the live score** during play via a new analytic padel-scoring in-play engine.

This is an internal operator tool — **no external bookmaker data**, not a regulated betting product. Accuracy and explainability matter; the model is deterministic and unit-tested.

### Scope
- A pure **model**: pre-match prior (reused formula) + a new analytic in-play engine.
- A **pipeline**: a padelgod worker that computes odds for live + scheduled matches and stores them in two new tables.
- A **real UI provider**: a Supabase Realtime subscription that replaces the console's stub, mapping stored odds to the existing `Match` contract.

### Out of scope (later / separate)
- Serve-split per-point probabilities (v1 is serve-neutral; server data is available for a later refinement).
- An Elo/H2H rating system (we deliberately reuse the ranking prior instead).
- ML/calibrated probabilities.
- The admin-shell redesign rollout (tracked separately).

---

## 2. Decisions (locked in brainstorming)

1. **Model basis:** reuse the existing **ranking-based** `computeMatchProbability` as the pre-match prior (not Elo).
2. **Liveness:** **anchor + live in-play** — the prior is the 0–0 value; the live score moves it.
3. **In-play engine:** **analytic padel-scoring** model (exact `P(win game)→P(win set)→P(win match)`), not a heuristic blend.
4. **Defaults (accepted):** dedicated padelgod worker on a ~15s cadence (not piggybacked on the live poller); **serve-neutral** single per-point `p` in v1; KPIs aggregated **client-side** from the live odds set.

---

## 3. Architecture

```
                    ┌─ pre-match prior  (reuse computeMatchProbability: ranking → prob)
   The Model ───────┤
   (pure, tested)   └─ in-play engine  (NEW analytic padel scoring) → moving P(win match)
        │ runs inside
        ▼
   padelgod worker "odds-computer"  ──upsert──▶  public.match_odds            (latest per match)
     ~15s for live matches          ──insert──▶  public.match_odds_snapshots  (append-only history)
     + pre-match for scheduled
        │
        ▼  Supabase Realtime (postgres_changes on match_odds)
   apps/ops Live Odds console  ──  real provider replaces createStubFeed (same types.ts contract)
```

The **only writer** is the padelgod worker. The **console only reads** (Realtime). So the model lives where it computes (padelgod); the UI consumes stored numbers and never imports the model.

**Three units, clear interfaces:**
- **Model** — input: 4 player rankings + a normalized score state; output: `{ pair1WinProb, pair2WinProb, confidence }`. No I/O. Unit-tested.
- **Pipeline** — reads match state from Supabase, calls the model, writes `match_odds`(+snapshots). The only stateful/I/O unit.
- **Provider** — input: Realtime rows; output: the console's `Match`/`LiveOddsSnapshot` contract. No model logic.

---

## 4. The model (`padelgod/src/lib/odds/`)

### 4.1 Pre-match prior — reuse, don't reinvent
Mirror the **exact** formula + constants from `src/lib/predictions/probability.ts` into `padelgod/src/lib/odds/prematch.ts`, against a minimal input (the four players' `ranking` values), so padelgod doesn't import main-app code. Same pattern as the byte-identical `avatar-rehost` mirror — a header comment marks it as a mirror of the canonical file to prevent drift.
- Formula: `strength = log(1/avgRanking)` per pair; `p1 = clamp(sigmoid((s1−s2)·1.5), 0.20, 0.80)`; `p2 = 1−p1` (symmetric clamp).
- Fallback **0.5 / 0.5** unless all four players are ranked.
- Constants reused: `SCALE=1.5`, `PROB_CLAMP_MIN=0.20`, `PROB_CLAMP_MAX=0.80`.

### 4.2 Anchor → per-point probability
The prior is a **match-level** probability; the analytic engine needs a **per-point** probability `p`. Find `p` such that, at score 0–0, `P_match(p) == prior`. Since `P_match` is continuous and strictly increasing in `p`, solve by **binary search** on `p ∈ (0.5, 1)` for the favorite (and `1−p` for the underdog). Cache nothing — it's cheap.

### 4.3 In-play engine — analytic padel scoring (`padelgod/src/lib/odds/inplay.ts`)
Given the normalized score state and a per-point `p`, compute the exact match-win probability with standard recursive/closed-form formulas:
- **`pWinGame(p, a, b)`** — probability the server-neutral favorite wins a game from points `a–b`, handling **deuce** (geometric series `p²/(p²+(1−p)²)`) and **golden-point** (single deciding point at 40–40) per the tournament's rule.
- **`pWinSet(p, ga, gb, gameState)`** — recurse over games to 6 (win by 2) with a **tiebreak** at 6–6 (tiebreak modeled as a first-to-7 win-by-2 game at per-point `p`). Incorporates the current game via `pWinGame`.
- **`pWinMatch(p, sa, sb, setState)`** — best-of-3 from current sets via `pWinSet`.
- **v1 is serve-neutral** (one `p` for both sides' points). Server identity is captured for a later serve-split (`pServe`/`pReturn`).

**Normalized score state** (the engine's input, derived by the pipeline from `sets`/`games`/`match_points`):
`{ setsWon:[a,b], gamesInSet:[a,b], currentGamePoints:[a,b], inTiebreak:bool, tiebreakPoints:[a,b], goldenPoint:bool, favorite:1|2 }`.

### 4.4 Confidence
- `full` — live point-by-point flowing (current-game points present, recent `match_points`).
- `med` — live but only coarse set/game updates (no current points).
- `pre-match` — scheduled match, prior only.
- `thin` — players unranked/unresolved (prior fell back to 50/50).

---

## 5. Pipeline

### 5.1 Tables (new migrations)
- **`public.match_odds`** — latest per match. Columns: `match_id` (PK, FK→matches), `pair1_win_prob` numeric, `pair2_win_prob` numeric, `pair1_fair_odds` numeric, `pair2_fair_odds` numeric, `confidence` text (`full|med|pre-match|thin`), `model_version` text, `computed_at` timestamptz. Realtime-published. RLS: readable by anon (the console reads with anon key; values are non-sensitive), writable by service role only.
- **`public.match_odds_snapshots`** — append-only history for the chart + 15m movement. Columns: `id`, `match_id` (FK), `pair1_win_prob` numeric, `computed_at` timestamptz; index `(match_id, computed_at)`. Mirrors `player_ranking_snapshots`. Retention: prune snapshots older than the match end + a window (a small cleanup in the worker or a follow-up cron).

`fair_odds = computeMultiplier(prob)` semantics (`round(1/p, 2)`), reusing the existing inverse-probability helper's math (mirrored alongside the prior).

### 5.2 Worker `odds-computer` (`padelgod/src/workers/odds-computer.ts`)
A node-cron worker registered in `padelgod/src/scheduler.ts` (mirrors `live-poller-manager`).
- **Live pass (~every 15s):** select live matches in padelgod-covered tournaments (reuse the existing `live_source='padelgod'` + active-window gate / RPC). For each: load the four players' rankings + current score state (`sets`, `games` current, `match_points` for server/points), build the normalized state, compute prob via the model, `upsert match_odds`, `insert match_odds_snapshots`. Use `paginatedSelect` where a read can grow.
- **Pre-match pass (lower cadence, e.g. every few min):** for scheduled matches in the active window with resolved+ranked players, write the static prior with `confidence='pre-match'`.
- Standard worker conventions: service-role client, structured logging, returns a result summary (`computedLive`, `computedPreMatch`, `skipped`, `errors`).
- **Movement (15m)** is **not stored** on `match_odds`; the UI derives it from snapshots (latest vs nearest-to-15m-ago).

### 5.3 Coverage / degradation
- Moving in-play odds: `live_source='padelgod'` live matches (Premier + FIP Platinum).
- Static prior: scheduled matches with all four players resolved + ranked.
- Unranked/unresolved (amateur, names only): 50/50, `confidence='thin'` (still written so the row exists, or skipped — **written**, so the console can show it honestly).

---

## 6. UI real provider (`apps/ops/.../live-odds/_lib/`)

Replace the stub without touching the components or the `types.ts` contract:
- **`realtime-provider.ts`** — a Supabase **Realtime** subscription on `match_odds` (`postgres_changes`, `event:'*'`), joined to `matches` + `players` (for pair names, gender, tournament, court, round, set scores, current game points, status, serving) to assemble each `Match`. Initial load via a single select; subsequent updates via the channel.
- **`useLiveOdds.ts`** — swap `createStubFeed` for the realtime provider behind the **same return shape**. Connection state derives from the **Realtime channel status** (`SUBSCRIBED`→live, `CHANNEL_ERROR`/`TIMED_OUT`→reconnecting, `CLOSED`→offline) **and** `computed_at` freshness (stale if the newest `computed_at` is older than a threshold → "Model stale").
- **Chart history:** on row-select, fetch that match's `match_odds_snapshots` (ascending `computed_at`) → `winProbHistory`.
- **15m movement:** `latest.pair1_win_prob − (snapshot nearest 15m ago)`.
- **KPIs:** aggregated **client-side** from the live `match_odds` set (live count, pre-match-modeled count, biggest swing from snapshots, low-coverage count) — same `computeKpis` shape already in the console.
- `apps/ops` already shares the Supabase project; add a browser client with the anon key (read-only on `match_odds`).

The **stub stays in the repo** behind a flag/dev fallback so the env-free `/live-odds-preview` keeps working for design iteration.

---

## 7. Testing
- **Pure model (vitest, padelgod):**
  - Anchor identity: `pWinMatch(anchor(prior), 0–0 state) ≈ prior` (within tolerance).
  - Boundaries: at match point for the favorite → `≈ 1`; symmetric for the underdog.
  - Monotonicity: more sets/games/points for a side never decreases its prob.
  - Deuce + golden-point game formulas against hand-computed values; tiebreak first-to-7.
  - Prior parity: the mirrored pre-match formula matches `src/lib/predictions/__tests__/predictions/probability.test.ts` cases.
- **Pipeline:** a unit test of "score state → normalized state" extraction from sample `sets`/`games`/`match_points` rows; worker result-shape test.
- **Provider:** maps sample `match_odds` rows → `Match` contract; connection-status mapping.

---

## 8. Build phases
1. **The model** (pure, tested): `prematch.ts` (mirror) + `inplay.ts` (engine) + `anchor` + odds helper, with the full vitest suite. No I/O.
2. **Pipeline**: the two migrations + the `odds-computer` worker + scheduler entry + the score-state extractor.
3. **UI real provider**: realtime provider + `useLiveOdds` swap + snapshot-history fetch + KPI/movement wiring; keep the stub as dev fallback.

Each phase is independently shippable/testable; Phase 1 has no dependencies and can land first.

## 9. Open items
- Serve-split per-point probabilities (v1 serve-neutral) — refinement once we trust the base.
- Snapshot retention/cleanup policy (prune post-match) — simple cron or in-worker.
- Whether to expose model odds on the consumer app later (out of scope; internal only now).
- Calibration/backtesting against finished matches (future quality work).

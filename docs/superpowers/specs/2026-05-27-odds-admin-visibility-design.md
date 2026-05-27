# Odds in Admin — Design Spec

**Date:** 2026-05-27
**Status:** Approved for implementation planning
**Related:** [2026-05-27-elo-odds-model-design.md](./2026-05-27-elo-odds-model-design.md) — the model methodology this spec operationalizes
**Reference script:** [`scripts/simulate-elo-tournaments.ts`](../../../scripts/simulate-elo-tournaments.ts)

## Overview

Make the Elo + Monte Carlo odds model visible and monitorable inside `admin.padelnachos.com` (the `apps/ops/` Next.js app). Three pillars in v1:

1. **Visibility** — per-match decimal odds and per-tournament championship probabilities for ongoing and upcoming events in Premier / FIP Platinum / FIP Gold.
2. **Methodology** — an in-app page rendering the model spec so any operator can understand how the numbers are computed.
3. **Monitoring** — calibration tracking (Brier score, log-loss, favorite hit-rate) plus data-freshness signals (last snapshot, training-set size, unscored backlog).

This spec covers data model, padelgod workers, admin pages, error handling, testing, and rollout. Implementation planning happens after this spec is approved.

## Scope

### In scope (v1)

- Premier (`major`, `p1`, `p2`) + FIP Platinum + FIP Gold tournaments, **main draw only**
- Per-match snapshots written hourly for matches scheduled in the next 14 days
- Per-tournament championship snapshots written hourly for in-scope ongoing/upcoming tournaments
- 5 admin pages (Live Odds, Tournament detail, Match detail, Methodology, Calibration)
- Calibration scoring per-match (Brier + log-loss)
- Charts: tournament champion-odds movement, match per-side probability movement

### Explicitly out of scope (phase 2+)

- FIP Silver / Bronze / Beyond / Promises tournaments (model is mostly cold-start there)
- Qualifying matches
- Per-pair / tournament-outright calibration scoring (only per-match in v1)
- Backfill of predictions for historical matches (forward-only)
- External alerting (Slack, PagerDuty) — calibration page is the dashboard
- A/B testing two model versions in parallel (table supports it; no UI for it in v1)
- Public-facing / consumer surfaces (this is admin-only)

## Architecture

```
PADELGOD WORKERS (Railway)                    SUPABASE TABLES                    ADMIN APP (apps/ops/)

model-prediction-snapshot ──────hourly─────►  model_predictions                  /odds            ◄─ reads latest
  (Elo training, MC,           :25            model_tournament_predictions       /odds/tournament/[id]
   writes snapshots)                                                             /odds/match/[id]
                                                       │                         /odds/calibration
prediction-scorer  ──────every 10 minutes              │                         /odds/methodology
  (finds finished matches,    :05,:15,...              ▼
   scores against pre-match                    prediction_scores
   snapshot)
```

**Compute lives on Railway (padelgod), not Vercel.** Reasons:
- Vercel serverless functions have execution-time limits; Elo training + MC for ~10 ongoing tournaments runs 1-2 minutes
- Padelgod is already the canonical home for compute-heavy DB work (per [`AGENTS.md`](../../../AGENTS.md) and `PADELAPI_PAUSED=true` direction)
- Worker, schedule entry, and feature-flag patterns all already exist

Admin pages are pure read-layer — server components query Supabase directly. No new API routes in v1.

## 1. Data model

Three new append-only tables. No UPDATEs — the latest row per key is the current state. Same pattern as `player_ranking_snapshots` and `match_stats`.

### `model_predictions` — per-match snapshots

| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `match_id` | uuid → matches | |
| `created_at` | timestamptz | snapshot time |
| `pair1_prob` | numeric(5,4) | model's fair probability for pair 1, range [0, 1] |
| `pair2_prob` | numeric(5,4) | = 1 − pair1_prob |
| `pair1_decimal_odds` | numeric(8,3) | 1 / pair1_prob, clamped |
| `pair2_decimal_odds` | numeric(8,3) | 1 / pair2_prob, clamped |
| `pair1_team_elo` | numeric(7,2) | pair Elo at snapshot time |
| `pair2_team_elo` | numeric(7,2) | |
| `pair1_team_form` | numeric(6,2) | 30-day Elo delta |
| `pair2_team_form` | numeric(6,2) | |
| `model_version` | text | e.g. `'v0-td180-fip-prior'` |
| `training_match_count` | int | matches in training set |
| `halflife_days` | int | decay halflife at snapshot time |

**Indexes:** `(match_id, created_at DESC)`, `(created_at)`.

### `model_tournament_predictions` — per-tournament-per-pair snapshots

| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `tournament_id` | uuid → tournaments | |
| `category` | text | `'men'` \| `'women'` |
| `pair_player1_id` | uuid → players | |
| `pair_player2_id` | uuid → players | |
| `pair_seed` | int (nullable) | main-draw seed at snapshot time |
| `created_at` | timestamptz | |
| `champ_prob` | numeric(5,4) | |
| `finalist_prob` | numeric(5,4) | |
| `semi_prob` | numeric(5,4) | |
| `team_elo` | numeric(7,2) | |
| `team_form` | numeric(6,2) | |
| `entry_round` | text | `'R32'` \| `'R16'` \| `'QF'` \| ... |
| `model_version` | text | |
| `mc_runs` | int | iterations used |
| `halflife_days` | int | |

**Indexes:** `(tournament_id, category, created_at DESC)`, `(created_at)`.

### `prediction_scores` — calibration

One row per match. Written **after** the match finishes by the scorer worker.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `prediction_id` | uuid → model_predictions | the snapshot we scored |
| `match_id` | uuid → matches | denormalized for queries |
| `scored_at` | timestamptz | |
| `actual_winner_pair` | int | 1 or 2 |
| `predicted_prob_winner` | numeric(5,4) | probability the model assigned to the side that actually won |
| `brier_score` | numeric(6,5) | `(predicted_prob_winner − 1)²`; lower is better, perfect = 0 |
| `log_loss` | numeric(8,5) | `−ln(predicted_prob_winner)`; lower is better, perfect = 0 |
| `model_version` | text | denormalized for filtering |

**Indexes:** `(model_version, scored_at)` for rolling-window queries, **`UNIQUE(match_id)`** to enforce idempotency and prevent duplicate scoring.

### Migration file

`supabase/migrations/YYYYMMDD_create_model_prediction_tables.sql` — single migration creating all three tables, indexes, and the unique constraint.

## 2. Padelgod workers

### Shared library — `padelgod/src/lib/elo-model.ts`

Pure functions, no I/O. Exports:

- `fipPriorElo(rank: number | null): number`
- `kFactor(level: string | null): number`
- `decayWeight(ageDays: number, halflifeDays: number): number`
- `pairWinProbability(elo1: number, elo2: number): number`
- `trainElo(matches, players, tournamentLevels, asOfIso, halflifeDays): TrainResult`
- `toDecimal(p: number): number`
- `toAmerican(p: number): number`
- `toFractional(p: number): string`
- `brierScore(predictedProb: number, actualWon: 0 | 1): number`
- `logLoss(predictedProbWinner: number): number`
- `MODEL_VERSION = 'v0-td180-fip-prior'` — constant; bump on formula/K-table/halflife/prior changes

The standalone `scripts/simulate-elo-tournaments.ts` is refactored to import from this module so both surfaces use identical math.

### Worker 1 — `model-prediction-snapshot`

**File:** `padelgod/src/workers/model-prediction-snapshot.ts`
**Schedule:** `25 * * * *` (hourly at :25; offset from collisions with `:00` and `:30` slots)

**Per-run flow:**

1. Load all finished matches for training (~6,864 currently, paginated via existing helper)
2. Identify in-scope tournaments: levels in `('major','p1','p2','fip_platinum','fip_gold')` with `ends_at >= now()` OR `status IN ('live','ongoing','pending')`
3. Group tournaments by `starts_at` and train Elo once per distinct start date (cache within the run)
4. For each in-scope tournament:
   - Run `loadSurvivingPairs` (same logic as the script) — auto-detect entry round
   - Run 20k Monte Carlo
   - INSERT one row per pair into `model_tournament_predictions`
   - Find upcoming **main-draw** matches in next 14 days — `WHERE tournament_id = ? AND scheduled_at BETWEEN now() AND now() + interval '14 days' AND status IN ('scheduled','live') AND canonical_round(round_canonical, round) IN ('R32','R16','QF','SF','F')`. The `canonical_round` mapping is the same helper used by the script — it excludes `Q1`, `Q2`, `Q3`, and any unmapped round string.
   - For each match: compute per-match probability + odds + form; INSERT into `model_predictions`
5. Emit single structured summary log: `processed=N, failed=M, predictions_written=K, training_size=L, duration_ms=D`

**Idempotency:** append-only; concurrent runs produce duplicate rows that the read layer correctly ignores via `ORDER BY created_at DESC LIMIT 1`.

**Budget:** ~10s training + ~5s per tournament × 5-10 tournaments = 1-2 min per run.

**Feature flags:**
- `enableModelPredictionSnapshot` (default `false`)
- `modelPredictionSnapshotDryRun` (default `true` initially; logs intended writes without executing)

### Worker 2 — `prediction-scorer`

**File:** `padelgod/src/workers/prediction-scorer.ts`
**Schedule:** `3,13,23,33,43,53 * * * *` (every 10 minutes; offset from the snapshot worker's `:25` slot to avoid concurrent reads on `matches` and connection-pool pressure)

**Per-run flow:**

1. Find unscored finished matches:
   ```sql
   SELECT id, scheduled_at, winner_pair
   FROM matches
   WHERE status IN ('finished','retired','walkover')
     AND winner_pair IN (1, 2)
     AND finished_at > (now() - interval '7 days')
     AND NOT EXISTS (SELECT 1 FROM prediction_scores WHERE match_id = matches.id)
   ```
2. For each unscored match:
   - `SELECT * FROM model_predictions WHERE match_id = ? AND created_at < matches.scheduled_at ORDER BY created_at DESC LIMIT 1`
   - If no pre-match snapshot: log `skipped_no_snapshot` and continue (not an error — expected for matches that finished before snapshot worker was online or within the first hour)
   - Else: compute `predicted_prob_winner` based on `winner_pair`, compute `brier_score` and `log_loss`, INSERT into `prediction_scores` with `ON CONFLICT (match_id) DO NOTHING`
3. Emit summary log: `scored=N, skipped_no_snapshot=M, errors=K, duration_ms=D`

**7-day window rationale:** prevents the first run from scanning all 7,000+ historical matches looking for predictions that don't exist. A scorer outage of >7 days would already be flagged by other monitoring.

**Edge cases:**
- `predicted_prob_winner` rounds to 0 (defensive — should be impossible): clamp to `1e-6` to avoid `log_loss = +Infinity`
- Walkover / retired: score normally (winner is known)
- Concurrent runs: unique constraint + `ON CONFLICT DO NOTHING` makes this safe

**Feature flag:** `enablePredictionScorer` (default `false`)

### Scheduler wiring — `padelgod/src/scheduler.ts`

Two new imports, two new entries in `SchedulerFlags`, two new entries in the schedule array. Existing patterns mirrored.

## 3. Admin app pages

### Nav placement — new sidebar group

```
Today
Tournament Ops
  Tournament Explorer
  Entry Lists
  Needs Review
  Simulator
Model & Odds              ← new group
  Live Odds
  Methodology
  Calibration
Catalogs
  ...
```

Added to `apps/ops/src/components/Sidebar.tsx`'s `NAV_GROUPS` constant.

### URL structure

```
/odds                          # Live Odds — landing
/odds/tournament/[id]          # Tournament detail
/odds/match/[id]               # Match detail
/odds/methodology              # Methodology
/odds/calibration              # Calibration dashboard
```

All server components, all `force-dynamic`, same pattern as `/today`.

### Page 1 — `/odds` (Live Odds landing)

**Section A — Today's matches**
- Date picker (default: today)
- Filter chips: All / Premier / FIP Platinum / FIP Gold
- Table columns: time, court, category, round, pair1 (seed + names + prob + decimal + form), pair2 (same), `model_version`, snapshot age
- Row tint by status (`live` = orange, `finished` = muted)
- Row click → `/odds/match/[id]`

**Section B — Tournament outlooks**
- Card per in-scope ongoing tournament
- Card shows: top 4 pairs by champ% with `champ% / final% / semi%`, current entry round, snapshot age
- Card click → `/odds/tournament/[id]`

### Page 2 — `/odds/tournament/[id]` (Tournament detail)

- **Header strip:** name, level, dates, status, entry round, latest snapshot timestamp, training set size at that snapshot
- **Tabs:** Men / Women
- **Within each tab:**
  1. Full pair table — all alive pairs sorted by champ%, with seed, names, Elo, form, champ%, final%, semi%, decimal + American odds
  2. Upcoming matches list (same row format as Page 1)
  3. **Champion odds history chart** — line per top-8 pair, x-axis = `created_at` snapshots since draw release, y-axis = champ%. Sparse early in deploy, fills in with snapshot accumulation.

### Page 3 — `/odds/match/[id]` (Match detail)

- **Header:** tournament, round, court, scheduled time, status
- **Pair cards (side-by-side):** for each pair — names, FIP rankings, pair Elo, 30-day form, current probability, decimal + American odds. Favorite highlighted.
- **Odds movement chart:** line of `pair1_prob` across all snapshots for this match
- **Post-match block (when `status='finished'`):**
  - Actual winner banner
  - Predicted prob for winning side, Brier score, log-loss
  - Comparison to that day's median Brier across in-scope matches

### Page 4 — `/odds/methodology`

Server-side fetch of `docs/superpowers/specs/2026-05-27-elo-odds-model-design.md`, rendered via a markdown component. Single source of truth — editing the spec updates the page. Upgrade to interactive TSX version is a phase-2 option if hover tooltips / calculators add value.

### Page 5 — `/odds/calibration` (Monitoring)

**Top — KPI cards (4):**
- Matches scored (all-time / last 30 days)
- Mean Brier score (lower is better; 0.25 = coin-flip baseline)
- Mean log-loss (0.69 = coin-flip baseline)
- Favorite hit-rate (% of matches where the model's higher-prob side actually won)

**Mid — Breakdowns:**
- Per-tier table: Major / P1 / P2 / Platinum / Gold — Brier, log-loss, hit-rate
- Per-tournament table: last 10 tournaments — Brier, log-loss, # scored, was model favorite the champion?

**Bottom — Data freshness panel:**
- Latest snapshot timestamp per worker (chip color: green ≤ 90min, yellow ≤ 3h, red > 3h)
- Training match count in latest snapshot (chip: red if delta > 10% drop run-to-run)
- Unscored finished matches in last 7 days (chip: red if > 5)
- Current `model_version`
- Mean Brier last 30d (chip: red if > 0.25)
- Favorite hit-rate last 30d (chip: red if < 50%)

These colored chips function as implicit alarms — operators visiting the page see issues immediately. No separate alerting pipeline in v1.

### Component decomposition

`apps/ops/src/components/Odds/`:
- `LiveOddsTable.tsx` — match-list table for Pages 1 and 2
- `TournamentOutlookCard.tsx` — card for Page 1 Section B
- `PairOddsRow.tsx` — single-pair display, reused across pages
- `OddsMovementChart.tsx` — line chart, reused for tournament and match detail
- `CalibrationKpiStrip.tsx` — Page 5 top
- `CalibrationBreakdownTable.tsx` — Page 5 middle
- `ModelFreshnessPanel.tsx` — Page 5 bottom
- `MethodologyMarkdown.tsx` — Page 4 renderer

Each takes plain TypeScript props; no shared global state.

### Data access

All pages query Supabase directly through the existing `apps/ops/src/lib/supabase.ts` client. No new API routes. The handful of queries needed:

- `/odds`: latest snapshot per match for today's in-scope matches; latest top-N champ% per in-scope tournament
- `/odds/tournament/[id]`: latest per-pair tournament prediction; latest per-match prediction for upcoming matches; all tournament-prediction history for chart
- `/odds/match/[id]`: latest match prediction; all match-prediction history for chart; `prediction_scores` row if exists
- `/odds/calibration`: aggregate over `prediction_scores`; latest row from each worker's output for freshness; row count from query 1's `created_at` filter for backlog

## 4. Error handling and edge cases

### Worker failures

| Scenario | Handling |
|---|---|
| Training-data fetch fails (DB down) | Bail entire run, structured error log; next hour retries |
| One tournament's MC throws | Per-tournament try/catch; log with `tournament_id`, continue |
| Tournament has <2 alive pairs | Skip with `info` log ("not yet at MC-ready state") |
| Match has TBD player IDs | Skip silently |
| Tournament has no in-scope matches in next 14d | Skip silently |
| Scorer: no pre-match snapshot | Increment `skipped_no_snapshot`, continue — not an error |
| Scorer: unique-constraint violation | `ON CONFLICT DO NOTHING`, continue silently |
| Scorer: `predicted_prob_winner` rounds to 0 | Clamp to `1e-6`, log warning |

### Admin page empty states

| State | UI |
|---|---|
| No snapshots in DB (fresh deploy) | "Model snapshots not yet available. First run scheduled at HH:25." + link to `/system/padelgod-health` |
| `/odds` no in-scope matches today | "No in-scope matches scheduled today" + render Section B |
| Out-of-scope tournament/match detail | "This is below our v1 scope (Premier + FIP Platinum + FIP Gold only)" |
| Non-existent match/tournament ID | Standard 404 |
| Chart with <2 snapshots | "Insufficient snapshot history. Check back after a few hourly snapshots accumulate." |
| Calibration page, no scored matches yet | KPI cards show "—"; tables show "No scored matches yet"; freshness panel still renders |

### Race conditions and idempotency

- **Snapshot worker:** fully append-only; concurrent runs produce duplicate rows; read layer uses `ORDER BY created_at DESC LIMIT 1` and is unaffected
- **Scorer worker:** `prediction_scores.match_id` is UNIQUE; `INSERT ... ON CONFLICT (match_id) DO NOTHING`
- **Match finishes during snapshot run:** snapshot's `created_at` may end up after match's `scheduled_at`; scorer's `WHERE created_at < scheduled_at` correctly excludes it and uses the previous snapshot

### Model versioning

`model_version` text column on every snapshot row. Constant in `padelgod/src/lib/elo-model.ts`. Bump on any change to: K-factor table, halflife, prior formula, MC algorithm, or when adding form-to-probability. Calibration queries filter by `model_version` to compare apples to apples.

### Re-scoring after a math fix

If a bug in the scoring math is found, the `UNIQUE(match_id)` constraint on `prediction_scores` prevents re-writing the score for an already-scored match. Recovery path: delete the affected `prediction_scores` rows (`WHERE model_version = '<broken_version>'` or by date range), re-deploy the fix, and the scorer will re-pick them up on its next run (they'll be unscored again). Out of v1 scope as automation; documented here as the operational procedure.

### Observability

The calibration page is the observability surface. Six chips render across the bottom freshness panel covering: snapshot age, training drift, unscored backlog, Brier health, hit-rate health, and current model version. Colors (green/yellow/red) function as implicit alarms. No separate Slack/PagerDuty in v1.

## 5. Testing strategy

### Layer 1 — Pure math (vitest)

`padelgod/src/lib/__tests__/elo-model.test.ts` — ~12 assertions covering `fipPriorElo`, `kFactor`, `decayWeight`, `pairWinProbability`, `toDecimal`, `toAmerican`, `brierScore`, `logLoss`, including boundary cases (rank=1, unranked, equal Elos, `logLoss` near 0).

### Layer 2 — Worker integration (vitest with seeded Supabase)

`padelgod/src/workers/__tests__/model-prediction-snapshot.test.ts`:
- Seed 1 in-scope tournament + 4 alive pairs + 2 upcoming matches + 50 finished matches → run worker → assert rows written with sensible values
- Out-of-scope tournament → no rows written
- TBD-pair match → silently skipped, no error
- Dry-run flag → zero writes

`padelgod/src/workers/__tests__/prediction-scorer.test.ts`:
- Seed finished match + pre-match snapshot → run → assert `prediction_scores` row with correct math
- Run twice → assert no duplicate (idempotency)
- Finished match without snapshot → assert `skipped_no_snapshot` counter, no row, no error
- Walkover match → assert scored normally
- Match outside 7-day window → excluded

### Layer 3 — Admin pages (smoke tests)

`apps/ops/tests/odds/*.test.tsx`:
- Each page renders without error given seeded snapshots
- `/odds/calibration` KPI math matches expected from seeded `prediction_scores`
- Empty-state cases render the right message

Visual regression and full-component snapshot tests are deliberately out of scope.

## 6. Rollout plan

Five independently shippable phases.

### Phase 1 — Foundation (PR 1, ~2 hrs)

1. Supabase migration creating the 3 tables + indexes + unique constraint
2. New module `padelgod/src/lib/elo-model.ts` with all pure math
3. Refactor `scripts/simulate-elo-tournaments.ts` to import from the lib
4. Diff script output before/after — must be byte-identical
5. Vitest tests for the lib

**Risk:** near-zero (pure refactor + idle tables)

### Phase 2 — Snapshot worker in dry-run (PR 2, ~4 hrs)

1. `padelgod/src/workers/model-prediction-snapshot.ts`
2. Scheduler entry with `enableModelPredictionSnapshot=false`
3. Worker integration tests
4. Ship → flip flag to `true` with `modelPredictionSnapshotDryRun=true` in Railway env
5. Watch logs 24h, cross-check against standalone script output

**Risk:** low (no writes happen)

### Phase 3 — Enable writes + scorer worker (PR 3, ~3 hrs)

1. `padelgod/src/workers/prediction-scorer.ts`
2. Scheduler entry, flag off
3. Worker integration tests
4. Ship → flip `modelPredictionSnapshotDryRun=false` → rows accumulate
5. Wait 4-8 hours for first batch
6. Flip `enablePredictionScorer=true` → wait for first finished in-scope match → verify first `prediction_scores` row

**Risk:** moderate (first writes to new tables; append-only mitigates)

### Phase 4 — Admin pages without charts (PR 4, ~6 hrs)

1. `/odds`, `/odds/tournament/[id]`, `/odds/match/[id]`, `/odds/calibration` text-only
2. New `Model & Odds` sidebar group
3. Smoke tests
4. Ship

**Risk:** zero (read-only)

### Phase 5 — Charts + methodology (PR 5, ~3 hrs)

1. `OddsMovementChart` component
2. Wire into tournament + match detail
3. `/odds/methodology` markdown renderer
4. Ship

**Risk:** zero

**Total estimated effort: ~18 hours / ~2.5 dev days.** Pausable at any phase boundary.

### Rollback story

| Action | Effect |
|---|---|
| Flip `enableModelPredictionSnapshot=false` | Snapshot writes stop. Existing data stays. |
| Flip `enablePredictionScorer=false` | Scoring stops. Existing data stays. |
| Remove `Model & Odds` from sidebar | Pages hidden. Data intact. |
| Drop the 3 tables | Clean — no FKs from other tables reference them. |

The standalone script keeps working throughout — it doesn't depend on the new tables or workers.

## 7. Acceptance criteria

A v1 ship is "done" when:

1. The 3 new tables exist with correct schema, indexes, and the unique constraint on `prediction_scores.match_id`
2. `model-prediction-snapshot` runs hourly in Railway and writes rows for every in-scope tournament and upcoming match
3. `prediction-scorer` runs every 10 minutes and writes a `prediction_scores` row for every finished in-scope match that has a pre-match snapshot
4. All 5 admin pages render correctly under all empty-state and populated-state cases
5. The Live Odds page reflects the same numbers the standalone script produces (within Monte Carlo noise — same model version, same training data)
6. The Calibration page shows non-`—` KPIs within 48 hours of going live (after at least one in-scope match has been played and scored)
7. The data freshness panel shows green chips for snapshot age, training size, and unscored backlog under normal operation
8. Methodology page renders the spec markdown without broken layout
9. All tests pass

## Glossary

See [2026-05-27-elo-odds-model-design.md §13](./2026-05-27-elo-odds-model-design.md) for definitions of: Elo, pair Elo, K-factor, time decay, form, fair probability, implied probability, vig / overround / juice, value pick, decimal odds, fractional odds, American odds / moneyline.

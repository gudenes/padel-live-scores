# Padelgod Shadow Mode — Design

**Date:** 2026-04-20
**Status:** Approved (design phase complete)
**Owner:** Gustavo Denes
**Context:** Phase 1 of the migration phasing in `2026-04-20-padelgod-design.md` §6. Deferred during Plan 4 execution; now the next step.

---

## 1. Goal

Validate Padelgod against the existing padelapi.org pipeline on real tournaments, without risking production score data, by running Padelgod in **shadow mode** — it polls, parses, and records its output to a parallel set of tables while the canonical write path remains untouched. A new ops dashboard tab compares the two pipelines and surfaces ship/no-ship signals for per-tournament cutover.

### Why now

Plan 4 shipped per-tournament cutover (`live_source='padelgod'`) and validated end-to-end correctness on Brussels P2 via a single manual smoke test. That's not enough evidence to start cutting over more tournaments. The design spec explicitly calls for 2–4 weeks of shadow validation before broadening cutover; we're now building that validation layer.

### Non-goals (V1)

- **Alerting / push notifications.** Dashboard is polled, not pushed. Easy to add later.
- **Time-series charts.** Aggregate numbers and raw tables only.
- **Bulk enroll.** Per-tournament enrollment via UI button. Intentional.
- **Comparison of data Padelgod captures that padelapi never does** (e.g., `server_player_id` — the relay does not write this). Per-point sequences compare only when both sides have data.
- **Automated cutover.** Cutover is a UI button gated on criteria; a human clicks it.

---

## 2. Scope

### In scope

- `shadow_enabled BOOLEAN` flag on `public.tournaments` + supporting RPC to surface enrolled tournaments to the live-poller-manager.
- Shadow write path: Padelgod's existing `LivePollerLoop` + `applyDiff` gain a `mode: 'canonical' | 'shadow'` parameter that routes writes to `padelgod.shadow_*` tables when shadow.
- Two shadow tables: `padelgod.shadow_sets`, `padelgod.shadow_match_points`. Deliberately no `shadow_games` (not part of comparison surface) and no `shadow_matches` (the live poller does not emit `winner_pair` / `status='finished'`; we derive the shadow winner from `shadow_sets` set scores when we need it).
- One comparison results table: `padelgod.shadow_diff` (three `comparison_type` values: `final_state`, `live_latency`, `per_point_sequence`).
- Two new Padelgod workers:
  - `shadow-diff-finalizer` — runs final-state + per-point comparison on newly-finished matches
  - `shadow-diff-live` — snapshots live-latency delta per live match per minute
- New ops dashboard tab "Padelgod Shadow" in the main Next.js app with health cards, enrollment table, per-tournament drilldown, and a cutover-to-padelgod action button gated on pass/fail criteria.

### Out of scope

- Playwright fallback for `widget-code-lookup` (Plan 4.5 / 5). Shadow mode only covers tournaments that already have a cached widget code.
- Plan 7 (full cutover + relay retirement) — this spec enables the incremental per-tournament cutovers that precede it.
- Plan 6 (articles + YouTube migration) — unrelated.
- Break-point / set-point / match-point / golden-point flag detection on `match_points` — V1 gap from Plan 4.

### Starting posture

Before shipping, revert Brussels P2 from `live_source='padelgod'` back to `'padelapi'`. From that point until cutover is re-initiated through the new UI, Padelgod has zero canonical write responsibility in production.

---

## 3. Architecture

### 3.1 Enrollment model

One new column:

```sql
ALTER TABLE public.tournaments
  ADD COLUMN shadow_enabled BOOLEAN NOT NULL DEFAULT false;
```

Semantics, orthogonal to `live_source`:

| `live_source` | `shadow_enabled` | Relay writes | Padelgod writes |
|---|---|---|---|
| `padelapi` (default) | `false` | `public.*` (canonical) | nothing |
| `padelapi` | `true` | `public.*` (canonical) | `padelgod.shadow_*` (shadow) |
| `padelgod` | any | nothing (relay gate filters it out) | `public.*` (canonical) |

Enrollment = a human flipping `shadow_enabled=true` via the ops UI button. Unenrollment = flipping it back.

Cutover (the happy path after successful shadow validation) is a separate UI action: flip `live_source='padelgod'` AND `shadow_enabled=false` atomically.

### 3.2 Write path — `mode` on `LivePollerLoop`

`LivePollerLoopOptions` gets `mode: 'canonical' | 'shadow'` (default `'canonical'`). The loop's scrape / parse / diff logic is unchanged. Only the DB write target changes.

`point-reconstruction.applyDiff` gains `mode` via its opts bag. Behavior:

| Write target in canonical mode | Shadow mode |
|---|---|
| `public.sets` upsert | `padelgod.shadow_sets` upsert |
| `public.games` upsert | **skipped** (we do not shadow games) |
| `public.match_points` INSERT ON CONFLICT DO NOTHING | `padelgod.shadow_match_points` INSERT ON CONFLICT DO NOTHING |
| `UPDATE public.sets SET is_current=false WHERE ...` | skipped (shadow_sets has no is_current flag) |

Shadow writes are pure UPSERTs / INSERTs. They never update the canonical rows, and shadow tables have no foreign keys to canonical tables beyond `match_id`, so they're isolated.

### 3.3 Discovery — second RPC

The existing `padelgod_tournaments_for_live_polling()` is unchanged (returns `live_source='padelgod'` tournaments). We add:

```sql
CREATE FUNCTION padelgod_tournaments_for_shadow_polling()
RETURNS TABLE (
  tournament_id UUID,
  tournament_name TEXT,
  widget_id TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ
) AS $$
  SELECT t.id, t.name, c.widget_id, t.starts_at, t.ends_at
  FROM public.tournaments t
  INNER JOIN padelgod.widget_id_cache c
    ON c.tournament_id = t.id AND c.is_active = true
  WHERE t.shadow_enabled = true
    AND t.live_source = 'padelapi'          -- excludes cutover-mode tournaments
    AND COALESCE(t.ends_at, t.starts_at + INTERVAL '14 days') >= NOW() - INTERVAL '1 day'
    AND COALESCE(t.starts_at, NOW() - INTERVAL '7 days') <= NOW() + INTERVAL '1 day';
$$ LANGUAGE sql STABLE;
```

### 3.4 Manager reconciles BOTH RPCs

`live-poller-manager` queries both RPCs each tick:

1. Call `padelgod_tournaments_for_live_polling()` → list A (tournaments needing `mode='canonical'` loops)
2. Call `padelgod_tournaments_for_shadow_polling()` → list B (tournaments needing `mode='shadow'` loops)
3. For each row in A ∪ B: if no loop exists for `tournament_id` yet, instantiate `LivePollerLoop` with correct `mode` and `start()`
4. For any currently-running loop whose `tournament_id` is no longer in A ∪ B (unenrolled or cutover-completed), `stop()` and remove from the map

Edge cases:
- A tournament somehow in both A and B (shouldn't happen per filters): prefer canonical. If a currently-shadow loop sees the tournament has appeared in A, `stop()` + re-`start()` with the new mode. Log this transition.
- The manager's in-memory map keys stay `tournament_id` — one loop per tournament regardless of mode.

### 3.5 Relay gate stays unchanged

The relay filters on `tournaments.live_source='padelapi'`. Shadow-enrolled tournaments remain `live_source='padelapi'` (shadow_enabled is additive), so the relay keeps subscribing to them. No change to `relay/index.js`.

### 3.6 Why cron-polled comparison (not DB triggers)

The comparison engine runs as two new Padelgod workers (see §4). Alternative was a Postgres trigger firing on `public.matches.status` change. Chose workers because:
- Vitest-testable (existing pattern for other workers)
- Same logger/scrape_jobs plumbing as the rest of the service
- Easier to ship amendments without Supabase migrations
- Debuggable by `SELECT * FROM padelgod.scrape_jobs WHERE job_type LIKE 'shadow%'`

---

## 4. Comparison engine

### 4.1 `shadow-diff-finalizer` worker

**Cron:** `10,40 * * * *` (twice hourly, interleaved with `static-reconciler`)

**Responsibilities:** final-state comparison AND per-point sequence comparison. Both run together because both need the match to have finished AND benefit from the same data fetches.

**Final-state comparison flow:**

Trigger: a match exists in `public.matches` with `status='finished'`, the tournament is shadow-enrolled, and no `padelgod.shadow_diff` row of type `final_state` exists for this match yet.

For each such match:
1. Read canonical final state: `public.matches.winner_pair`, all `public.sets.set_score` + `pair1_games` + `pair2_games` ordered by `set_number`
2. Read shadow final state: all `padelgod.shadow_sets` rows for the match, ordered by `set_number`
3. **Derive** shadow winner_pair from the shadow set scores: count completed sets won by each pair (pair1 wins a set when `pair1_games > pair2_games`). Winner = team with ≥2 set wins. If shadow didn't capture enough sets to determine a winner, `padelgod_winner_pair = NULL` and `divergence_reason = 'missing_sets_in_shadow'`.
4. Compute:
   - `winner_match = (canonical.winner_pair === derived_shadow_winner)`
   - `padelapi_final_score` = canonical set scores joined by space (`"6-4 3-6 6-2"`)
   - `padelgod_final_score` = shadow set scores joined by space
   - `score_match = (arrays equal element-wise)`
   - `divergence_reason` IF any mismatch, structured:
     - `'winner_disagreement'`
     - `'set_N_score_diff'`
     - `'set_count_diff'`
     - `'missing_sets_in_shadow'`
5. INSERT one row into `padelgod.shadow_diff` with `comparison_type='final_state'`

**Per-point sequence comparison flow:**

For each match qualifying as above AND with ≥1 `padelgod.shadow_match_points` row AND no `padelgod.shadow_diff` row of type `per_point_sequence` yet:
1. Read all `shadow_match_points` rows, ordered by `(set_id ASC, game_id ASC, point_number ASC)` → sequence A (padelgod)
2. Read `public.games.points[]` arrays for the match, ordered by `(set.set_number, games.game_number)`, concatenated → sequence B (padelapi via relay)
3. Normalize each side into a canonical shape per Task 11's `PointState` semantics:
   - Padelgod `match_points.score_after` (e.g. `"15-0"`, `"Deuce"`, `"AD-40"`, `"GP"`, tiebreak `"5-3"`) → canonical `{team1, team2, kind}`
   - Padelapi points (strings like `'15:0'`, `'AD:40'`, `'40:AD'`) → same canonical form
4. Compare element-wise:
   - `padelapi_point_count` = len(B), `padelgod_point_count` = len(A)
   - `point_sequence_match = (A and B equal element-wise)`
   - If not match: `first_divergence_index` = index where they first differ, `first_divergence_detail` = human-readable string (e.g. `"set 2 game 5 point 3: padelapi=AD:40, padelgod=40-AD"`)
5. INSERT one row into `padelgod.shadow_diff` with `comparison_type='per_point_sequence'`

**Idempotent.** Each match gets at most one row per comparison_type; UNIQUE constraint enforces it.

### 4.2 `shadow-diff-live` worker

**Cron:** `*/1 * * * *` (every minute)

**Responsibilities:** capture per-minute latency snapshots while matches are in progress.

**Flow:**

1. Query tournaments with `shadow_enabled=true AND live_source='padelapi'` — those in active shadow
2. For each such tournament, find matches with `status IN ('live', 'ended')`
3. For each match, find the current set (highest non-null `set_number` in either `public.sets` or `padelgod.shadow_sets`)
4. Compute:
   - `padelapi_updated_at` = `public.sets.updated_at` for that set
   - `padelgod_updated_at` = `padelgod.shadow_sets.updated_at` for that set
   - `latency_delta_ms` = padelgod - padelapi (negative = padelgod faster)
5. INSERT one row into `padelgod.shadow_diff` with `comparison_type='live_latency'`

**Expected volume:** per tournament × 4 courts × ~8h active play = ~1,920 rows/week per enrolled tournament. Small.

---

## 5. Data model

### 5.1 Shadow tables (`padelgod` schema)

```sql
CREATE TABLE padelgod.shadow_sets (
  match_id     UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  set_number   INT NOT NULL,
  set_score    TEXT,
  pair1_games  INT,
  pair2_games  INT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (match_id, set_number)
);

CREATE TABLE padelgod.shadow_match_points (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id     UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  set_number   INT NOT NULL,
  game_number  INT NOT NULL,
  point_number INT NOT NULL,
  winner_pair  INT NOT NULL CHECK (winner_pair IN (1, 2)),
  score_after  TEXT NOT NULL,
  server_team  INT CHECK (server_team IN (1, 2)),
  is_golden_point BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (match_id, set_number, game_number, point_number)
);

CREATE INDEX idx_shadow_sets_match ON padelgod.shadow_sets (match_id);
CREATE INDEX idx_shadow_match_points_match ON padelgod.shadow_match_points (match_id);
```

Note `shadow_match_points` does NOT reference `public.sets(id)` or `public.games(id)` — the relay and padelgod can have different notions of which set_id is "set 1" if they race. Keying by `(match_id, set_number, game_number, point_number)` is parallel to padelapi's natural ordering.

### 5.2 `padelgod.shadow_diff`

```sql
CREATE TABLE padelgod.shadow_diff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  comparison_type TEXT NOT NULL CHECK (
    comparison_type IN ('final_state', 'live_latency', 'per_point_sequence')
  ),
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- final_state
  padelapi_winner_pair INT,
  padelgod_winner_pair INT,
  winner_match BOOLEAN,
  padelapi_final_score TEXT,
  padelgod_final_score TEXT,
  score_match BOOLEAN,

  -- live_latency
  padelapi_updated_at TIMESTAMPTZ,
  padelgod_updated_at TIMESTAMPTZ,
  latency_delta_ms INT,

  -- per_point_sequence
  padelapi_point_count INT,
  padelgod_point_count INT,
  point_sequence_match BOOLEAN,
  first_divergence_index INT,
  first_divergence_detail TEXT,

  -- shared
  divergence_reason TEXT
);

CREATE UNIQUE INDEX uniq_shadow_diff_final
  ON padelgod.shadow_diff (match_id)
  WHERE comparison_type = 'final_state';

CREATE UNIQUE INDEX uniq_shadow_diff_per_point
  ON padelgod.shadow_diff (match_id)
  WHERE comparison_type = 'per_point_sequence';

CREATE INDEX idx_shadow_diff_recent ON padelgod.shadow_diff (computed_at DESC);
CREATE INDEX idx_shadow_diff_by_tournament ON padelgod.shadow_diff (tournament_id, comparison_type, computed_at DESC);
```

Partial unique indexes enforce at-most-one row per comparison_type per match for the non-live types. `live_latency` rows accumulate one-per-minute per match — not uniquely constrained.

### 5.3 Retention

No retention policy in V1. Shadow tables grow unbounded during the validation window (weeks, not months). Once we've cut over and deleted the shadow pipeline (future Plan 7+), we drop the tables. If volume becomes a concern before then (unlikely — per-tournament writes are in the tens of thousands), we add a scheduled purge.

---

## 6. UI — Ops dashboard tab

### 6.1 Location + auth

New tab "Padelgod Shadow" on the existing `/ops` page. Same cookie-based auth (`ops_token` set from `CRON_SECRET`). Reads from Supabase service-key client.

### 6.2 Layout — three sections top-to-bottom

#### Section A — Health summary (top)

Seven cards, each showing a single metric with a red/green color:

| Card | Query source | Healthy threshold |
|---|---|---|
| Enrolled tournaments | `SELECT count(*) FROM tournaments WHERE shadow_enabled=true` | any |
| Live-poll success rate (24h) | `scrape_jobs WHERE job_type='tournamentlive' AND status IN ('success','error') AND started_at > NOW()-24h` → pct success | ≥ 99% |
| Unresolved names queue | `padelgod.unresolved_players WHERE status='pending'` count | ≤ 5 |
| Final-score match rate (7d) | `shadow_diff WHERE comparison_type='final_state' AND computed_at > NOW()-7d` → pct where `winner_match AND score_match` | = 100% |
| Per-point sequence match rate (7d) | `shadow_diff WHERE comparison_type='per_point_sequence' AND computed_at > NOW()-7d` → pct where `point_sequence_match` | ≥ 95% |
| Median live latency (24h) | median `latency_delta_ms` from live_latency rows in 24h | ≤ 0 (negative = padelgod faster) |
| p95 live latency (24h) | p95 of same | ≤ +3000ms |

#### Section B — Enrollment table (middle)

All tournaments in the ±1d window that have a cached widget code.

Columns: `name`, `starts_at`, `category`, `level`, `live_source`, `shadow_enabled`, `actions`.

Per-row action buttons:

- **Enroll in shadow** — visible when `shadow_enabled=false` AND `live_source='padelapi'`. Clicking `POST /api/ops/padelgod-shadow/enroll {tournament_id, action: 'enroll'}`.
- **Unenroll** — visible when `shadow_enabled=true`. Same endpoint, `action: 'unenroll'`.
- **Cutover to padelgod** — visible when `shadow_enabled=true` AND the tournament meets cutover criteria (see §6.4). Disabled otherwise. Confirmation modal: "Switch N matches to Padelgod as canonical. Rollback via Unenroll."

#### Section C — Per-tournament drilldown (bottom)

Clicking a tournament in Section B expands this section, scoped to that tournament.

**Live state panel** (visible only if tournament currently has live matches): table with one row per live match, showing:
- Match name (players)
- Current set from `public.sets` + `updated_at`
- Current set from `padelgod.shadow_sets` + `updated_at`
- Delta (ms)
- Score agreement inline (✅ / ❌)

Refreshes every 30s via SWR.

**Final-state history** (always visible): recent finished matches, newest first, limit 50:
- Match
- `winner_match` ✅/❌
- `padelapi_final_score` vs `padelgod_final_score`
- Per-point sequence: ✅ full match / 🟡 1–2 points differ / ❌ winner disagrees
- If any ❌: `first_divergence_detail` shown on expand
- In V1 we do NOT surface `suspectedMissedPoints` in the UI. It's currently log-only (Task 11 writes it to Railway stdout via `logger.warn`). For V1 debugging, grep Railway logs for `"missed points suspected"`. A future enhancement (out of scope here) adds a counter column on `padelgod.scrape_jobs` that the UI can aggregate.

Color scheme: green when everything matches, yellow when tolerance is within cutover criteria, red when a blocker metric fires.

### 6.3 API endpoints

All under `/api/ops/padelgod-shadow/`. Same auth pattern as other ops routes.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/health` | (none) | `{ enrolledCount, livePollSuccessPct, unresolvedCount, finalScoreMatchPct, perPointMatchPct, latencyMedianMs, latencyP95Ms }` |
| GET | `/enrollments` | (none) | Array of `{ tournament_id, name, starts_at, category, level, live_source, shadow_enabled, cutover_ready: boolean }` |
| POST | `/enroll` | `{ tournament_id, action: 'enroll'\|'unenroll'\|'cutover' }` | `{ ok: true, live_source, shadow_enabled }` |
| GET | `/divergences` | `?tournament_id=X&type=final_state\|live_latency\|per_point_sequence&limit=50` | Array of `shadow_diff` rows |
| GET | `/live` | `?tournament_id=X` | Array of `{ match_id, players, publicSetScore, publicUpdatedAt, shadowSetScore, shadowUpdatedAt, latencyMs, agreement: boolean }` |

### 6.4 Cutover criteria (enforced by UI)

The "Cutover to padelgod" button is disabled unless ALL of:

- Tournament has been `shadow_enabled=true` for ≥ 7 days
- ≥ 5 finished matches with a `final_state` `shadow_diff` row
- 100% of those finished matches have `winner_match=true AND score_match=true`
- ≥ 5 finished matches with a `per_point_sequence` row
- ≥ 95% of those have `point_sequence_match=true`
- Median `latency_delta_ms` over the last 7 days is ≤ +3000ms (acceptable given 6s polling cadence)
- Zero parser failures in `scrape_jobs WHERE started_at > NOW()-48h AND job_type LIKE 'tournamentlive' AND status='error'`

If any criterion fails, the button shows a tooltip explaining which ones failed.

Clicking the button fires `POST /api/ops/padelgod-shadow/enroll {tournament_id, action: 'cutover'}`, which in ONE transaction:

```sql
UPDATE public.tournaments
SET live_source='padelgod',
    shadow_enabled=false,
    updated_at=NOW()
WHERE id=$1;
```

Within 60s the manager stops the shadow loop and starts a canonical loop. Relay unsubscribes. Padelgod becomes the sole writer for that tournament.

### 6.5 What the UI explicitly does NOT have (V1)

- Time-series sparkline / chart for latency over time
- Export to CSV
- Bulk enroll / bulk cutover
- Per-point comparison viewer (the drilldown shows aggregate plus "first divergence", not the full sequence)
- Alerting / email / Slack integration
- Historical cutover log (we could reconstruct it from `tournaments.updated_at` if needed)

Each of these is a fast follow-up if requested.

---

## 7. Migrations

Three migrations shipped in one PR, applied via Supabase SQL editor before Railway+Vercel deploys the code:

- **018** — `ALTER TABLE public.tournaments ADD COLUMN shadow_enabled BOOLEAN NOT NULL DEFAULT false`.
- **019** — creates `padelgod.shadow_sets`, `padelgod.shadow_match_points`, `padelgod.shadow_diff` with indexes per §5.
- **020** — `CREATE FUNCTION padelgod_tournaments_for_shadow_polling()` RPC per §3.3.

All three are read-additive. Applying them doesn't affect any existing code path.

---

## 8. Rollout

| Step | Who | Action | Verify |
|---|---|---|---|
| 0 | You | `UPDATE tournaments SET live_source='padelapi' WHERE id='b91c4c7d-...'` | Brussels back to padelapi; relay re-subscribes within 60s |
| 1 | You | Apply migrations 018–020 in Supabase | `shadow_enabled` column exists; RPC returns 0 rows |
| 2 | Me | Merge `feat/padelgod-shadow`; Railway auto-deploys; Vercel auto-deploys | Padelgod logs show 2 new workers registered; ops dashboard shows empty "Padelgod Shadow" tab |
| 3 | You | Click "Enroll in shadow" on 1 upcoming Premier P1/P2 event | Padelgod manager logs "Started live poller (mode=shadow)" within 60s |
| 4 | Both | Monitor dashboard daily for 7 days | Health cards stay green; final_state rate = 100%; per_point rate ≥ 95% |
| 5 | You | Enroll 2–3 more tournaments | Same monitoring |
| 6 | You | After 2–3 weeks clean data, click "Cutover to padelgod" on tournament #1 | Tournament flips; relay unsubscribes; Padelgod canonical for that tournament |
| 7 | You | Incrementally cutover tournament-by-tournament | Keep dashboard open; watch for regressions |
| 8 | (future) | Plan 7: mass cutover + relay decommission | Separate spec |

---

## 9. Risk mitigation

### Rate-limit exposure to Crionet

Each shadow-enrolled tournament = one more `LivePollerLoop` = ~600 req/hr to `widget.matchscorerlive.com`. Start with 1 tournament; monitor `scrape_jobs` for 429 / 5xx patterns before expanding.

### Railway compute cost

Each additional loop adds ~2% CPU on average. Budget at 5 concurrent loops: ~10% CPU delta = +$1–3/month on Hobby plan. Within tolerance.

### Shadow writes race with canonical writes

They don't — they write to separate tables. `shadow_sets` and `public.sets` share no primary key and are never updated by both.

### Padelgod crash while shadow-enrolled doesn't affect canonical

Correct by design. If Padelgod dies, the relay keeps writing `public.*` as before; the dashboard just shows stale shadow data until Padelgod recovers.

### False positive on "divergence"

A Padelgod parse glitch that produces wrong shadow rows would show as divergence in the dashboard. That's actually the desired behavior — we want to catch it BEFORE cutover. The UI surfaces `first_divergence_detail` so operators can see whether it's a real padelgod bug or a transient poll gap.

### Cutover criteria are too lax

We can raise the `per_point_sequence` threshold from 95% → 98% once we see typical numbers. The threshold lives in the API route and can be tuned without a migration.

### Operator accidentally cuts over a tournament that shouldn't be

The confirmation modal + the "Unenroll" rollback button mitigate this. The UI button is also disabled if criteria aren't met.

---

## 10. Environment variables

Padelgod service (Railway) adds:

```
ENABLE_SHADOW_DIFF_FINALIZER=true   # default true
ENABLE_SHADOW_DIFF_LIVE=true        # default true
```

No new secrets. No changes to main app env.

---

## 11. Open questions / future work

- **Does the padelgod shadow loop need a separate log stream from the canonical one?** For V1, we differentiate by `mode` field in log output. If Railway logs get noisy, split into separate Railway services (`padelgod-canonical` vs `padelgod-shadow`) — out of V1 scope.
- **Can we detect `suspectedMissedPoints` in the UI?** Plan 4 logs it but doesn't persist to DB. A cheap add: store a per-tick count in a new column on `scrape_jobs`, then surface in the per-tournament drilldown. Deferred — can add when needed.
- **What happens to `shadow_diff` rows after cutover?** They persist as historical data. After 90 days post-cutover, either delete or archive.
- **Do we need a mobile-friendly UI?** Ops dashboard is desktop-only today; this follows that convention.
- **Should cutover be reversible within the UI after it completes?** Currently yes via "Unenroll" (which sets `live_source='padelapi'`). Could add an explicit "Rollback cutover" button for clarity.

---

## 12. Summary

Shadow mode runs Padelgod's live pipeline in parallel against the padelapi relay on tournaments we deliberately enroll, captures output to isolated `padelgod.shadow_*` tables, and surfaces pipeline correctness via a new ops dashboard tab. Human operators enroll tournaments one at a time, watch the dashboard's automatic final-state / per-point / latency metrics for 1–2 weeks, and click "Cutover to padelgod" when criteria pass. No production UI changes. No write-path impact on existing pipelines. Rollback is a single SQL UPDATE away at every step.

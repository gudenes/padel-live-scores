# Projection — full-field history & eliminated-pair journeys

**Date:** 2026-06-06
**Status:** Design — pending implementation plan
**Extends:** the Road to Trophy "Projection" feature (specs `2026-06-06-road-to-trophy-projection-design.md`; Plans A + B, shipped on `feat/road-to-trophy`).
**Surfaces:** padelnachos.com public Projection tab + the admin QA page.

## Summary

Today the projection is a *live, hourly-refreshed* snapshot of the **still-alive** pairs only: as the bracket advances, eliminated pairs are dropped and no history is kept. This change makes the projection a **complete, persistent record** of the whole event:

- **A — full field, always.** Every pair that entered the main draw stays in the table for the life of the tournament. Eliminated pairs are flagged and their road shows their **actual journey** (rounds played, real opponents, results) at champion 0%. The champion shows their completed winning road.
- **B — the journey over time.** An append-only history of each pair's champion odds lets the UI show a **sparkline** of how the title odds moved through the event (e.g. 22% → 35% after a quarterfinal win → 0% when knocked out).

## Goals

- Keep every main-draw pair viewable for the entire tournament; nobody vanishes on elimination.
- Show an eliminated pair's factual journey + an "Eliminated in <round>" badge (champion 0%).
- Show a champion's completed winning road (status `champion`).
- Record champion/finalist/semifinal odds per pair per hourly run, and surface a champion-odds sparkline on the hero.
- Keep one code path for the simulation (no separate "eliminated" synthesis).

## Non-goals

- **Full road time-travel / scrubber** (replaying the *entire* projected road at any past hour) — B stores only the champion/finalist/semifinal series, enough for a sparkline. The full-snapshot scrubber is a documented future extension (B2).
- Per-point real-time movement of the road (that's the separate `match_live_odds` layer; out of scope here).
- Calibration of the numbers (unchanged from the base feature — still framed "model estimate").
- History retention/pruning policy beyond tournament lifetime (noted as future).

## Terminology

- **Live projection** — the road, refreshed **hourly** by the worker, respecting results as rounds finish. (Distinct from the per-point `match_live_odds` layer.)
- **Decided match** — a finished/retired/walkover match with a `winner_pair`.
- **Status** — per pair: `active` (still playing), `eliminated` (lost a decided match), `champion` (won the final).

## Core approach: forced-results, full-draw simulation

Currently the engine simulates only from the **frontier** (earliest unfinished round), so eliminated pairs never appear in its output. We change the model:

**Simulate the full draw from the first main-draw round, with decided matches forced to their real winner instead of randomly sampled.** A single Monte-Carlo pass then produces, for *every* first-round pair:

- correct champion / finalist / semifinal probabilities (alive pairs project forward; eliminated pairs come out at 0 because every simulated path has them losing their decided match);
- each pair's **reach** per round and the **opponents** they met/face — for played rounds these are the *real* opponents (outcomes forced), for future rounds they're the projected distribution.

This yields A's "actual journey" with no separate code path. Performance is unaffected (~160ms for a 32-pair × 20k-run sim; we re-sim the whole bracket each run instead of the frontier — still trivial).

### Engine change (`bracket-projection.ts`)

`projectPairs` gains the ability to (a) accept the **full first-round field** (both competitors of every first-round match, so losers remain as entrants) and (b) honor **decided outcomes**: when a simulated match corresponds to a decided real match, the known winner advances deterministically (no `rng` draw). Pure, unit-tested. Existing call sites adopt the new shape; the no-results case must produce the same numbers as today.

Mechanically, the worker passes the full ordered first-round entrants plus a `decided: Map<pairKey-vs-pairKey or match identity, winnerPairKey>` (exact keying chosen in the plan); the engine consults it per simulated match.

### Status & eliminated_round derivation

Derived in the worker from the decided results (a pair that lost a decided match → `eliminated`, `eliminated_round` = that round; the final's winner → `champion`; otherwise `active`). The engine output already encodes per-round reach, which the worker cross-checks.

## Data model

### A — extend `tournament_projections`

Add two columns (migration, idempotent):
- `status text not null default 'active'` — check in (`active`, `eliminated`, `champion`).
- `eliminated_round text` — nullable (`R64`…`F`), set when `status='eliminated'`.

The worker writes the **complete field** every run (the existing delete-then-insert per `(tournament_id, category)` now includes eliminated/champion pairs). No retention logic needed — each run recomputes the whole field from current results.

### B — new `tournament_projection_snapshots`

Append-only, public-read (mirrors `match_live_odds_snapshots`):

| column | notes |
|---|---|
| `id` | bigint identity PK |
| `tournament_id`, `category` | FK + men/women |
| `pair_key` | "smallerId::largerId" |
| `champion_prob`, `finalist_prob`, `semifinal_prob` | NUMERIC(5,4) |
| `computed_at` | timestamptz default now() |

Index `(tournament_id, category, pair_key, computed_at)`. RLS: anon/auth `SELECT`; service-role writes. The worker appends one row per pair per run (right after the upsert).

## Worker (`tournament-projection-snapshot`)

Per `(tournament, category)` each run:
1. Load all main-draw matches; build the **first-round ordered field** (both competitors of every first-round match) — not the frontier.
2. Collect **decided outcomes** from all finished/retired/walkover matches.
3. Run the forced-results `projectPairs`.
4. Derive `status` + `eliminated_round` per pair from decided results.
5. **Upsert** the full field into `tournament_projections` (delete+insert per tournament/category, error-checked as today).
6. **Append** `(champion/finalist/semifinal_prob)` rows into `tournament_projection_snapshots`.

Idempotent for (5); (6) is append-only history (each hourly run adds a point). All tiers (admin QA); public reads Premier only.

## UI

### A — eliminated/champion in the Projection tab

- **Pair picker**: lists all pairs. Eliminated pairs labelled (e.g. "Out · QF"); sort active (by champion%) above eliminated.
- **Eliminated pair road**: renders the **actual journey** — the rounds they played, real opponents, and W/L — with an `eliminatedIn` badge ("Eliminated in QF") and 0% champion hero. (The road view-model already carries per-round reach + opponents; for an eliminated pair those are the factual played rounds. The existing `RoadVM`/`buildRoadVM` + the unused `eliminatedIn` i18n key are reused.)
- **Champion road**: status `champion` shows the completed winning path + a "Champions! 🏆" flourish (the existing unused `champions` string).
- The view-model gains `status` + `eliminatedRound`; the component branches on it (active = forward road as today; eliminated/champion = factual road + badge).

### B — champion-odds sparkline on the hero

- A small inline-SVG sparkline beside/under the champion % showing the pair's `champion_prob` series over `computed_at`.
- New client hook `useProjectionHistory(tournamentId, category, pairKey)` reads `tournament_projection_snapshots` (anon) for that pair, ordered by `computed_at`.
- Renders a minimal polyline (lime), no axes; honors `prefers-reduced-motion` (static). Hidden when <2 points.

### Admin QA page

Surface `status`/`eliminated_round` and (optionally) a tiny champion% trend so operators can sanity-check the full-field + history across all tiers.

## Architecture / files

**Modify:**
- `padelgod/src/lib/bracket-projection.ts` (+ tests) — forced-results, full-field simulation.
- `padelgod/src/workers/tournament-projection-snapshot.ts` (+ tests) — first-round field, decided map, status derivation, snapshot append.
- `src/lib/projection-types.ts` / `projection-view.ts` (+ tests) — `status`/`eliminated_round` in row + VM; eliminated/champion handling in `buildRoadVM`.
- `src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx` — eliminated/champion road modes; sparkline mount.
- `apps/ops/src/lib/projection-data.ts` + `/odds/projections/page.tsx` — show status.

**Create:**
- `supabase/migrations/<ts>_projection_status_columns.sql` — A columns.
- `supabase/migrations/<ts>_tournament_projection_snapshots.sql` — B table + RLS.
- `src/app/[locale]/(app)/tournaments/[id]/useProjectionHistory.ts` — B hook.
- A small `ChampionSparkline.tsx` component.

## Shipping split

- **Plan C-A** — forced-results engine + status columns + worker full-field/status + eliminated-journey UI + admin status. Independently shippable: every pair persists and shows its real journey.
- **Plan C-B** — snapshots table + worker append + `useProjectionHistory` + `ChampionSparkline`. Layers history on top.

## Edge cases

- **No results yet (pre-start, draw set):** full field, all `active`, champion odds as today (forced map empty → identical to current behavior — covered by an engine test).
- **Retired/walkover:** treated as decided (winner advances), loser → `eliminated` at that round (consistent with the base feature's `winner_pair`-based decided predicate).
- **Byes:** a bye'd pair advances with no opponent at that round (as today); not an elimination.
- **Draw not fully assigned (TBD slots):** pairs not yet known simply aren't entrants until assigned; locked/waitlist state unchanged.
- **Champion after final:** `status='champion'`, champion_prob forced to ~1; road shows the full winning path.
- **Snapshot growth:** ~170 rows/pair/week — bounded; finished-tournament pruning is a future nicety.

## Testing

- **Engine:** forced-results correctness — eliminated pair → champion 0 and reaches exactly its elimination round; a forced winner always advances; the no-decided-results case reproduces current champion odds within tolerance (seeded RNG).
- **Worker:** status/eliminated_round derivation across a mixed bracket (some rounds done); full field written (losers present); snapshot rows appended.
- **View-model:** `buildRoadVM` produces the factual journey + `status`/`eliminatedRound` for an eliminated row.
- **UI:** eliminated road + badge renders; champion flourish; sparkline hidden <2 points, draws with ≥2.
- **Local verification:** against ITALY MAJOR (has eliminated R64/R32/R16 pairs + live SF/F) — confirm an eliminated pair shows its real journey and an active pair still projects forward.

## Rollout

No new flags — extends the existing `NEXT_PUBLIC_PROJECTION_ENABLED` + worker flag. Apply the two migrations (pg driver + `DATABASE_URL`, per the repo method), ship C-A, re-run the worker (full field appears), then C-B (sparkline populates as snapshots accrue).

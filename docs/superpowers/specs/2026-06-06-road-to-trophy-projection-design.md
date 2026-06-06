# Road to Trophy — "Projection" tab design

**Date:** 2026-06-06
**Status:** Design — pending implementation plan
**Surfaces:** padelnachos.com (public, Premier-tier) + admin.padelnachos.com / `apps/ops` (all tiers, QA)

## Summary

A user-facing feature that shows a selected player/pair's **projected path through a tournament bracket** — at each remaining round: who they'll likely face, the probability of actually facing them, and their win probability against them — culminating in a **champion probability**. Numbers come from the existing Elo + Monte-Carlo model.

The canonical home is a new **"Projection" tab** (2nd tab) on the tournament detail page. A player-profile card is the primary v1 discovery entry point that deep-links into it. The same projection engine powers an admin mirror across all tiers so lower-tier quality can be validated before public exposure.

## Goals

- Let a user pick any player/pair in a tournament's main draw and see their road to the trophy.
- At each round show: likely opponent(s), "% to face" each, win % against each, and a headline champion %.
- Support a **drill-down**: tap a round to expand the 2–4 possible opponents at that round (the "probabilistic tree", on demand).
- Reuse the existing Elo Monte-Carlo model so numbers are consistent with the `/odds` admin.
- Ship the same experience to `apps/ops` across **all tiers** for parallel QA.

## Non-goals (v1)

- Calibration of the projection numbers (the model is uncalibrated; we label outputs as model estimates).
- Following-page "Roads to watch" rail and match-detail "see their road" link — both are additive v2 spokes, designed not to require rework.
- Public coverage of non-Premier tiers (FIP Bronze/Silver/Gold) — admin-only in v1.
- Live in-play movement of the projection during a match (the road refreshes on the model snapshot cadence, not per-point).

## Terminology

- **Pair / pair key** — the order-independent key `min(id)::max(id)` already used by `bracket-builder.ts`.
- **Reach probability ("% to face" / "% to reach here")** — P(a given opponent pair reaches the round where they'd meet the tracked pair), i.e. how likely the tracked pair is to actually face them there.
- **Conditional win probability** — P(tracked pair beats opponent | they meet), from `pairWinProbability`.
- **Champion probability** — P(tracked pair wins the tournament), the product of round-by-round survival, estimated by Monte-Carlo.

## UX

### Placement — hub & spokes

- **Hub (canonical home):** a new **"Projection"** tab on the tournament detail page, positioned **2nd** (Overview · **Projection** · Story · Matches · Draw). Renders the full road + drill-down. Reuses `SlidingInkTabs`, the existing tab/URL-param machinery, and the bracket data already loaded by the page.
- **Spoke (v1): player-profile card.** A "Road to trophy" `Widget` on the player Overview tab, shown when the player is in an active Premier-tier main draw (detected via `pickCurrentTournamentMatch`). Shows the champion-odds hero + next 1–2 rounds; taps through to the hub with the pair pre-selected.
- **Spokes (v2, additive):** Following-page "Roads to watch" rail; match-detail "see their road" link.

### The Projection tab

Top-to-bottom:

1. **Pair picker** — "Tracking · `<pair>` ▾". Defaults to: bookmarked player in draw → defending champion → top seed (reuses `defaultTrackedPair`). Tapping opens a picker of all pairs in the draw (men/women per the page's category toggle). This is the "user selects a player" interaction.
2. **Champion-odds hero** — "Road to the trophy · N wins to lift it 🏆" + large champion % (lime, monospace).
3. **The road** — a vertical timeline, one node per remaining round (current → Final), with a gradient spine and progress markers (live dot on the in-progress round, 🏆 on the Final). Each round shows:
   - Round label + **date** (from the tournament round schedule) + status pill (LIVE on the in-progress round).
   - The **expected opponent** pair (real photos + names), their **"% to face"**, and the tracked pair's **win %** against them (colored by confidence: lime ≳65%, gold ~50%, toward red for underdog).
   - A **tap-to-expand** affordance ("+N possible opponents · tap ›") revealing all 2–4 candidate opponents for that round, each with its own "% to reach here" + win %.
4. Rounds already played by the tracked pair show the **actual result** (real score, win/loss) instead of a projection; the road begins projecting from the next unplayed round.

### Visual system

Native tokens (from `src/app/globals.css` + `MatchCard`/`Widget`): base `#1A1A1A`, cards `rgba(255,255,255,0.03)` with chunky `clip-path` polygons (no border-radius), warm text `#EEE4CE` / muted `#6B7280`, live `#FF4655`, lime win `#7ED321`, orange/gold `#F5A623`, monospace numerics, circular overlapping avatars, `FlagImage` flags. Reuse `Avatar`, `FlagImage`, and the prediction-bar grow animation.

### Tier scope & empty/locked states

- **Public:** Projection tab appears on **Premier-tier** tournaments (`major`, `p1`, `p2`, `finals`).
  - Draw published → full road.
  - Premier tournament, draw **not yet published** → **locked + waitlist** state: "Projection opens once the main draw is set" + a "Notify me when the draw drops" CTA (reuses the push/notify + bookmark infrastructure).
  - Non-Premier tiers → tab **hidden** (no projection, no false promise).
- **Admin (`apps/ops`):** Projection view available for **all tiers**, ungated, for QA. Lives near `/odds`.

## Data & computation

### Shared projection engine (new pure module)

`projection` core lives in `padelgod/src/lib/bracket-projection.ts`, with a byte-identical mirror at `src/lib/bracket-projection.ts` for the public app (same pattern as `db-paginate.ts` / `avatar-rehost.ts`). Pure functions:

- Input: the bracket structure (from `buildBracket`), per-player Elo (from `trainElo`, with `fipPriorElo` cold-start), and the tracked pair key.
- Runs a **Monte-Carlo simulation** of the remaining draw (reusing `pairWinProbability` for each simulated match), tallying per pair:
  - champion / finalist / semifinalist probability,
  - for each future round: the **opponent distribution** (which pairs they met and how often) + **reach probability** + **conditional win probability**.
- Output: a `PairProjection` object — champion %, and per-round `{ round, reachProb, opponents: [{ pairKey, reachProb, winProbVsThem }], expectedOpponent }`.

This extends what `model-prediction-snapshot` already does (it runs the 20k-sim MC but only stores champ/finalist/semi % — **not** per-round opponent distributions, which the road needs).

### Persistence — new `tournament_projections` table

Precomputed (not on-demand — a 20k-sim MC per request is too heavy), publicly readable:

| column | notes |
|---|---|
| `tournament_id`, `category` | FK + men/women |
| `pair_key` | `min::max` |
| `pair_player_ids` | uuid[] (4) |
| `champion_prob`, `finalist_prob`, `semifinal_prob` | NUMERIC |
| `rounds` | JSONB: array of `{ round, reach_prob, opponents:[{pair_key, names, player_ids, reach_prob, win_prob}], expected_opponent_pair_key }` |
| `model_version`, `mc_runs`, `computed_at` | provenance |
| `tournament_level` | denormalized for convenience/QA filtering |

Unique on `(tournament_id, category, pair_key)`. **RLS: public read (anon), service-role write** — consistent with `match_live_odds`. (Projection data is non-sensitive.) Holds **all tiers**; the public app only queries Premier tournaments (it only renders the tab there), the admin queries everything.

### Worker

Add a projection step producing `tournament_projections` rows — either extend `model-prediction-snapshot` (it already trains Elo + runs the MC per in-scope tournament) or a sibling worker `tournament-projection-snapshot` on the same hourly cadence. Gated by a flag (default OFF), in scope for all in-scope-model tiers (so admin gets lower tiers too). Paginates writes per `db-paginate` policy. Idempotent UPSERT on the unique key.

### Read paths

- **Public app:** the tournament page reads `tournament_projections` for the tournament (anon key, RLS public read). The Projection tab consumes the mirrored pure types for rendering. No service key in the browser.
- **Admin app:** reads the same table via service key, all tiers, surfaced near `/odds`.

## Entry points & deep-linking

- New tournament URL param `?tab=projection` (+ existing category) and `&pair=<pairKey>` to pre-select a pair. `DrawTab`'s existing tracked-pair logic generalizes to read this param.
- Player card → `/tournaments/<id>?tab=projection&pair=<pairKey>&category=<men|women>`.

## Architecture / files

**New**
- `padelgod/src/lib/bracket-projection.ts` (+ mirror `src/lib/bracket-projection.ts`) — pure MC projection engine + types.
- `supabase/migrations/<ts>_tournament_projections.sql` — table + RLS + indexes + Realtime (optional).
- Projection worker (extend `model-prediction-snapshot.ts` or new `tournament-projection-snapshot.ts`) + scheduler entry + flag.
- `src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx` — hub UI (pair picker, hero, road, drill-down, locked/waitlist state).
- Player Overview "Road to trophy" `Widget` (+ deep-link).
- Admin projection surface in `apps/ops` near `/odds`.

**Reused**
- `padelgod/src/lib/elo-model.ts` — `trainElo`, `pairWinProbability`, `fipPriorElo`.
- `tournaments/[id]/bracket-builder.ts` — `buildBracket`, `tracePairPath`, `defaultTrackedPair`, `pairKeyFor`.
- `Avatar`, `FlagImage`, `SlidingInkTabs`, `Widget`, prediction-bar animation.
- `current-tournament-match.ts` — player's active tournament.
- DRAW_TIERS-style gating, tournament round schedule for dates.

## Data flow

```
hourly worker:
  for each in-scope tournament+category:
    matches(before now) → trainElo → per-player Elo
    buildBracket(remaining matches) → bracket
    MC simulate remaining draw (pairWinProbability)
      → per pair: champion% + per-round {reach, opponents, winProb}
    UPSERT tournament_projections (all tiers)

public tournament page (Premier only):
  read tournament_projections (anon, RLS public read)
  ProjectionTab: pick pair → render road from PairProjection.rounds
  tap round → expand opponents[]

admin (all tiers): read via service key, render same shape
```

## Edge cases & error handling

- **Tracked pair already eliminated:** show the road up to elimination (actual results) + "Eliminated in `<round>`" terminal state; champion % = 0.
- **Byes / walkovers / retirements:** byes advance with reach 100% / no opponent card; retirements use `winner_pair` as actual result (never re-projected).
- **Partial / unpublished draw:** if the main draw isn't fully set, fall back to locked+waitlist (public) or render only the determined portion (admin).
- **Qualifying rounds:** project main draw only in v1 (matches `tracePairPath` main-draw scope); note qualifiers as "to be determined" entrants.
- **Draw changes between snapshots:** UPSERT overwrites; stale projection rows for removed pairs are pruned per snapshot run.
- **Missing Elo / unranked players:** `fipPriorElo` cold-start; surface no special UI.
- **Stale data:** show `computed_at` freshness; if older than a threshold, soften copy ("as of <time>").

## Calibration caveat

The Elo model is **not calibrated** (only the pre-match Elo is scored, via `prediction_scores`; the MC champion odds and per-round numbers are unvalidated). Public copy frames outputs as **model estimates** ("our model gives…"), never guarantees. Admin QA across tiers is partly to build confidence before wider exposure.

## Testing

- **Pure engine unit tests** (`vitest`): deterministic MC with a seeded RNG (no `Math.random()` reliance) — known bracket → expected reach/win/champion within tolerance; bye/retirement/eliminated-pair handling; probabilities sum sanely (opponents' reach at a round ≈ tracked pair's reach to that round).
- **Snapshot worker**: idempotent UPSERT, tier scoping, pagination.
- **UI**: locked/waitlist state renders for no-draw Premier; tab hidden for non-Premier; pair picker switches roads; drill-down expand/collapse; eliminated-pair terminal state.
- **Local verification**: run the worker against a real Premier tournament, confirm the public tab renders sensible numbers (per project rule: verify previewable changes in the running app).

## Rollout

- Flags: worker flag (default OFF) + `NEXT_PUBLIC_PROJECTION_ENABLED` for the public tab. Admin surface can ship first (no public flag) to QA all tiers.
- Sequence: engine + table + worker → admin surface (QA all tiers) → public Projection tab (Premier) behind flag → player-profile card → flag on.

## Open questions / future

- Extend the live-odds layer so the projection's current-round win % moves with the live score (reuse `computeLiveProb`).
- v2 spokes: Following "Roads to watch" rail, match-detail link.
- Calibrate MC outputs once enough finished-tournament data accrues; add a projection-scoring job.
- Surface projection champion % on the existing `/odds` tournament outlook for cross-checking.

# Real-Time Live Odds — Extending the Elo `/odds` Admin

**Date:** 2026-05-31
**Status:** Draft for review (supersedes the ranking-based `2026-05-30-live-odds-model-design.md`)
**Builds on (existing, on `main`):**
- [Elo + Odds model](2026-05-27-elo-odds-model-design.md) — `padelgod/src/lib/elo-model.ts`, `model_predictions` / `model_tournament_predictions` / `prediction_scores` tables, `model-prediction-snapshot` (hourly) + `prediction-scorer` (10-min) workers.
- [Odds in Admin](2026-05-27-odds-admin-visibility-design.md) — the `/odds` admin (`Live Odds`, `Tournament`, `Match`, `Methodology`, `Calibration`) with `LiveOddsTable`, `OddsMovementChart`, etc., and the `odds-data.ts` read layer.

## 1. Goal & correction

The Elo model + `/odds` admin already compute and display **hourly pre-match** per-match win probabilities + decimal odds. The goal here is the one improvement the Elo spec itself lists as the next unlock: **make a live match's probability move with the score in real time**, surfaced in the existing `/odds` Live Odds view.

This **reuses the validated Elo model as the anchor** and adds an **analytic in-play engine** as the movement layer. It does **not** introduce a second model. (The ranking-based model + standalone console built in the prior 2026-05-30 effort are superseded — see §8 "Retire/reuse".)

### In scope
- A new **lightweight live-odds worker** (~15–30s) that, for **every live match with point-by-point coverage** (any draw/tier — see §3 anchor resolution), anchors to the best available Elo probability and moves it with the live score.
- A small **live-odds store** (current + snapshots) for the moving numbers.
- Extending the existing **`/odds` Live Odds** surface to show the live-moving numbers (Realtime), including live matches that fall outside the hourly Elo in-scope set, and `OddsMovementChart` to plot the live series.

### Coverage scope — point-by-point is the gate (not main-draw)
Deliberately **broader than the hourly Elo `/odds` scope** (which is main-draw, Premier/FIP-Platinum/FIP-Gold). Real-time movement is only possible where **point-by-point data flows**, and point-by-point in this system is itself a high-level signal (it's served for the better matches, including qualifying). So: **any live match with recent `match_points` is in scope for live odds**, regardless of draw or tier. This lets us watch the model on those high-level qualifying matches too. The pre-match (non-live) rows on `/odds` keep the existing main-draw Elo scope unchanged.

### Out of scope (separate tracks / later)
- The **visual redesign** of the `/odds` admin (the original "improve visibility" ask) — that's the scoreboard mockup work; tracked separately from this data extension.
- Serve-split per-point probabilities (v1 in-play engine is serve-neutral).
- Changing the Elo model itself, the hourly snapshot, the Monte-Carlo, or calibration.
- Consumer-facing surfaces (admin-only).

## 2. Architecture

```
EXISTING (unchanged):
  model-prediction-snapshot (hourly :25) ──► model_predictions   (Elo pre-match prob + decimal odds = ANCHOR)
  prediction-scorer (10-min)             ──► prediction_scores    (calibration)

NEW (this spec):
  live-odds-updater (~20s)                                            apps/ops /odds Live Odds
    for each LIVE in-scope match:                                       LiveOddsTable (live rows
      anchor  = latest model_predictions.pair1_prob  ───┐               update via Realtime;
      score   = sets/games/match_points (live)          │               "LIVE" treatment)
      moving  = inPlay(anchor, score)  ◄── my scoring.ts│              OddsMovementChart
      odds    = toDecimal/toAmerican (elo-model.ts)     │               (live series)
      write   ─────────────────────────────────────────┴──► match_live_odds          ──Realtime──►
                                                              match_live_odds_snapshots (movement)
```

**Why a separate worker + tables (not extend `model-prediction-snapshot`):** the Elo snapshot is hourly and heavy (training + 20k Monte-Carlo, 1–2 min). Live movement must be cheap and frequent (read one anchor row + cheap arithmetic, every ~20s). Keeping it separate keeps `model_predictions` clean (it stays the pre-match record) and avoids flooding it with high-frequency rows.

**The anchor relationship:** the live probability is *always pinned* to the Elo model — at score 0–0 the live prob equals the latest `model_predictions` prob; the live engine only redistributes from there based on the score. So "the model precision we trust" remains the source of truth; we just animate it.

## 3. The in-play engine (reuse)

Reuse, unchanged, from the prior effort (they're model-agnostic and already unit-tested):
- `ScoreState` type, `anchorPerPoint(targetProb, goldenPoint)`, `pWinGame/pWinTiebreak/pWinSetFromGames/pWinMatchFromSets/pWinMatchFav` (analytic padel scoring: deuce / golden-point / tiebreak, serve-neutral v1).
- The DB-rows → `ScoreState` extractor.

### Anchor resolution (two-tier — covers any point-by-point match)
The anchor is the **pre-match pair1 win probability**, resolved per match in priority order:
1. **Trained Elo (best):** latest `model_predictions` row for the match (`created_at DESC LIMIT 1`) → `pair1_prob`. Available for main-draw in-scope matches the hourly snapshot covers. `anchor_source='model-prediction'`.
2. **Cold-start Elo (fallback):** if no `model_predictions` row (e.g. a live **qualifying** match), compute on the fly with the existing model: `pairWinProbability(meanPriorElo(pair1), meanPriorElo(pair2))` where `meanPriorElo` averages each player's `fipPriorElo(ranking)` from `players.ranking`. No training, no I/O beyond the player rankings the worker already loads. This is the *same* cold-start the Elo model uses for unseen players, so it's consistent. `anchor_source='cold-start-elo'`.
3. **None:** if players are unranked/unresolved, fall back to 50/50 and `anchor_source='none'` (or skip) — operators see it honestly.

A later upgrade (a persisted `player_elo_snapshots` table — already a noted future item in the Elo spec §12) would let case 2 use *trained* Elo for everyone; until then cold-start is a good, model-consistent anchor for high-level qualifying matches.

**Change from the prior effort:** the anchor is no longer a ranking-logistic prior — it is the **Elo** probability (`model_predictions` or cold-start Elo). So `computeLiveProb(anchorPair1Prob, scoreState)`:
1. `favorite = anchorPair1Prob >= 0.5 ? 1 : 2`, `target = max(anchorPair1Prob, 1-anchorPair1Prob)`.
2. `p = anchorPerPoint(target, goldenPoint)`.
3. `favProb = pWinMatchFav(p, orientToFavorite(score, favorite))`.
4. `pair1LiveProb = favorite===1 ? favProb : 1-favProb`.
At 0–0 this returns exactly `anchorPair1Prob` (anchor identity — already tested).

**Odds formatting:** use `elo-model.ts` `toDecimal`/`toAmerican`/`toFractional` (drop the prior effort's `fairOdds`).

**Canonical home:** put the in-play engine in **`padelgod/src/lib/inplay-odds.ts`** (the only consumer is the worker). It imports nothing app-specific. (The duplicate `src/lib/odds/` + `padelgod/src/lib/odds/` from the prior effort are retired except the in-play math, which moves here.)

## 4. Data model (new)

Two append-only-ish tables (mirrors the existing snapshot pattern):
- **`match_live_odds`** — latest per live match (upsert on `match_id`): `match_id` (PK→matches), `pair1_prob`, `pair2_prob`, `pair1_decimal_odds`, `pair2_decimal_odds`, `anchor_source` text (`model-prediction|cold-start-elo|none`), `anchor_prediction_id` (**nullable** →model_predictions, set only when `anchor_source='model-prediction'`), `model_version` (in-play layer, e.g. `'inplay-v1'`), `coverage` text (`live-pbp|live-coarse`), `computed_at`. Realtime-published.
- **`match_live_odds_snapshots`** — append-only `(id, match_id, pair1_prob, computed_at)` + index `(match_id, computed_at desc)` — powers the live movement chart + the 15m delta.

RLS/realtime follow the existing convention: `model_predictions` is **service-role-write, admin-read, no RLS** (server components read with the ops server client). The live tables follow the same — but since the existing `/odds` pages are **server components reading directly** (not anon Realtime), see §5 for the delivery decision.

## 5. Frontend delivery (extend, don't parallel)

The existing `/odds` pages are **server components** that read Supabase directly via `odds-data.ts` (no anon client, no Realtime today). Two options for live updates:

- **(A) Realtime in the Live Odds table (recommended):** add a small **client** island that subscribes (anon key, read-only) to `match_live_odds` and renders a **"Live now"** section (above the existing scoped match list) driven entirely by `match_live_odds` joined to match/player display fields. This naturally includes live matches **outside** the main-draw in-scope set (e.g. qualifying) — it doesn't depend on the server's in-scope query at all. The existing scoped pre-match/upcoming table is unchanged (keeps the hourly Elo numbers). This reuses the prior effort's realtime provider (re-pointed at `match_live_odds`). A live match's row shows the moving prob/odds + an `anchor_source` chip (trained-Elo vs cold-start).
- **(B) Poll:** the table refetches every ~15s for live matches. Simpler, no Realtime/RLS, but choppier.

Recommendation: **(A)**, reusing the realtime-provider pattern already built, pointed at `match_live_odds`. `OddsMovementChart` gains a "live" series from `match_live_odds_snapshots`.

The **visual redesign** (scoreboard look) is intentionally decoupled: this spec makes the *numbers* live inside the existing `/odds` surface; restyling `/odds` is a separate decision/PR.

## 6. The worker — `live-odds-updater`

`padelgod/src/workers/live-odds-updater.ts`, scheduler entry ~every 20s (`*/20 * * * * *`), flag `enableLiveOddsUpdater` (default off until validated). Per run:
1. Select **all live matches with point-by-point flowing** — `status IN ('live','on_court','break')` **AND** a `match_points` row inserted in the last ~2 min (the point-by-point gate). **No tier/draw filter** (§ "Coverage scope"). Premier + FIP Platinum + any qualifying/other live match that happens to carry point-by-point all qualify.
2. **Resolve the anchor** (§3): latest `model_predictions.pair1_prob` if present (`anchor_source='model-prediction'`); else cold-start Elo from the four players' `fipPriorElo(ranking)` via `pairWinProbability` (`anchor_source='cold-start-elo'`); else 50/50 (`anchor_source='none'`).
3. Load live score (`sets`, current `games`, recent `match_points`) → `ScoreState`.
4. `computeLiveProb(anchor, score)` → `toDecimal`/`toAmerican` (elo-model) → upsert `match_live_odds` (with `anchor_source`, nullable `anchor_prediction_id`) + insert `match_live_odds_snapshots`.
5. Structured summary log (`updated`, `byAnchorSource{model,coldStart,none}`, `errors`).
Cheap: a point-by-point check + an anchor read (or rank-based compute) + a few score reads + arithmetic per match. No Elo training, no Monte-Carlo.

## 7. Coverage, versioning, testing
- **Coverage:** *any* live match with point-by-point → full live movement (`coverage='live-pbp'`); a live match flagged live but with only coarse set/game updates (no current points) → anchor shown, minimal movement (`coverage='live-coarse'`). The **anchor source** is tracked orthogonally (`model-prediction` = trained Elo for main-draw in-scope; `cold-start-elo` = rank-derived for qualifying/out-of-scope; `none` = unranked). Operators can see, e.g., a qualifying match running on a cold-start anchor — which is exactly the visibility you want.
- **Model version:** `match_live_odds.model_version='inplay-v1'`; the anchor's Elo `model_version` is preserved via `anchor_prediction_id`. Calibration of the *live* numbers is future work (the existing `prediction_scores` scores the **pre-match** Elo, unchanged).
- **Testing:** in-play engine unit tests already exist (reuse); add `computeLiveProb` anchor-identity test (0–0 ⇒ anchor); worker integration test (seed a `model_predictions` anchor + a live match + score → assert `match_live_odds` row); the live-patch client mapping test.

## 8. Retire / reuse (from the prior 2026-05-30 effort)
- **Reuse:** the analytic in-play engine (`scoring.ts` math) → move to `padelgod/src/lib/inplay-odds.ts`; `ScoreState` + the score extractor; the realtime-provider *pattern* (re-point at `match_live_odds`).
- **Retire:** the ranking `prematch.ts` model (Elo replaces it); the duplicated `src/lib/odds/` + `padelgod/src/lib/odds/`, `match_odds`/`match_odds_snapshots` tables + the `odds-computer` worker (superseded by this anchored design); the parallel `apps/ops/.../live-odds/` console + its temp `/live-odds-preview` route — the real surface is the existing `/odds` admin. (The scoreboard *visual* design is preserved as input to a possible separate `/odds` restyle.)
- These retirements happen as part of this spec's plan (the prior effort's branch isn't merged, so retiring is just "don't carry those files into the new branch").

## 9. Build phases
1. **In-play lib** in padelgod (`inplay-odds.ts`) + `computeLiveProb(anchor, score)` + extractor, unit-tested (port the existing math).
2. **Migration**: `match_live_odds` + `match_live_odds_snapshots`.
3. **Worker** `live-odds-updater` (reads Elo anchor + score → writes live odds), scheduler entry (flag-gated), integration test.
4. **Frontend**: live-patch `LiveOddsTable` via Realtime on `match_live_odds`; `OddsMovementChart` live series.
5. **(Separate track)** restyle `/odds` with the scoreboard design, if desired.

## 10. Open items
- Confirm `odds-data.ts` query shapes + `LiveOddsTable` props to slot the live-patch in cleanly (read during planning).
- Whether live numbers eventually get their own calibration (vs only pre-match Elo).
- Snapshot retention for `match_live_odds_snapshots`.
- Serve-split per-point probs (v1 serve-neutral).

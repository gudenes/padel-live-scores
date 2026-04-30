// src/lib/predictions/constants.ts
//
// Tunables for the Guacas prediction economy. See
// docs/superpowers/specs/2026-04-30-guacas-prediction-game-design.md for
// the full rationale (stake size, cap, margin-bonus shape).

/** Every pick stakes 100 guacas. Not deducted from balance — it's the
 *  unit the multiplier scales. */
export const STAKE_GUACAS = 100

/** Base multiplier cap. A 20% underdog (the floor of PROB_CLAMP_MAX_INV)
 *  hits exactly 5.00x. */
export const MULTIPLIER_CAP = 5.00

/** Floor — a coin-flip is the minimum. Never less than 1.00x. */
export const MULTIPLIER_FLOOR = 1.00

/** Flat additive bonus on the multiplier when the user nails the margin
 *  too (2-0 or 2-1). With base cap 5.00, effective cap is 5.50x. */
export const MARGIN_BONUS = 0.50

/** Probability clamp. v1 model is conservative; we don't claim more than
 *  80% confidence based on rankings alone. v2/v3 (form, Elo) may produce
 *  more extreme probabilities. */
export const PROB_CLAMP_MIN = 0.20
export const PROB_CLAMP_MAX = 0.80

/** Probability threshold for the 🔥 UPSET badge. The user picked the
 *  eventual winner AND that pair's frozen probability was at or below
 *  this value. */
export const HEAVY_UPSET_THRESHOLD = 0.25

/** Below this min number of picks per match, we hide the community-%
 *  band (avoids "1 pick = 100%" degenerate cases). Tightens later. */
export const COMMUNITY_PICKS_MIN_THRESHOLD = 10

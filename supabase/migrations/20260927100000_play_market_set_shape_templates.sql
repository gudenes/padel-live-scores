-- Two SET-SHAPE market templates: "will any set finish 6-0" and "will this
-- match go to 3 sets". The first markets on this platform that are not about
-- who wins.
--
-- ── seed_source = 'fixed', and why it had to exist ─────────────────────
--
-- Every template before these anchored its opening price on
-- `matches.pred_pair1_prob`, which predicts WHO WINS. It says nothing about
-- whether a set finishes 6-0 or whether a match reaches a decider. The
-- generator and the gate both treated a missing model probability as
-- disqualifying, so adding these templates without the `seed_source='fixed'`
-- path would have discarded every candidate with the reason "no seed price
-- available" — a clean, plausible zero that looks exactly like "nothing to do".
--
-- `params.seedProb` is therefore the anchor, and it is a MEASURED base rate,
-- not a guess: 12,148 finished matches over the twelve months to 2026-09-26,
-- restricted to matches with 2-3 recorded sets.
--
--   any set 6-0  → 0.203
--   3 sets       → 0.206
--
-- The UI labels these prices "historical", never as a model prediction — see
-- `baselineProb` in src/app/api/play/_shared.ts.
--
-- ── Gates ──────────────────────────────────────────────────────────────
--
-- Both gate on `round_canonical` (NOT the free-text `round`, which spells the
-- final at least two ways).
--
-- match.bagel is MAIN DRAW ONLY: R64…F. Qualifying draws are where blowouts
-- concentrate, so including them would price a materially different question
-- against a base rate measured across everything.
--
-- match.three_sets is narrower still — QF/SF/F. A decider market is only
-- interesting on a match fans are already watching, and the per-match and
-- daily caps in `market_limits` are the binding constraint on this product.
--
-- Neither carries a `competitiveness` band. That band exists to drop foregone
-- conclusions from WINNER markets; a fixed seed is the same constant on every
-- match, so a band would either keep every candidate or reject every one.
-- `passesGates` skips it for a candidate with no model probability.
--
-- ── Ships DISABLED ─────────────────────────────────────────────────────
--
-- Enable from Play → Templates, dry-run the generator, read the gate drops,
-- then enable for real. `max_loss_guacas` follows the existing match-scoped
-- convention (12,000 = match.winner; 40,000 is the tournament-scoped outright).

INSERT INTO market_templates
  (key, question_i18n, horizon, trigger, lock_rule, resolver_key,
   seed_source, max_loss_guacas, params, gates, enabled)
VALUES
  (
    'match.bagel',
    '{"en":"Will any set finish 6-0?",
      "es":"¿Algún set acabará 6-0?",
      "pt":"Algum set vai terminar 6-0?",
      "it":"Un set finirà 6-0?",
      "fr":"Un set se terminera-t-il 6-0 ?"}'::jsonb,
    'pre-match', 'match.scheduled', 'match_start', 'match.any_set_bagel',
    'fixed', 12000,
    -- Measured base rate, 12,148 matches / 12 months. The generator reads
    -- `seedProb` out of here; anything outside (0,1) makes the gate drop the
    -- candidate rather than seed a market at NaN.
    '{"seedProb": 0.203}'::jsonb,
    '{"rounds":["R64","R32","R16","QF","SF","F"]}'::jsonb,
    false
  ),
  (
    'match.three_sets',
    '{"en":"Will this match go to 3 sets?",
      "es":"¿Este partido llegará al tercer set?",
      "pt":"Este jogo vai ao terceiro set?",
      "it":"Questa partita andrà al terzo set?",
      "fr":"Ce match ira-t-il au troisième set ?"}'::jsonb,
    'pre-match', 'match.scheduled', 'match_start', 'match.went_to_three_sets',
    'fixed', 12000,
    '{"seedProb": 0.206}'::jsonb,
    '{"rounds":["QF","SF","F"]}'::jsonb,
    false
  );

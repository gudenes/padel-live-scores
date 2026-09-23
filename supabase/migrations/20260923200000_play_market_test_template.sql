-- A deliberately temporary template for exercising the generator against real
-- data before any Premier event is in window.
--
-- Why it exists: the two production templates gate on rounds SF+F, and between
-- Premier events there are no such matches — so a dry run correctly returns
-- zero and proves nothing about the happy path. This one gates on R16, which
-- FIP PLATINUM LYON has 9 of on 2026-09-24, all carrying a model price.
--
-- Gates chosen from the measured spread of those 9 matches (prices 0.121 …
-- 0.836): top-200 and a 0.25–0.75 band keeps 5 and drops the genuine
-- blowouts. Reuses the already-tested `match.winner_is_pair` resolver — this
-- introduces no new resolution logic, only a different eligibility window.
--
-- Ships DISABLED. Enable from Play → Templates, dry-run, then disable again.
-- Delete this template once a real Premier event is in window.

INSERT INTO market_templates
  (key, question_i18n, horizon, trigger, lock_rule, resolver_key,
   seed_source, max_loss_guacas, params, gates, enabled)
VALUES
  (
    'match.winner.test_r16',
    '{"en":"[TEST] Will {pair1} win this match?",
      "es":"[TEST] ¿Ganará {pair1} este partido?",
      "pt":"[TEST] {pair1} vai ganhar este jogo?",
      "it":"[TEST] {pair1} vincerà questa partita?",
      "fr":"[TEST] {pair1} va-t-il gagner ce match ?"}'::jsonb,
    'pre-match', 'match.scheduled', 'match_start', 'match.winner_is_pair',
    'elo', 12000, '{"pair": 1}'::jsonb,
    '{"rounds":["R16"],"minRanking":200,"competitiveness":[0.25,0.75]}'::jsonb,
    false
  );

-- Season 1 plus the two phase-1 templates.
-- Round gate SF + F — confirmed 2026-09-23. ~14 open markets per Premier
-- event, inside the 15 cap. Widening to QF later is a gates edit, not a
-- migration.

INSERT INTO market_seasons (name, starts_at, ends_at, reset_balance, status)
VALUES ('Season 1', now(), now() + interval '3 months', 10000, 'active');

INSERT INTO market_templates
  (key, question_i18n, horizon, trigger, lock_rule, resolver_key,
   seed_source, max_loss_guacas, params, gates, enabled)
VALUES
  (
    'match.winner',
    '{"en":"Will {pair1} win this match?",
      "es":"¿Ganará {pair1} este partido?",
      "pt":"{pair1} vai ganhar este jogo?",
      "it":"{pair1} vincerà questa partita?",
      "fr":"{pair1} va-t-il gagner ce match ?"}'::jsonb,
    'pre-match', 'match.scheduled', 'match_start', 'match.winner_is_pair',
    'elo', 12000, '{"pair": 1}'::jsonb,
    -- NOTE: no "dailyCap" here. `Gates.dailyCap` is declared in the type but
    -- never read by passesGates or applyCaps, so writing it would be dead
    -- config an operator could set with no effect. See the per-template cap
    -- note above Task 13 — it must be wired before phase 2 enables a second
    -- template.
    '{"rounds":["SF","F"],"minRanking":50,"competitiveness":[0.35,0.65]}'::jsonb,
    false
  ),
  (
    'tournament.outright',
    '{"en":"Will {pair1} win {tournament}?",
      "es":"¿Ganará {pair1} el {tournament}?",
      "pt":"{pair1} vai vencer o {tournament}?",
      "it":"{pair1} vincerà il {tournament}?",
      "fr":"{pair1} va-t-il remporter {tournament} ?"}'::jsonb,
    'tournament', 'draw.released', 'final_start', 'tournament.champion_is_pair',
    'projection', 40000, '{}'::jsonb,
    '{"minRanking":50}'::jsonb,
    false
  );

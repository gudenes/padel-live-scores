-- Apply after deploying tournament.pair_champion_v1 to the settlement worker.
-- Disabled until the operator enables it; adding suggestions never opens markets.
INSERT INTO public.market_templates
  (key,question_i18n,horizon,trigger,lock_rule,resolver_key,seed_source,max_loss_guacas,enabled)
VALUES
  ('editorial.champion.v1','{"en":"{question}","es":"{question}","pt":"{question}","it":"{question}","fr":"{question}"}',
   'tournament','editorial','round_first_ball','tournament.pair_champion_v1','projection',5000,false)
ON CONFLICT (key) DO NOTHING;

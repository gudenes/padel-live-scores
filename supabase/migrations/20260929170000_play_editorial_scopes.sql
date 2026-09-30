-- Editorial ranking windows and multi-event markets have no single tournament.
-- This migration adds scope support only; it does not open any markets or change access.
BEGIN;
ALTER TABLE public.markets ADD COLUMN editorial_scope text;
ALTER TABLE public.markets DROP CONSTRAINT markets_check;
ALTER TABLE public.markets ADD CONSTRAINT markets_one_scope CHECK (
  num_nonnulls(match_id, tournament_id, editorial_scope) = 1
  AND (editorial_scope IS NULL OR length(trim(editorial_scope)) > 0)
);
CREATE UNIQUE INDEX markets_one_per_editorial_scope
  ON public.markets(template_id, editorial_scope, category)
  WHERE editorial_scope IS NOT NULL;
ALTER TABLE public.market_templates DROP CONSTRAINT market_templates_lock_rule_check;
ALTER TABLE public.market_templates ADD CONSTRAINT market_templates_lock_rule_check
  CHECK (lock_rule IN ('match_start','round_first_ball','final_start','fixed_deadline'));
COMMIT;

-- Different pairs/targets/event sets may share the same result window.
-- Preserve duplicate protection using the canonical identity already used by
-- play_guard_market_insert; a date window alone is not a market identity.
BEGIN;
CREATE UNIQUE INDEX markets_one_per_editorial_contract
  ON public.markets (
    season_id, template_id, category,
    public.play_market_identity(resolver_key,resolver_params,match_id,tournament_id,editorial_scope)
  ) WHERE editorial_scope IS NOT NULL;
DROP INDEX public.markets_one_per_editorial_scope;
COMMIT;

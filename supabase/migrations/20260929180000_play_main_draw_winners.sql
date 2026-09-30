-- Expand match-day winner eligibility while preserving pricing/ranking gates.
BEGIN;
UPDATE public.market_templates
SET gates = jsonb_set(coalesce(gates, '{}'::jsonb), '{rounds}',
  '["R128","R64","R32","R16","QF","SF","F"]'::jsonb), updated_at = now()
WHERE key = 'match.winner';
-- The normal winner template now covers R16; avoid parallel test winner markets.
-- Existing markets/positions are left intact.
UPDATE public.market_templates
SET enabled = false, updated_at = now()
WHERE key = 'match.winner.test_r16';
COMMIT;

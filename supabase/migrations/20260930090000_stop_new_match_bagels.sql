-- Bagel questions are moving to separate tournament main draws.
-- Stop future per-match generation without changing existing market contracts,
-- positions, prices, or settlement rules.
UPDATE public.market_templates SET enabled = false WHERE key = 'match.bagel';

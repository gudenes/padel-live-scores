-- Supabase default privileges can grant anon/authenticated EXECUTE explicitly,
-- independently of PUBLIC. Maintenance RPCs must be worker-only in that case too.
REVOKE ALL ON FUNCTION public.claim_match_stats_candidates(uuid[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_match_stats_outcomes(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.sync_match_stats_provider_link() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.remove_deleted_match_provider_links() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.require_existing_match_provider_target() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_match_stats_candidates(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_match_stats_outcomes(jsonb) TO service_role;

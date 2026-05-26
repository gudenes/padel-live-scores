-- supabase/migrations/20260525_query_kind_ai_discovered.sql
-- Allow query_kind='ai-discovered' on news_sources.
--
-- The SuggestionsTable "Approve & Add" flow tags AI-discovery candidates
-- with query_kind='ai-discovered' to distinguish them from user submissions
-- in the Sources tab filter chip. The original CHECK constraint shipped
-- with the V1 news pipeline didn't include this value — operators hit a
-- check_violation error on approval.

ALTER TABLE public.news_sources
  DROP CONSTRAINT IF EXISTS news_sources_query_kind_check;

ALTER TABLE public.news_sources
  ADD CONSTRAINT news_sources_query_kind_check
    CHECK (query_kind = ANY (ARRAY[
      'static'::text,
      'player'::text,
      'tournament'::text,
      'brand'::text,
      'user-suggested'::text,
      'ai-discovered'::text
    ]));

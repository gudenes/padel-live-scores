-- supabase/migrations/20260612090000_match_votes_user_id.sql
-- Future-proofing for gamification: a dedicated user_id on match_votes for
-- logged-in voters, so per-user points / streaks / leaderboards join cleanly
-- to profiles. `voter_id` stays the dedup key (device id for guests, account
-- id for logged-in). Added now while the table is fresh — far cheaper than a
-- migration once it holds many rows. ON DELETE SET NULL keeps the vote counted
-- in aggregates even if the account is removed (mirrors match_ratings).
alter table public.match_votes
  add column if not exists user_id uuid references public.profiles(id) on delete set null;

create index if not exists match_votes_user_idx on public.match_votes (user_id);

comment on column public.match_votes.user_id is
  'Logged-in voter''s profiles.id (null for guest/device-only votes). For future gamification joins; voter_id remains the per-voter dedup key.';

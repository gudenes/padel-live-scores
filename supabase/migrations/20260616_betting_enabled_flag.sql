-- supabase/migrations/20260616_betting_enabled_flag.sql
-- Feature flag for the betting odds / bookmaker referral unit.
-- Ships OFF in production; ON for localhost dev so it can be exercised locally.
insert into public.feature_flags (key, enabled, enabled_local)
values ('betting_enabled', false, true)
on conflict (key) do nothing;

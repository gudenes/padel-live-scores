-- supabase/migrations/20260607100100_projection_vote_flag.sql
-- DB flag for the Projection model-agreement vote EXPERIMENT (👍/👎 under the
-- road's prediction). Independent of projection_enabled so the experiment can
-- be toggled on its own. OFF in prod, ON local for polish.
insert into public.feature_flags (key, label, enabled, enabled_local, description)
values (
  'projection_vote_enabled',
  'Projection · Model-agreement vote',
  false,
  true,
  'Experiment: 👍/👎 on a pair''s projected finish; reveals a global "fans agree with our model" tally. OFF in prod.'
)
on conflict (key) do nothing;

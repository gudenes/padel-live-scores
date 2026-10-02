-- Existing registrations remain unattributed. No inferred historical backfill.
alter table public.prediction_beta_signups
  add column attribution jsonb not null default '{}'::jsonb
  check (jsonb_typeof(attribution) = 'object' and octet_length(attribution::text) <= 4096);
comment on column public.prediction_beta_signups.attribution is
  'UTM parameters on the signup URL. Campaign language comes from the campaign suffix, not interview language.';

-- Public beta form writes through the server. Participant details are private.
create table public.prediction_beta_signups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  email text not null unique check (char_length(email) between 3 and 254 and email = lower(trim(email))),
  language text not null check (language in ('en', 'es', 'pt')),
  locale text not null check (locale in ('en', 'es', 'pt')),
  commitment boolean not null check (commitment),
  contact_consent boolean not null check (contact_consent),
  consent_version text not null
);

alter table public.prediction_beta_signups enable row level security;
revoke all on public.prediction_beta_signups from anon, authenticated;
grant select, insert on public.prediction_beta_signups to service_role;

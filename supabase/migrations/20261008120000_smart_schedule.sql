-- Keep forecast data separate from imported schedules and notification triggers.
alter table public.matches add column if not exists smart_schedule jsonb;
comment on column public.matches.smart_schedule is 'Versioned court queue and estimated start window; never an official schedule.';

-- Private observations allow prospective accuracy checks against actual starts.
create table if not exists public.match_schedule_forecast_observations (
  match_id uuid not null references public.matches(id) on delete cascade,
  computed_at timestamptz not null,
  earliest_at timestamptz not null,
  latest_at timestamptz not null check (latest_at >= earliest_at),
  basis text not null,
  primary key (match_id, computed_at)
);
alter table public.match_schedule_forecast_observations enable row level security;
revoke all on public.match_schedule_forecast_observations from anon, authenticated;
grant all on public.match_schedule_forecast_observations to service_role;
create index if not exists match_schedule_observations_retention on public.match_schedule_forecast_observations(computed_at);

-- Apply the whole snapshot atomically so queue advancement cannot show two next badges.
-- Queue identity checks prevent overwriting status/court changes during calculation.
create or replace function public.write_smart_schedule(updates jsonb, sources jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare item jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('smart-schedule-writer'));
  perform 1 from public.matches where id in (select (x->>'match_id')::uuid from jsonb_array_elements(sources) x) order by id for update;
  if exists (
    select 1 from jsonb_array_elements(sources) x
    left join public.matches m on m.id = (x->>'match_id')::uuid
    where m.id is null or m.status::text is distinct from x->>'status'
      or m.court is distinct from x->>'court'
      or m.court_order is distinct from (x->>'court_order')::integer
      or m.scheduled_at is distinct from (x->>'scheduled_at')::timestamptz
  ) then return false; end if;
  for item in select * from jsonb_array_elements(updates) loop
    update public.matches set smart_schedule = nullif(item->'forecast', 'null'::jsonb)
    where id = (item->>'match_id')::uuid;
    if item->'forecast'->>'basis' in ('live_progress', 'observed_finish') and item->'forecast'->>'earliest_at' is not null then
      insert into public.match_schedule_forecast_observations(match_id, computed_at, earliest_at, latest_at, basis)
      values ((item->>'match_id')::uuid, (item->'forecast'->>'computed_at')::timestamptz,
        (item->'forecast'->>'earliest_at')::timestamptz, (item->'forecast'->>'latest_at')::timestamptz, item->'forecast'->>'basis')
      on conflict do nothing;
    end if;
  end loop;
  delete from public.match_schedule_forecast_observations where computed_at < now() - interval '30 days';
  return true;
end $$;
revoke all on function public.write_smart_schedule(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.write_smart_schedule(jsonb, jsonb) to service_role;

insert into public.feature_flags (key, label, enabled, enabled_local, description)
values ('smart_schedule_enabled', 'Smart schedule', false, true, 'Court queue badges and progress-based start windows. Keep production off during validation.')
on conflict (key) do nothing;

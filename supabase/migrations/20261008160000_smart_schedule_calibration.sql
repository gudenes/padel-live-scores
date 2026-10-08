-- Preserve model and official schedule at prediction time for prospective checks.
-- Existing observations remain identified as the original model; their original
-- schedule and queue position were not captured and must remain unknown.
alter table public.match_schedule_forecast_observations
  add column if not exists model text not null default 'court-progress-v1',
  add column if not exists next_to_play boolean,
  add column if not exists scheduled_at_snapshot timestamptz;

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
      insert into public.match_schedule_forecast_observations(match_id, computed_at, earliest_at, latest_at, basis, model, next_to_play, scheduled_at_snapshot)
      select (item->>'match_id')::uuid, (item->'forecast'->>'computed_at')::timestamptz,
        (item->'forecast'->>'earliest_at')::timestamptz, (item->'forecast'->>'latest_at')::timestamptz,
        item->'forecast'->>'basis', coalesce(item->'forecast'->>'model', 'court-progress-v1'),
        (item->'forecast'->>'next_to_play')::boolean, m.scheduled_at
      from public.matches m where m.id = (item->>'match_id')::uuid
      on conflict do nothing;
    end if;
  end loop;
  delete from public.match_schedule_forecast_observations where computed_at < now() - interval '30 days';
  return true;
end $$;
revoke all on function public.write_smart_schedule(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.write_smart_schedule(jsonb, jsonb) to service_role;


-- supabase/migrations/20260603000005_readiness_years.sql
--
-- Distinct calendar years that have in-scope (Premier + Cupra FIP) tournaments,
-- newest first. Powers the Year dropdown on the Data Readiness view. One cheap
-- indexed scan instead of pulling every tournament row into the app.

create or replace function readiness_years()
returns int[]
language sql
stable
as $$
  select coalesce(array_agg(y order by y desc), '{}')
  from (
    select distinct date_part('year', starts_at)::int as y
    from public.tournaments
    where starts_at is not null
      and level in ('major','p1','p2','finals','fip_platinum','fip_gold','fip_silver','fip_bronze')
  ) s
$$;

do $$
begin
  assert exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='readiness_years'), 'readiness_years missing';
end $$;

notify pgrst, 'reload schema';

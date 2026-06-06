-- supabase/migrations/20260606130000_projection_status_columns.sql
-- Full-field projection: keep every pair, flag eliminated/champion.
alter table public.tournament_projections
  add column if not exists status text not null default 'active',
  add column if not exists eliminated_round text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tournament_projections_status_chk'
  ) then
    alter table public.tournament_projections
      add constraint tournament_projections_status_chk
      check (status in ('active','eliminated','champion'));
  end if;
end $$;

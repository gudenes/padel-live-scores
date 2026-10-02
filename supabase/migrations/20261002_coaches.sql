-- Coach normalization (spec: docs/superpowers/specs/2026-10-02-coach-normalization-design.md)
-- players.coaches (TEXT[]) stays the raw FIP field. Everything here is derived
-- from it by padelgod's coach-linker worker, plus operator decisions.

create table if not exists public.coaches (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  normalized_name text not null,
  slug text not null unique,
  status text not null default 'unreviewed'
    check (status in ('unreviewed','verified','junk','merged')),
  merged_into uuid references public.coaches(id),
  country text,
  avatar_url text,
  notes text,
  player_id uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'merged') = (merged_into is not null))
);
create unique index if not exists coaches_normalized_name_active
  on public.coaches(normalized_name) where status <> 'merged';
create unique index if not exists coaches_player_id_unique
  on public.coaches(player_id) where player_id is not null;

create table if not exists public.coach_aliases (
  normalized_alias text primary key,
  coach_id uuid not null references public.coaches(id),
  example_raw text not null,
  source text not null default 'auto' check (source in ('auto','merge')),
  created_at timestamptz not null default now()
);
create index if not exists coach_aliases_coach_id on public.coach_aliases(coach_id);

create table if not exists public.player_coaches (
  player_id uuid not null references public.players(id) on delete cascade,
  coach_id uuid not null references public.coaches(id),
  raw_name text not null,
  position smallint not null,
  primary key (player_id, coach_id)
);
create index if not exists player_coaches_coach_id on public.player_coaches(coach_id);

create table if not exists public.coach_merge_suggestions (
  id uuid primary key default gen_random_uuid(),
  coach_a uuid not null references public.coaches(id),
  coach_b uuid not null references public.coaches(id),
  score numeric not null,
  reason text not null check (reason in ('subset','typo','manual')),
  status text not null default 'pending' check (status in ('pending','merged','rejected')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (coach_a < coach_b),
  unique (coach_a, coach_b)
);

create table if not exists public.coach_player_link_suggestions (
  coach_id uuid not null references public.coaches(id),
  player_id uuid not null references public.players(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','linked','rejected')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (coach_id, player_id)
);

alter table public.coaches enable row level security;
alter table public.coach_aliases enable row level security;
alter table public.player_coaches enable row level security;
alter table public.coach_merge_suggestions enable row level security;
alter table public.coach_player_link_suggestions enable row level security;
-- No anon policy in Phase 1: service key only. Phase 2 (public pages) adds read policies.

-- Per-coach aggregates. Excludes merged coaches; junk is kept (admin filters it).
-- player_coaches PK (player_id, coach_id) guarantees each player counts once per coach.
create or replace view public.coach_stats with (security_invoker = true) as
select
  c.id as coach_id,
  c.display_name,
  c.slug,
  c.status,
  c.player_id,
  count(p.id)::int as player_count,
  coalesce(sum(p.points) filter (where p.category = 'men'), 0)::numeric as men_points,
  coalesce(sum(p.points) filter (where p.category = 'women'), 0)::numeric as women_points,
  coalesce(sum(p.points), 0)::numeric as total_points,
  (select count(*) from public.coach_aliases a where a.coach_id = c.id)::int as variant_count
from public.coaches c
left join public.player_coaches pc on pc.coach_id = c.id
left join public.players p on p.id = pc.player_id and coalesce(p.tier, 'pro') = 'pro'
where c.status <> 'merged'
group by c.id;

-- Atomic merge: everything of p_source moves onto p_target.
create or replace function public.merge_coaches(
  p_source uuid,
  p_target uuid,
  p_keep_source_name boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.coaches;
  t public.coaches;
begin
  if p_source = p_target then
    raise exception 'merge_coaches: source and target are the same coach';
  end if;
  select * into s from public.coaches where id = p_source for update;
  select * into t from public.coaches where id = p_target for update;
  if s.id is null or t.id is null then
    raise exception 'merge_coaches: coach not found';
  end if;
  if s.status = 'merged' or t.status = 'merged' then
    raise exception 'merge_coaches: coach already merged';
  end if;

  update public.coach_aliases set coach_id = p_target, source = 'merge' where coach_id = p_source;

  insert into public.player_coaches (player_id, coach_id, raw_name, position)
    select player_id, p_target, raw_name, position from public.player_coaches where coach_id = p_source
    on conflict (player_id, coach_id) do nothing;
  delete from public.player_coaches where coach_id = p_source;

  -- Record the merge decision for this pair (insert if it was a manual merge).
  insert into public.coach_merge_suggestions (coach_a, coach_b, score, reason, status, decided_at)
    values (least(p_source, p_target), greatest(p_source, p_target), 1, 'manual', 'merged', now())
    on conflict (coach_a, coach_b) do update set status = 'merged', decided_at = now();

  -- Carry "not the same person" decisions over to the target so they are never re-suggested.
  insert into public.coach_merge_suggestions (coach_a, coach_b, score, reason, status, decided_at)
    select least(p_target, x.other), greatest(p_target, x.other), x.score, x.reason, 'rejected', x.decided_at
    from (
      select case when coach_a = p_source then coach_b else coach_a end as other, score, reason, decided_at
      from public.coach_merge_suggestions
      where status = 'rejected' and (coach_a = p_source or coach_b = p_source)
    ) x
    where x.other <> p_target
    on conflict (coach_a, coach_b) do update set status = 'rejected', decided_at = excluded.decided_at;

  -- Drop the source's remaining pending/rejected rows; the linker regenerates pending ones against the target.
  delete from public.coach_merge_suggestions
    where status in ('pending','rejected') and (coach_a = p_source or coach_b = p_source);
  delete from public.coach_player_link_suggestions where coach_id = p_source and status = 'pending';

  update public.coaches
    set status = 'merged', merged_into = p_target, player_id = null, updated_at = now()
    where id = p_source;

  update public.coaches
    set display_name = case when p_keep_source_name then s.display_name else display_name end,
        player_id = coalesce(player_id, s.player_id),
        updated_at = now()
    where id = p_target;
end;
$$;

revoke all on function public.merge_coaches(uuid, uuid, boolean) from public, anon, authenticated;

do $$
begin
  assert exists (select 1 from information_schema.tables where table_schema='public' and table_name='coaches'), 'coaches missing';
  assert exists (select 1 from information_schema.tables where table_schema='public' and table_name='coach_aliases'), 'coach_aliases missing';
  assert exists (select 1 from information_schema.tables where table_schema='public' and table_name='player_coaches'), 'player_coaches missing';
  assert exists (select 1 from information_schema.tables where table_schema='public' and table_name='coach_merge_suggestions'), 'coach_merge_suggestions missing';
  assert exists (select 1 from information_schema.tables where table_schema='public' and table_name='coach_player_link_suggestions'), 'coach_player_link_suggestions missing';
  assert exists (select 1 from information_schema.views where table_schema='public' and table_name='coach_stats'), 'coach_stats missing';
  assert exists (select 1 from pg_proc where proname='merge_coaches'), 'merge_coaches missing';
end $$;

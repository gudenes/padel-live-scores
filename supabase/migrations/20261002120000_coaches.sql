-- Coach normalization (spec: docs/superpowers/specs/2026-10-02-coach-normalization-design.md)
-- players.coaches (TEXT[]) stays the raw FIP field. Everything here is derived
-- from it by padelgod's coach-linker worker, plus operator decisions.

set local lock_timeout = '5s';  -- FKs to the hot public.players table take a lock; fail fast instead of queueing

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
  check ((status = 'merged') = (merged_into is not null)),
  check (merged_into is null or merged_into <> id)
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
  c.normalized_name,
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
comment on column public.coach_stats.player_count is 'Counts pro-tier players only (coalesce(tier, ''pro'') = ''pro'').';

-- Actionable merge suggestions: pending, both coaches live (coach_stats excludes merged; junk filtered here).
-- impact = combined pro points, used to rank the review queue.
create or replace view public.coach_merge_queue with (security_invoker = true) as
select
  s.id,
  s.score,
  s.reason,
  s.coach_a,
  s.coach_b,
  a.display_name as a_name,
  b.display_name as b_name,
  a.total_points as a_points,
  b.total_points as b_points,
  a.player_count as a_players,
  b.player_count as b_players,
  (a.total_points + b.total_points) as impact
from public.coach_merge_suggestions s
join public.coach_stats a on a.coach_id = s.coach_a and a.status not in ('merged','junk')
join public.coach_stats b on b.coach_id = s.coach_b and b.status not in ('merged','junk')
where s.status = 'pending';

-- Actionable coach<->player link suggestions: pending, coach still live.
create or replace view public.coach_link_queue with (security_invoker = true) as
select
  l.coach_id,
  l.player_id,
  c.display_name as coach_name,
  p.name as player_name,
  p.country as player_country,
  p.tier as player_tier,
  p.ranking as player_ranking,
  p.category as player_category
from public.coach_player_link_suggestions l
join public.coaches c on c.id = l.coach_id and c.status not in ('merged','junk') and c.player_id is null
join public.players p on p.id = l.player_id
where l.status = 'pending'
  and not exists (select 1 from public.coaches c2 where c2.player_id = l.player_id);

-- Atomic merge: everything of p_source moves onto p_target.
create or replace function public.merge_coaches(
  p_source uuid,
  p_target uuid,
  p_keep_source_name boolean default false
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  s public.coaches;
  t public.coaches;
begin
  if p_source = p_target then
    raise exception 'merge_coaches: source and target are the same coach';
  end if;

  -- Lock both rows in id order so concurrent opposite-direction merges cannot deadlock.
  perform 1 from public.coaches where id in (p_source, p_target) order by id for update;
  select * into s from public.coaches where id = p_source;
  select * into t from public.coaches where id = p_target;
  if s.id is null or t.id is null then
    raise exception 'merge_coaches: coach not found';
  end if;
  if s.status = 'merged' or t.status = 'merged' then
    raise exception 'merge_coaches: coach already merged';
  end if;
  if t.status = 'junk' then
    raise exception 'merge_coaches: cannot merge into a junk coach';
  end if;
  if s.player_id is not null and t.player_id is not null and s.player_id <> t.player_id then
    raise exception 'merge_coaches: both coaches are linked to different players — unlink one first';
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
  -- Never overwrite a 'merged' history row, and skip coaches that are themselves merged.
  insert into public.coach_merge_suggestions (coach_a, coach_b, score, reason, status, decided_at)
    select least(p_target, x.other), greatest(p_target, x.other), x.score, x.reason, 'rejected', x.decided_at
    from (
      select case when coach_a = p_source then coach_b else coach_a end as other, score, reason, decided_at
      from public.coach_merge_suggestions
      where status = 'rejected' and (coach_a = p_source or coach_b = p_source)
    ) x
    join public.coaches oc on oc.id = x.other and oc.status <> 'merged'
    where x.other <> p_target
    on conflict (coach_a, coach_b) do update set status = 'rejected', decided_at = excluded.decided_at
      where coach_merge_suggestions.status = 'pending';

  -- Drop the source's remaining pending/rejected rows; the linker regenerates pending ones against the target.
  delete from public.coach_merge_suggestions
    where status in ('pending','rejected') and (coach_a = p_source or coach_b = p_source);

  -- Carry rejected coach<->player link decisions, then drop the source's pending/rejected rows
  -- (linked history is kept).
  insert into public.coach_player_link_suggestions (coach_id, player_id, status, decided_at)
    select p_target, player_id, 'rejected', decided_at
    from public.coach_player_link_suggestions where coach_id = p_source and status = 'rejected'
    on conflict (coach_id, player_id) do update set status = 'rejected', decided_at = excluded.decided_at
      where coach_player_link_suggestions.status = 'pending';
  delete from public.coach_player_link_suggestions
    where coach_id = p_source and status in ('pending','rejected');

  -- Mark source merged (clearing player_id first so the unique index never sees a duplicate).
  update public.coaches
    set status = 'merged', merged_into = p_target, player_id = null, updated_at = now()
    where id = p_source;

  -- Flatten merge chains: anything previously merged into the source now points at the target.
  update public.coaches set merged_into = p_target, updated_at = now() where merged_into = p_source;

  update public.coaches
    set display_name = case when p_keep_source_name then s.display_name else display_name end,
        player_id = coalesce(player_id, s.player_id),
        updated_at = now()
    where id = p_target;

  -- If the target now has a player, its other pending link suggestions are moot.
  update public.coach_player_link_suggestions
    set status = 'rejected', decided_at = now()
    where coach_id = p_target and status = 'pending'
      and player_id is distinct from (select player_id from public.coaches where id = p_target)
      and exists (select 1 from public.coaches where id = p_target and player_id is not null);
end;
$$;

comment on function public.merge_coaches(uuid, uuid, boolean) is
  'Moves everything from source coach onto target. p_keep_source_name changes display_name only: normalized_name and slug stay the target''s (slugs are stable for Phase-2 public pages).';

revoke all on function public.merge_coaches(uuid, uuid, boolean) from public, anon, authenticated;

do $$
begin
  assert exists (select 1 from information_schema.tables where table_schema='public' and table_name='coaches'), 'coaches missing';
  assert exists (select 1 from information_schema.tables where table_schema='public' and table_name='coach_aliases'), 'coach_aliases missing';
  assert exists (select 1 from information_schema.tables where table_schema='public' and table_name='player_coaches'), 'player_coaches missing';
  assert exists (select 1 from information_schema.tables where table_schema='public' and table_name='coach_merge_suggestions'), 'coach_merge_suggestions missing';
  assert exists (select 1 from information_schema.tables where table_schema='public' and table_name='coach_player_link_suggestions'), 'coach_player_link_suggestions missing';
  assert exists (select 1 from information_schema.views where table_schema='public' and table_name='coach_stats'), 'coach_stats missing';
  assert exists (select 1 from information_schema.views where table_schema='public' and table_name='coach_merge_queue'), 'coach_merge_queue missing';
  assert exists (select 1 from information_schema.views where table_schema='public' and table_name='coach_link_queue'), 'coach_link_queue missing';
  assert exists (select 1 from pg_proc where proname='merge_coaches'), 'merge_coaches missing';
end $$;

notify pgrst, 'reload schema';

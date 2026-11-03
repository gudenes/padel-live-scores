-- Historical national-team World Cups, isolated from live/public match statistics.
create table public.world_cup_archive_editions (
  year integer primary key check (year between 1990 and 2100),
  name text not null,
  coverage jsonb not null,
  imported_at timestamptz not null default now()
);
create table public.world_cup_archive_sources (
  id text primary key,
  url text not null,
  content_sha256 text not null,
  raw_html text not null,
  fetched_at timestamptz not null,
  unique(url,content_sha256)
);
create table public.world_cup_archive_records (
  edition_year integer not null references public.world_cup_archive_editions(year),
  kind text not null check (kind in ('podium','squad','group','tie','match','replay','document')),
  category text not null check (category in ('men','women','mixed')),
  external_id text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  source_id text not null references public.world_cup_archive_sources(id),
  imported_at timestamptz not null default now(),
  primary key (edition_year,kind,category,external_id)
);
-- Only the operator-gated admin can access these via its service role.
alter table public.world_cup_archive_editions enable row level security;
alter table public.world_cup_archive_sources enable row level security;
alter table public.world_cup_archive_records enable row level security;
revoke all on public.world_cup_archive_editions, public.world_cup_archive_sources, public.world_cup_archive_records from anon, authenticated;
grant all on public.world_cup_archive_editions, public.world_cup_archive_sources, public.world_cup_archive_records to service_role;

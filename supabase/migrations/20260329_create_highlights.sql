-- Video highlights table — stores YouTube videos fetched via Data API
create table if not exists highlights (
  id uuid primary key default gen_random_uuid(),
  youtube_id text unique not null,
  title text not null,
  channel_name text not null,
  thumbnail_url text not null,
  duration text,               -- ISO 8601 duration from YouTube, converted to "M:SS"
  view_count integer default 0,
  published_at timestamptz not null,
  tournament_id uuid references tournaments(id),
  category text,               -- 'men', 'women', or null
  tags text[] default '{}',
  status text not null default 'active',  -- 'active', 'hidden'
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_highlights_published on highlights (published_at desc);
create index if not exists idx_highlights_status on highlights (status);

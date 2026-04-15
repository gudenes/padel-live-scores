-- Articles table — stores news articles from RSS feeds and other sources
create table if not exists articles (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source_name text not null,       -- e.g. "Padel Addict", "FIP"
  source_icon text,                -- short text for icon badge, e.g. "PA"
  source_key text not null,        -- machine key: 'google-news-en', 'padel-addict', 'fip'
  url text unique not null,
  image_url text,
  snippet text,                    -- short description / first paragraph
  language text,                   -- 'en', 'es', 'pt', 'fr'
  published_at timestamptz not null,
  category text,                   -- 'men', 'women', or null
  tags text[] default '{}',
  click_count integer not null default 0,
  source_weight numeric not null default 1.0, -- FIP=1.5, padel sites=1.2, google=1.0
  status text not null default 'active',      -- 'active', 'hidden'
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_articles_published on articles (published_at desc);
create index if not exists idx_articles_status on articles (status);
create index if not exists idx_articles_source on articles (source_key);

-- Atomic click counter — avoids race conditions
create or replace function increment_article_clicks(article_id uuid)
returns void as $$
  update articles set click_count = click_count + 1 where id = article_id;
$$ language sql;

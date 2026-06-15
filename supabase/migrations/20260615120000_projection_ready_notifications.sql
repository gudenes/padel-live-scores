-- projection_ready_notifications — claim ledger so projection-ready notifications
-- fire exactly once per (tournament, category). The PK + INSERT ON CONFLICT DO
-- NOTHING is the atomic claim used by padelgod's projection-ready-notifier.
create table if not exists public.projection_ready_notifications (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  category text not null check (category in ('men', 'women')),
  notified_at timestamptz not null default now(),
  primary key (tournament_id, category)
);

-- Service-role only; no public read needed. Enable RLS with no policies so the
-- anon/auth roles get zero rows (service key bypasses RLS).
alter table public.projection_ready_notifications enable row level security;

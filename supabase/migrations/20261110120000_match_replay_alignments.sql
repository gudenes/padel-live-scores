-- Replay timing is independent of scouting and uploaded clip timing.
create table if not exists public.match_replay_alignments (
 match_id uuid not null,
 match_kind text not null check(match_kind in ('canonical','manual')),
 video_url text not null,
 recorded_seconds double precision not null check(recorded_seconds >= 0 and recorded_seconds < 10000000000),
 replay_seconds double precision not null check(replay_seconds >= 0 and replay_seconds <= 604800),
 updated_by text not null,
 updated_at timestamptz not null default now(),
 primary key(match_id,match_kind,video_url)
);
alter table public.match_replay_alignments enable row level security;
revoke all on public.match_replay_alignments from anon,authenticated;

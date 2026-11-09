-- Private match media metadata. File bytes live in a private Cloudflare R2 bucket.
create table if not exists public.match_video_uploads (
 id uuid primary key,
 match_id uuid not null,
 match_kind text not null check(match_kind in ('canonical','manual')),
 owner_user_id text not null,
 file_name text not null,
 byte_size bigint not null check(byte_size>0 and byte_size<=21474836480),
 duration_seconds double precision not null,
 broadcast_offset double precision not null default 0,
 object_key text not null unique,
 multipart_id text,
 status text not null default 'uploading' check(status in ('uploading','ready','cancelled')),
 created_at timestamptz not null default now(),
 completed_at timestamptz
);
create index if not exists match_video_ready on public.match_video_uploads(match_id,match_kind,completed_at desc) where status='ready';
alter table public.match_video_uploads enable row level security;
revoke all on public.match_video_uploads from anon,authenticated;
-- Access is through authenticated admin server routes only. No browser DB access.

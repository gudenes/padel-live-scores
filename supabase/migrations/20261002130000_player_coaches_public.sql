-- Public, read-only projection of a player's canonical coaches for the player
-- profile (spec: docs/superpowers/specs/2026-10-02-player-profile-coaches-design.md).
--
-- Deliberately an OWNER-RIGHTS view (no security_invoker), created as a
-- security_barrier view: coaches and
-- player_coaches keep RLS on with no anon policy, and this view is the only
-- anon path in. Only these five columns ever leave — notes, avatar_url,
-- country, normalized_name, aliases and both suggestion tables stay private.
-- Supabase's advisor flags owner-rights views; this one is intentional.
-- Junk and merged coaches never appear.

set local lock_timeout = '5s';

create or replace view public.player_coaches_public with (security_barrier = true) as
select pc.player_id, pc.position, c.id as coach_id, c.display_name, c.slug
from public.player_coaches pc
join public.coaches c on c.id = pc.coach_id
where c.status in ('unreviewed', 'verified');

-- Supabase default privileges grant ALL on new public relations to
-- anon/authenticated/service_role, so strip them explicitly, then grant SELECT only.
revoke all on public.player_coaches_public from public, anon, authenticated;
grant select on public.player_coaches_public to anon, authenticated, service_role;

do $$
begin
  assert exists (select 1 from information_schema.views where table_schema='public' and table_name='player_coaches_public'),
    'player_coaches_public missing';
end $$;

notify pgrst, 'reload schema';

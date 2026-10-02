# Coach Pages + Coaches Index — Design (Phase 2)

**Date:** 2026-10-02
**Status:** Approved in chat, spec awaiting Gustavo's review
**Builds on:**
- `2026-10-02-coach-normalization-design.md` — coaches, aliases, player_coaches, coach-linker (live, PR #635)
- `2026-10-02-player-profile-coaches-design.md` — `player_coaches_public` view + profile Coaches card (live, PR #636; comma-separated names in PR #637)

## Goal

Public, server-rendered pages for padel coaches: a profile per coach at `/coach/[slug]` and a ranked index at `/coaches`. Mockups agreed in chat on 2026-10-02 (Gustavo Pratto page + index with Overall/Men/Women tabs).

## Decisions (2026-10-02)

1. **Scope:** coach page **and** index in this version.
2. **Coach page sections:** header, points tiles, next matches, players, titles of the current year — all three content sections.
3. **Index ranking:** sum of the coach's players' FIP points (pro tier). Tabs **Overall** (men + women summed), **Men**, **Women**. Coaching both halves of a pair counts both players — accepted.
4. **URLs:** `/coach/[slug]` (singular, like `/player/[id]`) and `/coaches`; localised under `/{es,pt,it,fr}/…` via the existing `as-needed` prefix.
5. **Server-rendered** (lesson from the client-rendered thin shells that don't get indexed), `revalidate = 3600`, following the PPL team page pattern (`createAnonServerClient`).
6. **Which coaches:** every non-junk, non-merged coach with ≥1 linked player gets a page (~850). Coaches whose players have **0 pro points** render with `noindex` and are left out of the sitemap.
7. **Merged coaches redirect** (308) to `merged_into`'s slug; unknown slugs 404.
8. **Links in:** names in the profile Coaches card become links; the Rankings page gets a "Coaches" link to `/coaches`. Bottom nav unchanged.
9. **Out of scope:** coach photos (initials avatars only), coaching history, coach search, coaches on match pages.

## Data access

Anon (server) client only. One new owner-rights view, same pattern and safeguards as `player_coaches_public`:

```sql
-- supabase/migrations/20261002140000_coach_rankings_public.sql
create or replace view public.coach_rankings_public with (security_barrier = true) as
with agg as (
  select
    c.id as coach_id, c.display_name, c.slug,
    count(p.id)::int as player_count,
    coalesce(sum(p.points) filter (where p.category = 'men'), 0)::bigint as men_points,
    coalesce(sum(p.points) filter (where p.category = 'women'), 0)::bigint as women_points,
    coalesce(sum(p.points), 0)::bigint as total_points
  from public.coaches c
  join public.player_coaches pc on pc.coach_id = c.id
  join public.players p on p.id = pc.player_id and coalesce(p.tier, 'pro') = 'pro'
  where c.status in ('unreviewed', 'verified')
  group by c.id
)
select
  a.coach_id, a.display_name, a.slug, a.player_count,
  a.men_points, a.women_points, a.total_points,
  rank() over (order by a.total_points desc) as rank_overall,
  case when a.men_points > 0
    then rank() over (partition by (a.men_points > 0) order by a.men_points desc) end as rank_men,
  case when a.women_points > 0
    then rank() over (partition by (a.women_points > 0) order by a.women_points desc) end as rank_women
from agg a
where a.player_count > 0;

-- merged slug → surviving slug, for redirects
create or replace view public.coach_slug_redirects with (security_barrier = true) as
select m.slug as old_slug, t.slug as new_slug
from public.coaches m join public.coaches t on t.id = m.merged_into
where m.status = 'merged';

revoke all on public.coach_rankings_public, public.coach_slug_redirects from public, anon, authenticated;
grant select on public.coach_rankings_public, public.coach_slug_redirects to anon, authenticated, service_role;
```

`coach_rankings_public` reads the base tables (`coaches`, `player_coaches`, `players`) directly, NOT `coach_stats`: `coach_stats` is `security_invoker`, and Postgres checks a security_invoker view with the current user's permissions even when reached from an owner-rights view, so anon would get zero rows. The owner-rights view exposes only these columns. Men/Women ranks are NULL when the coach has 0 points in that category, and those rows are also filtered out in the query (`men_points > 0` / `women_points > 0`).

Everything else is already public:
- **Players:** `player_coaches_public` (coach → player ids, position) + `players` (name, display_name, country, category, ranking, points, avatar_url, tier).
- **Titles:** `matches` where `round` is the final, `status='finished'`, tournament `starts_at` in the current calendar year, and a winning-pair player is one of the coach's current players. One entry per (tournament, category). Label + footnote: "titles won by the players he/she coaches today".
- **Next matches:** `matches` with `status in ('live','on_court','scheduled')` involving any of the coach's players, live first then `scheduled_at` ascending, max 3; scheduled ones only if `scheduled_at` ≥ now − 3h (avoid stale `scheduled` rows).

Data assembly lives in `src/lib/coach-page-data.ts` (pure shaping functions + one fetch function), mirroring `src/lib/ppl-team-data.ts`.

## Pages

### `/coach/[slug]` — `src/app/[locale]/(app)/coach/[slug]/page.tsx`
1. **Header:** initials avatar, `#N coach` chip (overall rank), name, "Coach · N players · N titles in YYYY".
2. **Points tiles:** Men pts / Women pts (each with its player count); a tile is hidden when that category has no players.
3. **Next match(es):** up to 3, live first; card hidden when none.
4. **Players:** Men, then Women, each sorted by ranking (unranked last); first 6 overall then "+N more" expands client-side (small client island). Each row links to `/player/[id]`; flag + ranking + points.
5. **Titles {year}:** newest first, tier chip (Major/P1/P2/FIP level), tournament, winning pair, date; first 4 then "+N more"; footnote. Card hidden when none.

### `/coaches` — `src/app/[locale]/(app)/coaches/page.tsx`
- Tabs Overall / Men / Women via `?tab=` (server-rendered per tab, linkable).
- Rows: position, initials avatar, name + top-2 players' short names "+N", points, player count. 50 per page with "Show more" (`?page=`).
- Intro line: "Ranked by their players' FIP points".

Styling follows the existing player profile (dark cards, orange labels, chunky clip-path), reusing shared constants from `src/components/home/shared`.

## SEO
- `generateMetadata` per page and locale (title "Gustavo Pratto — Padel coach | Padel Nachos"; description listing top players), canonical + hreflang for the 5 locales.
- JSON-LD `Person` with `jobTitle: "Padel coach"` on coach pages.
- `noindex` for coaches with `total_points = 0`.
- New `src/app/sitemap-coaches.xml/route.ts` (indexable coaches + `/coaches`), registered wherever the other `sitemap-*.xml` routes are listed.

## i18n
All page strings in `src/messages/{en,es,pt,it,fr}.json` under a new `coach` namespace (labels, tab names, footnote, "+N more", metadata strings). Title-year and counts via ICU.

## Linking
- `src/app/[locale]/player/[id]/CoachesCard.tsx`: each name links to `/coach/[slug]` → needs `slug` in the card's data (already exposed by `player_coaches_public`). **Depends on PR #637** (comma-separated card) — merge it first, then build on top.
- Rankings page: a "Coaches" link/chip to `/coaches`.

## Error handling
- Unknown slug → `notFound()`; merged slug → `permanentRedirect` to the new slug.
- Section queries are independent: a failing titles or matches query hides that section and logs; it never 500s the page. The players query failing is fatal (→ error boundary), since the page is meaningless without it.

## Testing
- **Unit:** `coach-page-data.ts` shaping — players split/sort (unranked last), titles dedupe per (tournament, category) + current-year filter, next-match ordering (live first, stale scheduled dropped), noindex rule.
- **Migration check:** rollback-only script (pattern of `scripts/verify-player-coaches-public.ts`): anon can read both views, sees only listed columns, junk/merged/zero-player coaches absent, no anon write privileges, ranks correct on a fixture.
- **Browser (local, prod data):** Pratto (titles + next match), a women-only coach (Gilardoni → no men tile), a 1-player coach, a 0-point coach (noindex meta present), a merged slug redirect, `/coaches` 3 tabs + paging, `/es/coach/…` strings, mobile width; profile card links land on the right coach.

## Rollout
1. Migration applied (pg + DATABASE_URL) — on Gustavo's go-ahead.
2. PR → merge (after #637) → web deploy with `scripts/deploy.sh web` from a checkout outside `.claude/` — on Gustavo's go-ahead.
3. Submit `sitemap-coaches.xml` in Search Console (Gustavo).

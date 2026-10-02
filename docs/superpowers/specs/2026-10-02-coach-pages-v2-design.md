# Coach Pages v2 — Rankings tab, player avatars, MatchCard (design + plan)

**Date:** 2026-10-02 · **Status:** approved in chat · **Builds on:** `2026-10-02-coach-pages-design.md` (live, PR #638)

## Decisions (Gustavo, 2026-10-02)

1. **Coaches becomes a 4th tab on `/rankings`** (Official · Race · Money · **Coaches**), URL `?type=coaches`. It is the app's entry point to coaches. The small "Coaches" header link added in #638 is removed (the tab replaces it).
2. **`/coaches` stays** (server-rendered, in `sitemap-coaches.xml`) for SEO and search visitors — option A. Same data and row design as the tab.
3. **Player avatars** on the coach page players list and in the index/tab rows (top players), using the shared `src/components/Avatar.tsx` (photo, initials fallback on missing/broken image).
4. **Next matches use the existing `MatchCard`** (`src/components/MatchCard.tsx`) instead of the custom rows — same card as home/tournament/following, with its built-in realtime updates for live matches. Up to 3, live first.

## Design

### Rankings tab — `src/app/[locale]/(app)/rankings/`
- `RankType` gains `'coaches'`; `RANK_KEYS` and `useSwipeTabs({ count })` go from 3 to 4; tab label `t('coachesTab')` (rankings namespace, 5 locales: Coaches / Entrenadores / Treinadores / Allenatori / Entraîneurs).
- New client component `CoachRankingList.tsx` (same folder), rendered when `rankType === 'coaches'` instead of the player list. It owns its own 3-chip filter Overall / Men / Women (the page's existing Men/Women toggle is hidden on this tab), fetches `coach_rankings_public` with the browser anon client (`@/lib/supabase`), 50 rows + "Show more" (append, like the player list's `visibleCount`), and per-row top-2 player names + avatars via `player_coaches_public` + `players` (pro tier). Rows link to `/coach/[slug]`.
- The shaping it needs (`topPlayerNames`, tab column choice, `tab_player_count`) is reused from `src/lib/coach-page-data.ts`. To share the fetch between server (`/coaches`) and client (tab), `fetchCoachesIndex` already takes a `SupabaseClient` — call it with the browser client from the tab. No new query code.
- Remove the header "Coaches" link from `rankings/page.tsx`.

### Coach page — `src/app/[locale]/(app)/coach/[slug]/page.tsx`
- **Avatars:** player rows use `<Avatar src={p.avatar_url} alt={name} size={30} fallback={initials(name)} />` with the category-coloured 2px border (MEN_BLUE / WOMEN_PURPLE) like the rankings rows. The coach's own header avatar stays initials (no coach photos).
- **Next matches:** `fetchCoachPage` returns full `Match` objects for the next-matches section, loaded with `MATCH_FETCH_SELECT` from `src/lib/match-fetch.ts` and normalised the same way `fetchMatchById` does (sort sets/games, `hydrateThinPlayers`). Extract that normalisation from `fetchMatchById` into an exported `normalizeFetchedMatch(row)` in `match-fetch.ts` so both use one path. Selection rules unchanged (`pickNextMatches`: live first, stuck-live > 18h and stale-scheduled > 3h dropped, max 3). Rendered by a small client wrapper `CoachNextMatches.tsx` that supplies `MatchCard`'s required props: `genderColor` (MEN_BLUE / WOMEN_PURPLE by `match.category`), `locale` (`useLocale()`), `userTz` (`Intl.DateTimeFormat().resolvedOptions().timeZone`, same as the tournament page), `tournamentLevel` (`match.tournament?.level`).
- **Index `/coaches`:** rows show the top-2 players' avatars (overlapping 22px circles) before the names.

## Plan (tasks)

1. **`match-fetch.ts`**: extract `normalizeFetchedMatch` (TDD: sets/games sorted, thin players hydrated — reuse an existing fixture if `src/lib/__tests__` has one for match-fetch); `fetchMatchById` calls it. No behaviour change.
2. **`coach-page-data.ts`**: next-matches query switches to `MATCH_FETCH_SELECT` + `normalizeFetchedMatch`; `UpcomingRow` → `Match` (keep `pickNextMatches` generic over `{ status, scheduled_at }`); `CoachPlayer` already has `avatar_url`; index rows expose top players (id, name, avatar_url) not just names. Update tests.
3. **Coach page**: avatars + `CoachNextMatches` (MatchCard).
4. **`/coaches` index**: top-player avatars.
5. **Rankings tab**: `CoachRankingList`, 4th tab, i18n `rankings.coachesTab` ×5, remove header link.
6. **Checks**: `npx tsc --noEmit`, targeted vitest files only (never all of `src/lib` — ~20 pre-existing unrelated failures), eslint on changed files, `npm run build`.
7. **Rollout (Gustavo's go-ahead):** local browser check (Rankings → Coaches tab 3 filters + swipe + show more, coach page avatars + MatchCard, `/coaches` avatars, mobile, es) → PR → merge → `scripts/deploy.sh web` from a checkout outside `.claude/`. No migration needed.

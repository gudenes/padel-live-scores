# Live Tournaments Carousel — Home Page Top Section

**Date:** 2026-05-20
**Status:** Design approved, awaiting plan

## Goal

Add a new horizontal **Live Tournaments** carousel as the first section of the home page (above LIVE NOW). Each card is a cover-image tile for a tournament running today or starting soon, with the count of matches scheduled today. Replaces nothing — TOURNAMENT SPOTLIGHT, LIVE NOW, COMING UP, etc. all stay where they are. Visual treatment follows **Variant A** from the brainstorm mockup: every shape (card, chips, level pill, LIVE pill, CTA) uses the `CHUNKY` clip-path system already in [src/components/home/shared.tsx:22-29](../../src/components/home/shared.tsx#L22).

## Why

1. Tournaments are buried — today they only appear via the single `TournamentSpotlightHero` mid-page (one tournament) and the `/tournaments` route. On Premier weeks with 3-5 simultaneous events, the home page hides most of them.
2. The carousel is the most-requested "first thing visible" affordance from the polish mockup the user shared.
3. Tournament cover images already exist on the table ([2026-05-18-tournament-cover-images-design.md](2026-05-18-tournament-cover-images-design.md), shipped as `tournaments.cover_image_url`) — the data side is done.

## Placement

- New section, inserted **above LIVE NOW** in [src/app/[locale]/(app)/home/page.tsx:401](../../src/app/[locale]/(app)/home/page.tsx#L401).
- Section order, top → bottom: GlobalHeader → InviteWelcomeBanner / ReferralToast / WelcomeStrip → **Live Tournaments** → LIVE NOW → COMING UP → LATEST NEWS → RoadToOlympicsHomeCard → TOURNAMENT SPOTLIGHT → RANKINGS → LATEST RESULTS → footer.
- TOURNAMENT SPOTLIGHT stays untouched in v1. A future iteration may revisit whether the spotlight is still useful once the carousel is shipped, but that's out of scope here.

## Scope (what goes in each chip)

Two chips, default = LIVE/TODAY:

| Chip | Filter | Description |
|---|---|---|
| **LIVE/TODAY** | today (user's local timezone) falls between `starts_at` and `ends_at` | All tiers — Premier + FIP — included |
| **UPCOMING** | `starts_at` within the next 7 days from now | All tiers |

**Sort within each chip:**
1. Use the canonical `levelTierWeight()` from [src/lib/tournament-labels.ts](../../src/lib/tournament-labels.ts) — it already encodes the project-wide tournament-sorting order and covers all real FIP tiers.
2. Premier first, most-prestigious first: Finals(0) → Major(1) → P1(2) → P2(3)
3. Then FIP tiers: `fip_platinum`(4), `fip_gold`(5), `fip_hexagon`(6), `fip_championship`(7), `fip_finals`(8), `fip_silver`(10), `fip_bronze`(12), `fip_star`(14), `fip_rise`(15), `fip_promotion`(16), `fip_promises`(20), `fip_beyond`(22), `fip_other`(25)
4. Then by `starts_at` ascending (earliest first) as the within-tier tiebreaker

**Empty states:**
- LIVE/TODAY empty AND UPCOMING populated → auto-jump default chip to UPCOMING on render
- Both empty → hide the section entirely (no rendered SectionTitle, no chip strip, no placeholder card)

## Data fetching

Extend the existing `Promise.allSettled` block in [home/page.tsx:269-293](../../src/app/[locale]/(app)/home/page.tsx#L269). Three new queries:

1. **`home:carousel-live-today`** — `tournaments` rows with `starts_at <= todayEndUTC` AND `ends_at >= todayStartUTC`, selecting `id, name, starts_at, ends_at, country, location, level, logo_url, cover_image_url`. Limit 20 (generous; sorts client-side).
2. **`home:carousel-upcoming`** — `tournaments` rows with `starts_at` between `now` and `now + 7 days`, same select. Limit 20.
3. **`home:carousel-match-counts`** — single batched query: `matches` rows where `scheduled_at` is within the user's local-day window AND `tournament_id IN (…ids from queries 1+2…)`. Returns `tournament_id, status` so the client can both (a) count matches per tournament for today, and (b) detect `status='live'` for the red LIVE pill.

The existing `home:tournaments` query at line 279 (Premier-only, drives `TournamentSpotlightHero`) is **not reused** — it has different filtering rules. It stays as-is.

**Day boundary:** computed client-side using the user's local timezone via `Intl.DateTimeFormat().resolvedOptions().timeZone`, with the existing `geo-timezone` cookie pipeline as a fallback. Boundaries are `[startOfTodayUTC, endOfTodayUTC]` where "today" is the user's local day. Same approach the rest of the home page already uses for `scheduled_at` filtering.

## Components

**New file: `src/components/home/LiveTournamentsCarousel.tsx`**

```ts
interface Props {
  liveToday: TournamentWithMatchInfo[]
  upcoming: TournamentWithMatchInfo[]
}

interface TournamentWithMatchInfo extends Tournament {
  matchesToday: number       // 0 means no matches scheduled in user's local day
  hasLiveMatch: boolean      // at least one match with status='live' right now
}
```

The component owns chip state internally (`useState<'live-today' | 'upcoming'>`). Both lists are pre-fetched on home load — chip switching is purely client-side state, no refetch.

**Why a new component:** [home/page.tsx](../../src/app/[locale]/(app)/home/page.tsx) is intentionally a thin orchestrator (see comment at line 3 — "thin orchestrator. Sections extracted to src/components/home/."). Same pattern as `LiveMatchCard`, `UpcomingMatchCard`, `RankingsSection`, etc.

**Internal structure:**
- `<SectionTitle>` from `shared.tsx` — title `tHome('liveTournaments.title')`, no "View all" link in v1 (deferred — the `/tournaments` page redesign is its own future spec)
- Chip strip — two `CHUNKY.button` chips, active chip styled `background: GREEN, color: BG_BASE`
- Horizontal scroll strip — `scroll-snap-type: x mandatory`, `WebkitOverflowScrolling: touch`, hidden scrollbar — matching the LIVE NOW carousel at [home/page.tsx:405-420](../../src/app/[locale]/(app)/home/page.tsx#L405)
- Each card = `<TournamentCarouselCard tournament={…} chip={…} />`, wrapped in next-intl `<Link href={`/tournaments/${id}`}>` so the whole tile is tappable

**Sub-component: `TournamentCarouselCard`** (co-located in same file unless it grows >100 lines, then split):
- 178×240 outer card, `CHUNKY.card` clip-path, cover image as `next/image fill sizes="178px"` background, dark gradient overlay bottom-to-top
- Top-left `LIVE` pill (`CHUNKY.badge`, `#FF4655`) — only when `hasLiveMatch === true`
- Top-right level pill (`CHUNKY.badge`, tier-colored gradient — P1 purple, Major purple, Bronze amber, Rise cyan, Gold yellow, Future slate)
- Bottom stack inside `.meta`: flag (`FlagImage`), name (16px / 800), city or country, status line (see below), chunky VIEW SCORES button (`CHUNKY.button`)
- **Status line copy:**
  - LIVE/TODAY chip, `matchesToday > 0` → "{n} matches today" (ICU plural)
  - LIVE/TODAY chip, `matchesToday === 0` → "Rest day"
  - UPCOMING chip → "Starts {date}" using `next-intl` `format.dateTime` with the existing `DATE_SHORT` pattern

## Cover image fallback

`cover_image_url` is not guaranteed populated. When null:
- Render a tier-colored gradient placeholder filling the card. Premier-tier rows (`p1`, `p2`, `major`, `finals`) → purple gradient `linear-gradient(135deg, #6B46C1, #9333EA)`. FIP-tier rows (`fip_platinum`, `fip_gold`, `fip_silver`, `fip_bronze`, `fip_star`, `fip_rise`, `fip_promotion`, `fip_finals`, `fip_promises`, `fip_beyond`, `fip_hexagon`, `fip_championship`, `fip_other`) → tier-grouped warmer gradients (platinum/gold → amber, silver → slate, bronze → orange-brown, rise/star/promotion → cyan, promises/beyond/other → slate). Match the same family used by the level pill so the visual reads consistently.
- No logo overlay, no broken-image icon, no external network requests
- The level pill and tournament name still render clearly on the gradient

Cover artwork the user uploads via the existing tournament-cover pipeline takes over automatically when populated.

## i18n

New keys under `home.liveTournaments.*`:

```json
{
  "home": {
    "liveTournaments": {
      "title": "Live Tournaments",
      "chipLiveToday": "Live / Today",
      "chipUpcoming": "Upcoming",
      "matchesTodayCount": "{count, plural, one {# match today} other {# matches today}}",
      "restDay": "Rest day",
      "startsOn": "Starts {date}",
      "viewScores": "View Scores"
    }
  }
}
```

Ship all 5 locales (en, es, pt, it, fr) per the project i18n policy. Use descriptive paths and ICU plural for the count.

## Accessibility

- Section has `aria-labelledby` pointing at the SectionTitle's heading id
- Chip strip is `role="tablist"`, each chip is `role="tab"` with `aria-selected`, carousel container is `role="tabpanel"` with `aria-labelledby` matching the active chip
- Card link `aria-label` = `"{name}, {tierLabel}, {statusLine}"` — built from the same translated strings that render visually
- Cover image `alt=""` (decorative; the name lives in the link's accessible name)
- Native horizontal-scroll keyboard handling — focus moves through cards in order, no JS keyboard layer needed
- No transform-based animations, so `prefers-reduced-motion` is honored automatically

## Performance

- **3 new queries** added to the home `Promise.allSettled` batch, all parallel, all bounded by the existing 12 s safety timeout at [home/page.tsx:262](../../src/app/[locale]/(app)/home/page.tsx#L262)
- **Match-count query** is a single batched read, `tournament_id IN (…)` keyed by the IDs already fetched in the two tournament queries — typically <15 IDs, well below the 10k PostgREST cap so no pagination needed
- **Image weight:** `next/image fill sizes="178px"`, automatic AVIF/WebP. `storage.googleapis.com` and Supabase Storage are already in `next.config.ts`'s `images.remotePatterns`
- `priority={false}` on carousel images — they sit above the fold but the GlobalHeader and any auth-state UI dominate LCP; we don't want the carousel images blocking other reads
- **No new realtime subscription.** The existing `v3-home-live` channel at [home/page.tsx:344-356](../../src/app/[locale]/(app)/home/page.tsx#L344) already debounce-refetches `fetchData()` on any `matches.status='live'` change, which transitively rebuilds the carousel's `hasLiveMatch` flags. Good enough for v1.

## Out of scope (for v1)

- The "All Tournaments Today" compact row list shown lower in the polish mockup
- The wider home page redesign with cleaner radii / softer shapes
- "View all" link on the SectionTitle (defer until the `/tournaments` index redesign)
- Per-card live match-count badge (we show *all* matches today, not just the live ones — keeps the metric honest on days with mostly finished matches)
- Per-recipient carousel personalization based on bookmarks/follows
- Carousel pagination dots — the scroll-snap behavior + visible card peek is the affordance

## Open questions

None. All resolved in brainstorm 2026-05-20.

## Implementation surface

Files touched:
- `src/app/[locale]/(app)/home/page.tsx` — add 3 queries, pass props to new component, insert new section above LIVE NOW
- `src/components/home/LiveTournamentsCarousel.tsx` — new file, ~300 lines including the card sub-component
- `src/messages/{en,es,pt,it,fr}.json` — add `home.liveTournaments.*` keys
- No DB migration (the `tournaments.cover_image_url` column already exists)
- No new env vars
- No new external dependencies

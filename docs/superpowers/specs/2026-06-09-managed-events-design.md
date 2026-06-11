# Managed Events — operator-curated event pages

**Date:** 2026-06-09
**Status:** Design — pending implementation plan
**Author:** brainstormed with operator

## Problem

Some events we want to feature are **not** covered by our automated data feeds (padelapi / FIP / Crionet), or have a **non-standard format** that doesn't fit the `tournaments` / `matches` / `sets` / `draws` schema.

The motivating case is the **Reserve Cup** — an invitational *team* exhibition (Laver-Cup-style): two squads, best-of-2 sets + super-tiebreak + golden point, **day-weighted points** (1/2/3 pts Thu/Fri/Sat), cumulative team total decides the winner. No knockout bracket. Top players play (Coello, Tapia, Galán, Chingotto, …). The official site is a thin Wix marketing page with no scoring API. Streaming is on YouTube (`@ReserveCupSeries`) + DAZN / Mediaset / ESPN.

We want a **reusable, prestige-agnostic** way for operators to publish curated event pages — for Reserve Cup today and for any future curated event (exhibition *or* a Premier-level event we choose to cover manually) — that surface in the home carousel and the events listing, and click through to a self-contained detail page.

## Scope boundary (important)

Two complementary capabilities, deliberately kept separate:

| Need | Where it's handled |
|---|---|
| **Synced, standard-format** events (Premier/FIP) — live point-by-point, draws, per-match stats, standings | Existing `tournaments` + `matches` + `/tournaments/[id]` machinery. **Unchanged.** |
| **Manually-curated** event pages, any format/prestige — rosters, where-to-watch, schedule, info, optional manual results | **`managed_events`** (this spec). |

`managed_events` is for **curated content pages**. It deliberately does **not** model live point-by-point scoring — if a future event needs the full live-match experience, that is a separate effort over the `tournaments`/`matches` tables, not an extension of this table. The boundary: **synced/standard-format → `tournaments`; manually-curated/any-format → `managed_events`.**

### Out of scope (future)
- **Tier 2 — live scores** for Reserve Cup via the Crionet / matchscorerlive *team-widget* (`score-widget.matchscorerlive.com/public/teams/{live|completed}/{code}`). Confirmed feasible during the earlier investigation; the page reserves a "live scores during the event" placeholder as the hook-in. Not built here.
- **Full manual standard tournaments** with live matches over the `tournaments` schema.

## Architecture

A new `managed_events` table holds everything operator-editable. Nothing depends on the synced tables; nothing in the synced pipeline writes here. Three consumers:

1. **Public page** `/events/[slug]` — server-rendered thin detail page (the approved mockup).
2. **Home top carousel** (`LiveTournamentsCarousel`) — active managed events injected alongside real tournaments.
3. **Events listing** (`/tournaments`) — active managed events listed, tagged with a badge.

Plus an **admin manager** in `apps/ops/` (the active admin) to CRUD them.

```
managed_events (Supabase, RLS: anon reads active=true)
        │
        ├── /events/[slug]            (public detail page — the mockup)
        ├── home carousel injection   (src/app/[locale]/(app)/home/page.tsx)
        ├── /tournaments injection     (events listing)
        └── apps/ops Custom/Managed Events manager (CRUD)
```

## Data model — `managed_events`

```sql
create table public.managed_events (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,        -- 'reserve-cup-marbella-2026' → /events/<slug>
  name            text not null,               -- "Reserve Cup"
  wordmark        text,                         -- "RC26" (optional hero badge)
  badge_label     text not null default 'Event',-- pill text: 'Exhibition' | 'Premier' | 'Special Event' …
  active          boolean not null default false,
  status_override text,                         -- null = derive from dates; else 'upcoming'|'ongoing'|'finished'
  country         text,                         -- 'ES' (ISO-2)
  location        text,                         -- 'Marbella'
  venue           text,                         -- 'Puente Romano Beach Resort'
  starts_at       timestamptz,
  ends_at         timestamptz,
  prize_pool      text,                         -- free text: "$1.7M"
  cover_image_url text,                         -- carousel tile + hero background
  ticket_url      text,
  footnote        text,
  watch_links     jsonb not null default '[]',  -- see shape below
  divisions       jsonb not null default '[]',  -- see shape below
  format          jsonb not null default '{}',  -- see shape below
  results         jsonb,                         -- optional manual standings/results (Phase 2 editor)
  sort_weight     integer not null default 0,   -- tie-breaker for ordering among managed events
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index on public.managed_events (active, ends_at);

alter table public.managed_events enable row level security;

-- Anon/public: read only active events
create policy managed_events_public_read on public.managed_events
  for select using (active = true);
-- Writes happen via service key in the admin only (bypasses RLS); no anon write policy.
```

`updated_at` maintained by a `before update` trigger (mirror the project's existing `set_updated_at` convention).

### JSONB shapes

```ts
// watch_links: ordered; `primary` renders as the big YouTube-style CTA
type WatchLink = {
  platform: string      // 'youtube' | 'dazn' | 'mediaset' | 'espn' | 'ticketmaster' | …
  label: string         // 'Reserve Cup Series'
  region: string | null // 'Worldwide' | 'Spain · free' | 'LatAm'
  url: string
  primary?: boolean     // at most one; rendered as hero CTA
}

// divisions → teams → players. Empty teams + note = "roster soon" placeholder.
type Division = {
  id: string
  name: string                 // 'Men' | 'Women'
  badge_color?: string | null  // accent for the division tag (defaults by name)
  note?: string | null         // 'Roster to be announced · two teams of three'
  teams: Array<{
    name: string               // 'Team Reserve'
    captain?: string | null    // 'D. Jeter'
    accent_color?: string | null
    players: Array<{ name: string; country: string | null }>
  }>
}

// format: free-form explainer lines + optional day-weighted points grid
type Format = {
  blurbs: string[]                                   // bullet lines
  day_points?: Array<{ day: string; points: number; label?: string }> // [{day:'Thu',points:1,label:'pt / win'}]
}

// results (optional, Phase 2): manually-entered standings / completed matches
type Results = {
  standings?: Array<{ team: string; points: number }>
  matches?: Array<{ label?: string; teamA: string; teamB: string; score?: string; day?: string }>
}
```

## Status derivation

`effectiveStatus(event)`:
1. If `status_override` set → use it.
2. Else from dates (in the viewer's tz / UTC fallback):
   - now < `starts_at` → `upcoming`
   - `starts_at` ≤ now ≤ `ends_at` → `ongoing`
   - now > `ends_at` → `finished`

Pill colors reuse the app tokens: `upcoming` → green `#7ED321`, `ongoing` → orange `#F5A623`, `finished` → muted. **No red LIVE pill** and **no live scores** in this build (honest Tier-1 degrade) — `ongoing` is the strongest state. The `badge_label` (e.g. "Exhibition") renders as a secondary pill so the event reads as operator-curated, distinct from synced tournaments.

## Public page — `/events/[slug]`

New route `src/app/[locale]/(app)/events/[slug]/page.tsx` (server component):
- Fetch the single `active` row by `slug`; 404 if missing/inactive.
- Render the approved mockup ([mockups/reserve-cup-event.html](../../../mockups/reserve-cup-event.html)): hero (wordmark, name, location · venue · dates, status + badge pills), Where-to-watch (primary CTA + chips), Event info strip, Lineups (divisions → teams → players, with placeholder support), Format (blurbs + day-points), the live-scores placeholder note, ticket CTA, footnote.
- If `results` present, render a Standings/Results section (Phase 2 of the editor; the page supports it whenever data exists).
- **i18n:** chrome strings (section labels, "Where to watch", "Format", status pills) come from next-intl messages (`messages/*.json` → `events.*`); operator content (names, blurbs, venue) is rendered verbatim, not translated.
- **SEO:** `generateMetadata` (title/description/canonical/hreflang for all 5 locales) + JSON-LD `SportsEvent`, matching the tournament-page pattern.
- Reuses existing design primitives/tokens (chunky polygon clip-paths, parchment text, `FlagImg`, etc.).

## Home carousel injection

In `src/app/[locale]/(app)/home/page.tsx`, within the carousel data step (~`fetchData`, the `carouselLiveToday` build):
- Add a query: `managed_events` where `active = true` and `ends_at >= todayCutoff` (same back-window policy as real tournaments).
- Map each to the carousel card model. Extend `TournamentWithMatchInfo` with an optional discriminator:
  ```ts
  managedEvent?: { slug: string; badgeLabel: string }
  ```
- Merge into `carouselLiveToday` and sort with the existing comparator (use `sort_weight` + `starts_at` as the managed-event ordering inputs).

In `LiveTournamentsCarousel.tsx`, `TournamentCarouselCard` gets a small branch when `managedEvent` is present:
- Link to `/events/${managedEvent.slug}` instead of `/tournaments/${id}`.
- Show the `badgeLabel` pill (e.g. "EXHIBITION") instead of the tier pill.
- Status chip/line from `effectiveStatus` (upcoming/ongoing) rather than `matchesToday`.
- Everything else (cover image, name, city, CTA) unchanged.

The carousel is feature-flagged (`HOME_LIVE_TOURNAMENTS_CAROUSEL`); managed events ride the same flag.

## Events listing injection — `/tournaments`

Merge active managed events into the `/tournaments` listing (same active + date-window filter), rendered as a card linking to `/events/[slug]` and tagged with `badge_label`. Exact insertion point and grouping determined in the plan after reading the listing page.

## Admin — Managed Events manager (`apps/ops/`)

Active admin is `apps/ops/` (Auth.js sessions, `/api/internal/*` routes, `serviceClient()`). Clone the **News editor** pattern.

- **Route:** `apps/ops/src/app/(app)/managed-events/` — `page.tsx` + `_components/ManagedEventsTab.tsx` (list view + editor view, `editingId` state).
- **Nav:** register in `apps/ops/src/components/shell/Rail.tsx` (Catalogs group), label "Managed Events".
- **API:** `apps/ops/src/app/api/internal/managed-events/route.ts` (GET list, POST create) + `[id]/route.ts` (PATCH, DELETE). Each handler: `const session = await auth(); if (!session?.user?.isOperator) return 401;` then `serviceClient()`.
- **Editor fidelity — balanced (typed fields + repeatable rows):**
  - Typed inputs: name, slug, wordmark, badge_label, active toggle, status_override select, country, location, venue, starts_at, ends_at, prize_pool, cover_image_url, ticket_url, footnote, sort_weight.
  - Repeatable add/remove rows for **watch_links**, **divisions → teams → players**, and **format.day_points** + **format.blurbs**. No raw JSON editing for these.
  - `results` (standings/matches): editor support is **Phase 2** — schema + page rendering ship now, the editor rows come later. (Avoids scope creep; the page already renders results if seeded.)
  - "Preview" link opens `/events/[slug]` (works once `active`, or via a preview token — decide in plan).
  - Slug uniqueness validated on save; auto-suggest from name.

## Seed

After the system is in place, seed the **Reserve Cup Marbella 2026** row (Jun 18–20, Puente Romano, men's roster from confirmed Miami split, women's division as a "roster soon" placeholder, watch_links for YouTube/DAZN/Mediaset/ESPN/Ticketmaster, format with day-points) — via the admin UI (preferred) or a one-off migration/insert. Several values are **provisional** (team names/splits, women's roster, prize pool) and flagged as operator-editable.

## Testing

- **Pure helpers** (unit, vitest): `effectiveStatus(event, now)` (override + each date boundary); the managed-event → carousel-card mapping; slug validation. These are the logic worth testing in isolation.
- **API routes:** auth gate (401 without operator), create/patch/delete round-trip against a test row.
- **Manual/preview:** render `/events/reserve-cup-marbella-2026` locally and verify against the approved mockup; confirm the card appears in the home carousel and links correctly.

## Files (anticipated)

| Area | Path |
|---|---|
| Migration | `supabase/migrations/<ts>_managed_events.sql` |
| Public page | `src/app/[locale]/(app)/events/[slug]/page.tsx` (+ components) |
| Status helper | `src/lib/managed-events.ts` (`effectiveStatus`, card mapping) |
| Home injection | `src/app/[locale]/(app)/home/page.tsx`, `src/components/home/LiveTournamentsCarousel.tsx` |
| Listing injection | `/tournaments` listing page |
| i18n | `src/messages/{en,es,pt,it,fr}.json` → `events.*` |
| Admin page | `apps/ops/src/app/(app)/managed-events/` |
| Admin API | `apps/ops/src/app/api/internal/managed-events/route.ts` + `[id]/route.ts` |
| Admin nav | `apps/ops/src/components/shell/Rail.tsx` |

## Revision 2 (2026-06-09) — tournament-detail chrome + clickable players

After reviewing v1 locally, the public page is re-framed to match the **tournament-detail page** look, and lineup players become linkable to real profiles.

- **Page chrome:** `/events/[slug]` now renders a **collapsing cover header** (cover image + status/badge pills + wordmark + name + flag + location·venue·dates) and a **`SlidingInkTabs`** bar. Reuses the generic `SlidingInkTabs` and `TournamentCoverImage` primitives + design tokens; does **not** refactor or reuse the heavy tournament page / `V3Overview` (which is coupled to match/draw data). The header is a new managed-event-specific component that mirrors the tournament hero visually.
- **Tabs:** **Overview** (where-to-watch · event info · format · live-note · tickets · footnote) and **Lineups** (divisions → teams → players). Structured so Results/Live can become tabs later.
- **Clickable players + avatars:** each `Division` player gains an optional `player_id` (inside the `divisions` JSONB — no migration). In admin, the operator links a player via the existing `/api/internal/search-players` typeahead. On the public page, the server resolves all `player_id`s in one `players`-by-ids read and passes a `playersById` map; linked players render `<Avatar>` + `<Link href="/player/[id]">` (degrading to flag+name when unlinked). `DivisionPlayer = { name, country, player_id? }`.
- **Where-to-watch data (confirmed for Marbella 2026):** YouTube `@ReserveCupSeries` (worldwide) · DAZN (worldwide) · Mediaset/Infinity (Spain · free) · ESPN (Argentina & Chile) · Disney+ (Argentina & Chile). Source: the Marbella PR Newswire release + Haute Living. The earlier ESPN doubt is resolved — it is confirmed for South America.
- **Cover image:** sourced and uploaded to Supabase Storage (only host allowlisted in `next.config.ts` besides googleusercontent/padelfip), then seeded onto `cover_image_url`.
- New i18n keys: `events.tabOverview`, `events.tabLineups`.

## Open questions (resolve in plan)
- Preview of inactive events in admin (preview token vs. require `active`).
- Exact `/tournaments` listing insertion point + ordering relative to synced tournaments.
- Whether the home back-window cutoff for finished managed events should match the real-tournament 48h or be configurable.

# In-page Projection tab — speed + deep-link

**Date:** 2026-06-17
**Status:** Approved design, pre-implementation
**Branch:** `feat/projection-inpage-tab`

## Problem

The tournament-detail page (`src/app/[locale]/(app)/tournaments/[id]/page.tsx`) is a client
component whose tabs (Resumen/overview, Historia/story, Partidos/matches, Cuadro/draw) switch via
React state — instant, no navigation, hero stays mounted, no scroll reset. Deep-linking works
because `?tab=` is read on mount.

The **Projection** tab broke this pattern (shipped in PR #548): clicking it does
`router.push('/tournaments/<id>/projection?category=…')` — a full route navigation to a separate
server-rendered page. Observed consequences (reproduced + network-captured on FIP Platinum Lusitania):

1. **No `loading.tsx`** on the route → the click does nothing visible until the server render
   returns (server fetches rows/names/meta/categories). Feels dead, then snaps.
2. **Header swaps + scroll resets** → the route renders a lightweight `TournamentProjectionHeader`
   instead of the page's collapsing cover hero (`hasCoverHero:false`, `scrollY:0` after click).
3. **Rows fetched 3×** → the server route fetches projection rows for its SEO block, then
   `ProjectionRouteClient` passes `matches={[]}` and `ProjectionTab` refetches the *same*
   `tournament_projections` query **twice** client-side (driving a skeleton flash). Avatars load
   in a separate `players?id=in.(…)` request and pop in late.
4. The navigation also re-runs heavy, unrelated chrome queries (500-row matches join,
   broadcasters, where-to-watch, FIP streams).

## Goal

Make Projection behave like the other tabs — instant client switch, shared hero, no scroll reset —
**while keeping** shareable deep links (tab + pair) and the server route for SEO/crawlers.

## Design

### 1. Render in-page (speed)

In `page.tsx`:

- Add a tab panel `{pageTab === 'projection' && <ProjectionTab … />}` alongside the existing panels.
- Change the `SlidingInkTabs` `onChange`: for `'projection'`, call `markProjectionSeen()` +
  `setPageTab('projection')` — **drop the `router.push`**.
- Add `'projection'` to the initial-tab mapping (the `useState` initializer that reads `paramTab`)
  so `?tab=projection` mounts straight into the tab.
- **Remove** the legacy effect (current lines ~273-279) that redirects `?tab=projection` → the route.
- Pass the **real `matches={allMatches}`** the page already holds (the route passes `matches={[]}`),
  so `buildPlayerLookup` resolves names directly. Category = the page's existing `genderFilter`
  (`'men'|'women'`).

Net data cost per open: **one** client `tournament_projections` fetch (via `ProjectionTab`'s existing
`useProjection`) — down from server-fetch + 2 client refetches. The hero/`SlidingInkTabs` stay mounted;
no scroll reset.

### 2. Deep-linking (tab + pair)

- **Tab + category:** `?tab=projection&category=men`, read on mount, honored instantly.
- **Pair (shareable in-app):** sync the selected pair into the URL **shallowly** via
  `router.replace(url, { scroll: false })` — same route, no nav, no scroll jump — as
  `?tab=projection&category=men&pair=<slug>`. Slug uses the **canonical** form from
  `pairSlugFromNames` (`src/lib/projection-slug.ts`) for parity with the SEO route.
  Switching away from the Projection tab clears `?pair` (and may drop `?tab`).

- **Slug resolution lives inside `ProjectionTab`** — it is the only component with `rows` + names.
  Add two optional props:
  - `initialPairSlug?: string | null` — resolved to a pair (and `view:'road'`) in an effect once
    `rows` load, via a locally-built `buildSlugIndex(rows, nameById)` + `resolvePairSlug`. Applied
    once; must not fight subsequent user navigation.
  - `onPairSlugChange?: (slug: string | null) => void` — emitted whenever the selected pair changes
    (canonical slug, or `null` when returning to the list). `nameById` is built from
    `enrichedLookup`/`images` inside the component.

  The existing `initialPairKey` / `onPairChange(pairKey)` props are **left untouched**, so the
  current `ProjectionRouteClient` usage keeps working. In-page passes the slug-based props; the route
  keeps the key-based props.

### 3. SEO route stays as-is

Keep `/tournaments/[id]/projection` and `/projection/[pair]` exactly as they are (server-rendered,
sitemap entries, PR #548 work intact). The in-app tab **never navigates there**.

**No human-redirect** from the route to `?tab=projection`: redirecting all hits would feed crawlers a
redirect into a client-rendered shell and defeat the route's SEO purpose. Direct human hits (Google,
external shares) still get the server-rendered page, which renders fine for humans too.

## Components & boundaries

| Unit | Change | Contract |
|---|---|---|
| `page.tsx` (TournamentDetail) | render `ProjectionTab` in-page; tab handler → state; init from `?tab`/`?category`/`?pair`; shallow URL writer | owns `pageTab` + URL sync |
| `ProjectionTab.tsx` | add optional `initialPairSlug` + `onPairSlugChange`; build slug index internally when they're set | unchanged for existing `initialPairKey`/`onPairChange` callers |
| `ProjectionRouteClient.tsx` | unchanged | still drives the SEO route |
| `projection-slug.ts` | reused as-is (`buildSlugIndex`, `resolvePairSlug`, `pairSlugFromNames`) | — |

## Edge cases

- **Initial slug resolution is async** (needs `rows`): resolve in an effect, apply once (guard ref),
  don't override a user tap that happens during load.
- **Unknown/stale `?pair` slug:** `resolvePairSlug` returns null → stay on the list view (no crash).
- **Reversed-order slug** (`apellido2-apellido1`): `resolvePairSlug` resolves it; in-page we just
  load the pair (no 308 needed — shallow param, not a route). Optionally rewrite to canonical via a
  `replace`, but not required.
- **Switching gender (M/W) while a pair is selected:** clear `?pair` (the pair belongs to one
  category); fall back to the list for the new category.
- **Two URL forms for a pair coexist:** in-app `?tab=projection&pair=<slug>` (fast) and SEO
  `/projection/<slug>` (crawlable). Intentional.
- **Slug parity risk:** in-page builds `nameById` from `matches`+images; the SEO route builds it from
  `fetchPlayerNames`. If a name differs between sources the slug could differ. Low risk; acceptable.

## Out of scope

- Consolidating `ProjectionRouteClient` onto the new slug-sync mechanism (leave it working;
  possible follow-up).
- Changing the projection data model, worker, or `useProjection` fetch itself.

## Testing

- Unit: `ProjectionTab` slug-sync — `initialPairSlug` resolves to the right pair once rows load;
  `onPairSlugChange` emits canonical slug on selection and `null` on return-to-list; unknown slug →
  list view. (Pure-ish logic; mock `useProjection`.)
- Manual (browser, FIP Platinum): tab click is instant, hero persists, no scroll jump; `?tab=projection`
  deep-link mounts the tab; selecting a pair updates `?pair=<slug>` without navigation; reloading that
  URL restores the pair; switching to another tab clears `?pair`; the SEO route still renders
  server-side.
- Confirm only **one** `tournament_projections` request fires per open (network panel).

## Success criteria

- Clicking Projection is visually indistinguishable in speed from clicking Cuadro/Partidos.
- Hero stays; no scroll reset.
- `?tab=projection[&category][&pair=<slug>]` deep-links work and are shareable.
- SEO route + sitemap unchanged.
- One client fetch of projection rows per open (no triple fetch).

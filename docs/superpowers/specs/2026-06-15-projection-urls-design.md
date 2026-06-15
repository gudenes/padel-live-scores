# Projection URLs — Design

**Date:** 2026-06-15
**Status:** Approved (brainstorm), pending implementation plan
**Branch:** `feat/projection-urls` (off `main`)

## Problem

The tournament "Proyección" (projection / road-to-title) tab has no dedicated,
server-rendered URL. Today the whole tournament detail page is a single
`'use client'` component; tab selection lives in a `?tab=projection` query
param and the picker's selected pair + gender live only in component state.

Consequences:
- **Sharing is weak** — you can deep-link the projection tab, but not a
  *specific pair's* road-to-title.
- **No SEO** — the client shell renders no projection HTML, so crawlers see an
  empty page. (This is the same "CSR thin shell doesn't index" problem the app
  has elsewhere; projection becomes the first tab done the SEO-correct way.)
- **No distinct analytics** — every projection view is the same URL, so visits
  can't be counted per projection.

## Goals

1. **Shareable deep links** — paste a link that opens a specific pair's
   road-to-title (e.g. "here's Coello/Tapia's path").
2. **SEO / indexing** — real crawlable, server-rendered URLs per projection so
   Google can index long-tail queries ("Coello Tapia Valencia P1 projection").
3. **Analytics / linkability** — distinct URLs so projection visits are
   countable and linkable from elsewhere in the app.

Non-goals: redesigning the projection feature itself; making the *other*
tournament tabs (overview/story/matches/draw) server-rendered (out of scope —
projection only).

## Existing context

- **Data is already server-fetchable.** Projections are precomputed in
  `tournament_projections` (RLS public read), keyed by `(tournament_id,
  category)`, one row per pair with `pair_key`, `pair_player_ids`,
  `tournament_level`, `status`, `eliminated_round`, `champion_prob`,
  `finalist_prob`, `semifinal_prob`, `rounds`, `predicted_finish_round`,
  `computed_at`. The client reads it via `useProjection.ts`. Server-rendering
  is one `createServerClient()` select — no model to run.
- **The SEO pattern already exists.** `tournaments/[id]/layout.tsx` is a server
  component that does `generateMetadata`, `SportsEvent` JSON-LD, an sr-only
  `<h1>`, and editorial SSR, wrapping the client `page.tsx`. Nested routes
  under `tournaments/[id]/` inherit this layout.
- **Sitemap helpers exist.** `sitemap-tournaments.xml/route.ts` uses
  `expandPathForLocales` / `buildUrlSet` from `src/lib/sitemap-xml.ts`, and
  hreflang alternates come from `buildAlternates` in `src/lib/seo-helpers.ts`.
- **Feature flag.** The projection tab is gated by `FLAG_KEYS.PROJECTION_ENABLED`
  via the `useFeatureFlag` client hook.
- **Bounded sitemap.** `tournament_projections` only holds rows for *computed*
  tournaments, so per-pair sitemap URLs stay bounded (no all-tournaments blowup).

## URL shape (decided)

- Tournament-level: `/[locale]/tournaments/<id>/projection?category=men|women`
  - `category` is a **query param** (not a path segment): the M/W control is an
    in-page toggle, so swapping it should be an instant `router.replace` of one
    param, not a path navigation. It also keeps the `[pair]` namespace clean.
    Default = the gender that has projection data (men if both).
- Per-pair: `/[locale]/tournaments/<id>/projection/<pair-slug>`
  - Gender is **implied by the pair** (a pair belongs to exactly one category),
    so the pair URL needs no `category`.
  - `<pair-slug>` is a **readable surname slug** resolved against player IDs (see
    §2). Example: `/tournaments/<id>/projection/coello-tapia`.
- Path segment stays English (`projection`) across all locales, consistent with
  existing route segments; the `[locale]` prefix handles localization.

## Architecture

### 1. Routes (server-rendered)

Two new server components nested under the existing tournament route, both
wrapped by the existing `tournaments/[id]/layout.tsx` (inherit its tournament
JSON-LD + sr-only `<h1>`):

- **`tournaments/[id]/projection/page.tsx`** — tournament-level.
  - Server-fetches `tournament_projections` for `(id, category)` via
    `createServerClient()`.
  - Renders the seed/pair list (names + champion %) as real HTML for crawlers.
  - Hydrates the existing `ProjectionTab` client island, seeded with the fetched
    rows as `initialRows` (no loading flash; content present pre-JS).
  - `generateMetadata`: title/description/OG, canonical + hreflang via
    `buildAlternates`. `robots: noindex` when no rows (see §7).
- **`tournaments/[id]/projection/[pair]/page.tsx`** — a pair's road-to-title.
  - Resolves `[pair]` slug → a projection row (§2).
  - Renders that pair's per-round path + probabilities (from `rounds`)
    server-side, pre-selected.
  - Hydrates `ProjectionTab` with `initialRows` + `initialPairKey` so the picker
    opens on that pair.
  - `generateMetadata` per pair: e.g. *"Coello/Tapia — Road to the title ·
    Valencia P1"*.
  - Stale/unknown slug → canonical redirect or `notFound()` (§2, §7).

### 2. Pair slug — `src/lib/projection-slug.ts` (new, unit-tested)

- `pairSlug(players: {id, name}[]) => string` — surnames, `unaccent`-style
  diacritic strip, lowercased, joined with `-`, in a **deterministic order by
  player id** so the slug is stable regardless of pair1/pair2 ordering.
  Example: `coello-tapia`.
- `resolvePairFromSlug(rows, slug) => { row, canonicalSlug } | null` — matches a
  slug against each row's `pair_player_ids` (by recomputing each row's canonical
  slug and comparing). Returns the matched row plus its canonical slug.
- **Canonical handling:** if the requested slug differs from the row's canonical
  slug (name changed, abbreviated, reordered) but still resolves to exactly one
  row → **308 redirect** to the canonical URL. Ambiguous or no match →
  `notFound()`.
- `pair_key` is the stable fallback identity carried in the data; slugs are a
  presentation layer over the IDs, never the source of truth.

### 3. Shared chrome (the bounded refactor)

Extract the tournament **hero** + **tab strip** into shared presentational
components used by *both* the client `page.tsx` and the new server projection
routes, so navigating between them (Next soft nav) looks like a seamless tab
switch.

- New `TournamentHero` and `TournamentTabBar` components (extracted from the
  current inline JSX in `page.tsx`).
- The "Proyección" tab becomes a `<Link href=".../projection?category=…">`
  instead of an in-page state toggle. The other tabs remain `?tab=` on
  `page.tsx`.
- Active-state derivation: projection tab active when pathname matches the
  projection route; other tabs active via `?tab=`.
- The collapsing-on-scroll hero behavior stays a small client wrapper reused by
  both surfaces (server route renders the static hero markup; a thin client
  island drives the scroll collapse + M/W toggle + FOLLOW).

### 4. SEO surface

- `generateMetadata` on both routes (titles/description/OG, canonical +
  hreflang via `buildAlternates`).
- New child sitemap **`sitemap-projections.xml`** driven by
  `tournament_projections` rows: tournament-level URL (per category present) +
  per-pair URLs, each `expandPathForLocales` across the 5 locales. Registered in
  the sitemap index. Omitted entirely when the feature flag is off.
- Optional lightweight JSON-LD on the pair page (breadcrumb / `WebPage` `about`
  the tournament) — kept modest; the tournament `SportsEvent` JSON-LD already
  comes from the parent layout.

### 5. Interaction & data flow

- **Crawler / first paint:** server fetch → HTML containing pair names + % →
  indexable, no JS needed.
- **Interactive:** `ProjectionTab` client island hydrates over the server HTML.
  Picking a pair → soft-navigate to `/projection/<slug>` (server provides that
  pair's metadata + pre-selected content). M/W toggle → `router.replace`
  swapping `?category` on the tournament-level route.
- **Analytics:** distinct URLs give per-projection counting for free; the
  pair-level path enables linking projections from home spotlight / feed / push
  later.

### 6. Feature-flag gating (server)

The routes must respect `PROJECTION_ENABLED` server-side:
- Route handler reads the flag server-side → `notFound()` when off.
- `sitemap-projections.xml` emits nothing when off.

**Open implementation detail to verify in the plan:** whether
`FLAG_KEYS.PROJECTION_ENABLED` is server-readable today or client-only. If
client-only, add a small server read path (e.g. a server flag helper reading the
same source the `useFeatureFlag` hook reads).

### 7. Error handling

- **Unknown pair slug:** resolvable to one row → 308 canonical redirect;
  otherwise `notFound()`.
- **No projections for `(tournament, category)`** (pre-draw / not yet computed):
  render a graceful server empty state **+ `robots: noindex`**, mirroring the
  existing ghost-row guard in `layout.tsx` so hollow pages never get indexed.
- **DB unavailable:** render the shell without crashing (try/catch like
  `layout.tsx`), no JSON-LD.
- **Feature flag off:** `notFound()`.

### 8. Testing

- **Unit** (`src/lib/__tests__/projection-slug.test.ts`): slug generation
  (surnames, diacritics, deterministic id ordering), `resolvePairFromSlug`
  (exact match, reordered slug → canonical, unknown → null, two rows that would
  collide on surname).
- **E2E (Playwright):**
  - `/projection` server HTML contains the seed list (names + %) — view-source
    assertion, proving SEO content is present pre-JS.
  - `/projection/<pair>` opens with that pair pre-selected.
  - M/W toggle swaps `?category` without a hard navigation.
  - Stale pair slug 308-redirects to canonical.
  - Flag-off → 404.
- **SEO proof:** `curl` the route and confirm server HTML carries the projection
  content + correct `<title>` / canonical / hreflang.

## Files (anticipated)

New:
- `src/app/[locale]/(app)/tournaments/[id]/projection/page.tsx`
- `src/app/[locale]/(app)/tournaments/[id]/projection/[pair]/page.tsx`
- `src/lib/projection-slug.ts` + test
- `src/app/sitemap-projections.xml/route.ts`
- `TournamentHero` + `TournamentTabBar` components (extracted)
- possibly a server `fetchProjections(supabase, id, category)` helper shared with
  `useProjection.ts`

Modified:
- `src/app/[locale]/(app)/tournaments/[id]/page.tsx` — Projection tab → `<Link>`;
  consume extracted hero/tab components; remove the in-page projection branch.
- `ProjectionTab.tsx` — accept `initialRows` / `initialPairKey`; drive pair
  selection through the URL.
- sitemap index — register `sitemap-projections.xml`.

## Risks

- **Shared-hero extraction (§3)** is the main effort/risk: the current hero +
  tab strip are entangled with the 2,467-line client page's scroll/collapse and
  M/W state. Mitigation: extract presentational markup, keep the collapse/toggle
  as a thin client island reused by both surfaces.
- **Feature-flag server read (§6)** may need a new server path if the flag is
  client-only today.

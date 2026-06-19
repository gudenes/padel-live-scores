# Graceful 404 for orphaned entity pages — Design

**Date:** 2026-06-19
**Status:** Approved (brainstorming)
**Branch:** `fix/orphan-entity-404`

## Problem

A user landed on `https://padelnachos.com/pt/tournaments/702e6071-7deb-4eb4-b639-50b04b97d3e9`.
That UUID no longer exists in the database — verified absent from `tournaments`
(by `id`, `padelapi_id`, `fip_id`), and nothing references it (`matches`,
`entity_external_ids`, `tournament_draws` all empty).

The detail route `/[locale]/(app)/tournaments/[id]/page.tsx` is `'use client'`,
so it **always returns HTTP 200 with a blank shell**, then fetches the tournament
in the browser. When the row is gone, `activeTournamentObj` is `null` and nothing
renders — the user sees an empty page.

### Where the dead links come from

Tournaments (and players, and matches) get removed by:

- **Merges** — `scripts/merge-tournament-duplicates.ts` redirects FKs to the
  survivor and **deletes the losing row, leaving no old→new trail**.
  `scripts/merge-duplicate-players.ts` does the equivalent for players.
- **Hard deletes / cleanup** — `scripts/cleanup-orphan-tournaments.ts`,
  `scripts/hard-delete-tournament-pg.mjs`, and the dedup-* match scripts.

Old URLs survive in external shares, the search index, and already-sent push
notifications. Because merges keep no alias mapping, we **cannot retroactively
redirect** an already-deleted ID to its survivor — the trail is gone. The only
correct, complete fix for existing dead links is to **fail gracefully**.

## Decisions (from brainstorming)

1. **Behavior:** graceful **HTTP 404** + a friendly "not found" page. No
   survivor redirect (no trail exists to build one from).
2. **Coverage:** all three orphan-prone detail routes — **tournaments, players,
   matches**.
3. **404 page:** **branded** (app dark theme) and **localized** in all 5 locales.

## Approach

Each of the three detail routes already has a **server `layout.tsx`** that fetches
the entity by `id` for OG metadata + JSON-LD:

- `src/app/[locale]/(app)/tournaments/[id]/layout.tsx`
- `src/app/[locale]/player/[id]/layout.tsx`
- `src/app/[locale]/match/[id]/layout.tsx`

We add a server-side existence gate to each layout's **default export** (reusing
its existing query — no new DB round-trip), and add **one shared branded
localized not-found page**.

Rejected alternatives:

- **SEO de-index only** (`robots: noindex` on missing rows) — fixes search but a
  user clicking a shared link still sees the blank shell.
- **Client-side empty state** — returns HTTP 200 (search keeps indexing the dead
  URL) and flashes the loading shell first.

## Component 1 — Server-side existence gate

In each layout's default component, after the existing entity fetch:

- **Row definitively absent** → call `notFound()` from `next/navigation`.
  PostgREST `.single()` signals this with error code `PGRST116` (or `data === null`
  with no transport error).
- **Query threw / DB unreachable** (Supabase blip, network error) → **fail open**:
  render `children` as today. We must NOT 404 the whole site during a Supabase
  incident. The layouts already wrap fetches in `try/catch` that swallow errors and
  render children — the gate must preserve that fail-open path and only `notFound()`
  on a *confirmed* empty result.

### Nuances

- **404 only on genuinely-missing rows.** The tournament layout's existing
  `isGhost` concept (row present but no `name`/`starts_at`) keeps its current
  `robots: noindex` de-index behavior — a freshly-discovered tournament
  mid-enrichment must NOT 404. The gate fires only when **no row exists at all**.
- The gate lives in the **layout component**, not `generateMetadata`
  (`generateMetadata` can't trigger the page's `notFound()`, and it keeps its
  current metadata behavior including the ghost de-index).
- `notFound()` throws a control-flow signal — it must be called **outside** any
  `try/catch` that would swallow it, or the catch must rethrow Next's
  not-found error. Implementation must verify the existence check sits where the
  thrown signal propagates (Next re-exports a recognizable error; a blanket
  `catch {}` around the check would swallow it — a real bug to avoid).

## Component 2 — Branded localized not-found page

Add `src/app/[locale]/not-found.tsx` (server component).

`notFound()` thrown from any of the three layouts bubbles to the nearest
`not-found` boundary. The nearest common ancestor for all three (tournaments live
under the `(app)` group; player/match live directly under `[locale]`) is
**`[locale]/`** — so one file covers all three entity types.

Bonus: it also upgrades the **existing** `notFound()` calls in
`matches/[date]/page.tsx` and `news/[slug]/page.tsx` from Next's default unstyled
404 to this branded page.

- **Styling:** dark theme matching the app (`#1A1A1A` base, brand greens),
  reusing existing patterns/components (e.g. `EmptyState` where it fits). Centered
  message + a primary CTA button to a sensible landing (home or `/tournaments`).
- **Localization:** copy from a new `notFound` i18n namespace via `next-intl`.
  Wording is **generic** so one page serves tournaments/players/matches alike
  (e.g. *"This page doesn't exist or may have been removed."*).
- **No `(app)` chrome:** player/match live outside the `(app)` group, so the shared
  page renders without the bottom nav. Acceptable for a 404; it carries its own
  back/home link.

### Implementation caveat (verify before coding)

Per `AGENTS.md`, this is a non-standard Next 16 (16.2.0) and APIs may differ from
training data. Next 15/16 changed global-not-found handling, and `next-intl` has a
specific recipe for **localized** not-found pages (not-found components receive no
`params`; locale must come from next-intl's server context via `getLocale()` /
`getTranslations()`, and may require the request-scoped provider or a
`global-not-found.tsx`). **Confirm the exact wiring against
`node_modules/next/dist/docs/` and the next-intl docs before writing the page** —
do not assume the Next 14 pattern works.

## Component 3 — i18n strings

Add a `notFound` namespace (`title`, `body`, `cta`) to all five locale files:
`src/messages/{en,es,pt,it,fr}.json`.

## Emission side — verified, no work needed

The dead URLs originate only from external shares / search cache / already-sent
notifications — **nothing in our own surfaces generates them**:

- Sitemaps (`sitemap.ts`, `sitemap-players.xml`, `sitemap-matches.xml`) emit only
  existing rows.
- The tournament page's "previous edition" cross-links derive from live rows.
- Sent push notifications are immutable.

So a graceful 404 is the complete fix, not a band-aid.

## Testing / verification

Per the project "test locally always" rule, verify in the running app (preview
tools), not just by reading code:

- Dead tournament UUID (`702e6071-7deb-4eb4-b639-50b04b97d3e9`) →
  **HTTP 404** + branded page (not a blank shell).
- A dead player UUID and a dead match UUID → same 404 behavior.
- A real tournament / player / match → renders normally (no regression).
- Simulated DB-error path → renders `children` (fail-open), does **NOT** 404.
- A "ghost" tournament (present row, missing name/date) → does **NOT** 404, keeps
  `noindex` behavior.
- All five locales render translated copy on the not-found page.

## Out of scope

- Recording old→new merge aliases for **future** redirects (a separate,
  forward-looking enhancement; would touch the merge scripts + add a mapping
  table). Today's fix is graceful failure only.
- Any change to sitemap/notification emission (verified unnecessary above).

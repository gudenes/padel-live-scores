# Rankings SSR conversion — SEO-first, multi-locale

**Status:** Approved (brainstorming)
**Owner:** TBD
**Created:** 2026-05-20
**Target:** Single PR shipping unit

## Problem

`/rankings` (and its four locale variants `/es`, `/pt`, `/it`, `/fr`) is the highest-intent organic destination on the site — queries like "ranking padel", "fip ranking", "ranking padel femenino" land here. Today the page is `'use client'` ([src/app/[locale]/(app)/rankings/page.tsx](../../src/app/[locale]/(app)/rankings/page.tsx), 594 lines) and the server HTML Googlebot receives contains:

- Localized `<title>` and `<meta description>` (good)
- No `<h1>` in any form — the layout doesn't emit one (other client pages at least ship an `sr-only` h1; rankings doesn't)
- No table content, no player names, no links to player profiles
- A skeleton loader, then JS hydrates and Supabase fetches the data client-side

This is the same client-render anti-pattern that's preventing several pages from getting indexed (see the 2026-05-20 GSC Coverage Drilldown audit). Competitors like padelscore.org serve full HTML on first byte and outrank us for ranking-related queries.

## Goals

1. **SEO-first**: server HTML on every locale URL contains the full top-100 ranking table, player names as text, real `<a href>` links to `/player/{id}`, an `sr-only` `<h1>`, localized country names, and a localized intro paragraph.
2. **Multi-locale parity**: all 5 locales (en/es/pt/it/fr) ship with the same SSR quality — no English-first compromises.
3. **No UX regression**: visible UX changes are limited to (a) faster first paint, (b) row anchors that respond to middle-click/right-click, (c) a brief loading state on the first filter toggle away from the default. Everything else (visuals, animations, swipe, search, "show more", follow buttons) is byte-identical.
4. **Architecturally clean**: page becomes a server component, with small client islands for interactivity. Smaller client bundle, faster LCP/INP, no hydration-mismatch risk.

## Non-goals

- Conversion of `/home`, `/tournaments`, `/player/{id}`, `/match/{id}` (separate specs, will reuse this pattern).
- On-demand ISR revalidation from padelgod ranking writer.
- Slug-based player URLs.
- Per-locale child sitemaps for entity routes.
- Personalized SSR (followed-player highlighting in server HTML).

## Approach

**One URL per locale, server-renders the default view (men's official, top 100).** Toggles to the other three variants (men/race, women/official, women/race) remain client-side state — they fire a Supabase fetch on first access and cache in memory. Google only indexes the default view per locale, which is acceptable because the default already captures the high-volume keyword queries.

**Full island refactor**: page itself becomes a server component, with the static table rendered as HTML on the server using a presentational `RankingsTable` component. Interactive bits (filter pills, search modal, "Show more", follow buttons) extracted into small client islands.

**ISR with 1-hour revalidate.** Padelgod publishes new rankings weekly (Mon/Tue), so 1h is well under the publish cadence. Same HTML served to every user — fully cacheable, fast TTFB.

## Architecture

```
src/app/[locale]/(app)/rankings/
├── layout.tsx               — existing; add sr-only h1
├── page.tsx                 — REWRITTEN: server component, ~120 lines
├── RankingsInteractive.tsx  — NEW: client island, ~250 lines
├── RankingsTable.tsx        — NEW: presentational (server+client safe), ~120 lines
├── FilterPills.tsx          — NEW: client, ~80 lines
├── SearchModal.tsx          — NEW: client, ~80 lines
├── shared.ts                — NEW: types, constants, RankBadge, DeltaChip
└── jsonld.ts                — NEW: buildRankingsJsonLd(players, locale, baseUrl)
```

Per-file responsibilities documented in detail in the brainstorming session. The key boundary:

- `RankingsTable.tsx` is purely presentational, has no `useState`/`useRouter`, and uses `<Link>` from `@/i18n/navigation`. Renderable from both server (initial paint) and client (post-toggle re-render).
- `RankingsInteractive.tsx` owns all state. On mount, its initial state matches the props passed from `page.tsx`, so React reconciles the SSR'd table without mutation.
- Per-row `<FollowButton>` is a client component already; Next.js infers the boundary automatically.

## Data flow

**Initial GET `/{locale}/rankings`:**

1. `proxy.ts` resolves locale.
2. `layout.tsx` generates metadata + `<h1 class="sr-only">{seo.rankings.title}</h1>`.
3. `page.tsx` (server) runs in parallel:
   - `supabase.from('players')` SELECT 100 columns × `category='men' AND ranking IS NOT NULL ORDER BY ranking LIMIT 100`
   - `supabase.from('players')` SELECT `ranking_date` LIMIT 1, ordered desc
4. `page.tsx` renders:
   - Locale-keyed intro paragraph (`rankings.intro.men_official` for the default)
   - `<RankingsTable players={top100} rankType="official" locale={locale} />` (rendered as static HTML on server)
   - `<script type="application/ld+json">` with ItemList (100 items, `inLanguage: locale`)
   - `<RankingsInteractive initialPlayers={top100} initialRankingDateFormatted="13 May 2026" locale={locale} />`
5. Response: ~50–60 KB HTML. ISR caches for 1h. Same HTML across users.

**Hydration:**

- `RankingsInteractive` mounts with initial state matching SSR'd table → no DOM mutation.
- Auth context loads → per-row `FollowButton` islands upgrade from neutral placeholder to followed/unfollowed (no layout shift, same DOM dimensions).
- `markRankingsVisited(week)` fires.

**User toggles (men→women, official→race):**

- `RankingsInteractive` sets loading state, fires Supabase query (full top-1000 for the new variant), swaps state, re-renders `RankingsTable` with new data.
- Variant cache (`useRef<Map<string, Player[]>>`) prevents re-fetch on repeated toggles within the session.
- `requestId` ref guards against out-of-order responses when toggling rapidly.

**Show more (50 → 100 → 1000):**

- SSR already provides 100 rows visible by default (raise initial `visibleCount` from 50 to 100).
- After hydration, schedule a background fetch for rows 101–1000 (`requestIdleCallback` where available, `setTimeout(..., 0)` fallback for Safari).
- "Show more" reveals from the cache, or shows a spinner if cache hasn't filled yet.

## Multi-locale SEO additions

1. **Country names**: replace the hardcoded English `COUNTRY_NAMES` map ([src/app/[locale]/(app)/rankings/page.tsx:34-45](../../src/app/[locale]/(app)/rankings/page.tsx:34-45)) with `new Intl.DisplayNames([locale], { type: 'region' }).of(code)`. Runtime locale-aware.
2. **"Updated" date**: server-side format using `next-intl` `getFormatter(locale).dateTime(date, { dateStyle: 'long' })`. Passed to client as pre-formatted string to avoid hydration mismatch.
3. **Sitemap**: [src/app/sitemap-static.xml/route.ts](../../src/app/sitemap-static.xml/route.ts) — loop over `LOCALES` and emit 5 entries for `/rankings` (one per locale). Expanding the same treatment to `/home`, `/matches`, `/feed`, `/about`, and adding the missing `/tournaments`, is a separate follow-up to keep this PR's blast radius narrow.
4. **JSON-LD `inLanguage`**: include `inLanguage: locale` and a localized `name` field (e.g., "Ranking FIP de pádel masculino" on `/es/rankings`). Sourced from `seo.rankings.jsonld_name` translation key.
5. **Intro paragraph**: 60–120 word locale-keyword-rich paragraph above the table. 4 variants × 5 locales = 20 new translation strings under `rankings.intro.{men_official|men_race|women_official|women_race}`. Default (`men_official`) renders SSR-side; other variants swap when the user toggles.

## Component-level boundaries

| Component | Renders | Owns state? | Imports |
|---|---|---|---|
| `layout.tsx` | server | no | `next-intl`, `buildPageMetadata` |
| `page.tsx` | server | no | `createServerClient`, `RankingsTable`, `RankingsInteractive`, `buildRankingsJsonLd`, `next-intl/server` |
| `RankingsTable.tsx` | server-and-client safe | no | `@/i18n/navigation` Link, `shared.ts`, `FollowButton` |
| `RankingsInteractive.tsx` | client | yes (rankType, gender, players, loading, search, visibleCount) | `supabase`, `useSwipeTabs`, `useRouter`, `RankingsTable`, `FilterPills`, `SearchModal` |
| `FilterPills.tsx` | client | no (controlled) | `useSwipeTabs` |
| `SearchModal.tsx` | client | yes (query, results) | `shared.ts` (RankBadge, country helpers) — renders its own minimal row markup, not RankingsTable |
| `shared.ts` | both | no | none (pure presentational + types + Intl) |
| `jsonld.ts` | server-imported pure fn | no | none |

## Error handling

| Scenario | Behavior |
|---|---|
| Supabase server fetch errors | Catch, log to Sentry, render `<RankingsInteractive initialPlayers={[]}/>`. Client effect runs, falls back to client fetch. No 500. |
| Empty result (rankings not yet published) | Render page chrome + localized "rankings will appear here" empty state. Client effect still attempts a fetch. |
| `createServerClient` throws (env misconfig) | Same as above — degrade to client-only render. Mirror pattern from [src/app/[locale]/match/[id]/layout.tsx](../../src/app/[locale]/match/[id]/layout.tsx). |
| Hydration drift on `formatYearWeek` / date formatting | Mitigated: server formats once, client uses string verbatim. No `new Date()` / `Date.now()` in render path. |
| Country flag path mismatch | `shared.ts` conversion is pure (no runtime input) — safe both sides. |
| FollowButton CLS | Server renders neutral placeholder with identical dimensions. Post-hydration swap to active state, no layout shift. |
| Race condition on rapid toggle | `requestId` ref discards stale responses. |

## Testing

**Local verification (preview server):**

1. View-source on all 5 locales — confirm top-100 rows present, 100 `<a href>` to `/player/{id}`, `<h1 class="sr-only">` matches locale, JSON-LD has `inLanguage` matching URL, country names in correct language, intro paragraph translated, hreflang complete.
2. Disable JS — table fully usable as read-only HTML.
3. Re-enable JS — zero hydration warnings in console.
4. Toggle men→women→men, official→race→official — confirm caching prevents re-fetch.
5. Search modal, "Show more", swipe gestures, follow buttons — confirm behavior unchanged.
6. Logged-in user with followed players — follow buttons upgrade without layout shift.

**Unit tests:**

- `jsonld.test.ts` — `buildRankingsJsonLd` shape, item count, URL format, `inLanguage` value across 5 locales.
- `RankingsTable.test.tsx` — server-renderable via `renderToStaticMarkup`. Row count, anchor `href`s, country name formatting per locale.
- `RankingsInteractive.test.tsx` — toggle interactions, requestId race-condition guard, variant cache hit.

**Post-deploy verification:**

1. `curl https://padelnachos.com/es/rankings | grep -c '/player/'` → expect ≥100.
2. Google Rich Results Test on each locale URL — confirm ItemList parses with 100 items.
3. Re-submit sitemap.xml in GSC.
4. +14 day reminder to check GSC Coverage drilldown for `/rankings` URLs across locales.

## Rollout

- Single PR, no feature flag. Backward-compatible.
- Merge during low-traffic UTC window. Monitor Sentry for hydration mismatches in the first hour.
- Vercel deploy is atomic. No DB migration. Padelgod unchanged. No env vars.
- Rollback: revert PR. Single click.

**Rollback triggers:**
- Sentry hydration mismatches on `/rankings` route → revert.
- LCP regression on GSC Core Web Vitals → investigate (likely a tuning fix, not an undo).

## Out of scope / follow-ups

- On-demand ISR revalidation webhook from padelgod ranking writer (1h is good enough for now).
- SSR conversion of `/home`, `/tournaments`, `/match/{id}`, `/player/{id}` — separate plans, will reuse this pattern.
- Expanding `sitemap-static.xml` to emit all 5 locale variants for `/home`, `/matches`, `/feed`, `/about`, plus adding the missing `/tournaments` entry.
- Per-locale child sitemaps for entity routes (matches/players/tournaments).
- Slug-based player URLs (e.g., `/player/martin-di-nenno-{shortid}`).

## Open questions

None at design freeze. All decisions captured in the brainstorming transcript.

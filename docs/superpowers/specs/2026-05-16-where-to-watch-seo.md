# Where-to-Watch SEO (BroadcastEvent JSON-LD + sr-only summary) — design spec

## Summary

Two server-side changes layered on top of the shipped Where-to-Watch UI (matches-page pill, tournament Overview inline panel, match-detail banner) so that Google sees broadcaster information when crawling, and can populate its "where to watch" carousel with our entries.

1. **`BroadcastEvent` JSON-LD.** Extend the existing `SportsEvent` JSON-LD on both `match/[id]/layout.tsx` and `tournaments/[id]/layout.tsx` with a `publication: BroadcastEvent[]` array. One entry per broadcaster + one for the YouTube channel.
2. **sr-only "where to watch" sentence.** Append a single sentence listing the broadcasters (with country tags) to the existing `<header className="sr-only">` block in both layouts. Visible to screen readers + crawlers, invisible to sighted users.

Visible UI does not change — the interactive panel/banner/pill all stay exactly as shipped. The interactive widgets remain client-rendered (region-aware, picker, popup); these two additions are the canonical crawlable layer.

Builds on:
- [`docs/superpowers/specs/2026-05-15-where-to-watch-unification-design.md`](2026-05-15-where-to-watch-unification-design.md) — shipped: pill + popup
- [`docs/superpowers/specs/2026-05-16-match-detail-where-to-watch-banner.md`](2026-05-16-match-detail-where-to-watch-banner.md) — shipped: banner + inline panel

## Problem

The shipped Where-to-Watch components solve the human discoverability problem (regional broadcasters surface in the popup/inline panel). But they're all `'use client'` components that hydrate post-load — Googlebot crawls the initial HTML and sees:

- An empty `<div>` where the panel/banner will mount
- No structured data linking the match/tournament to its broadcasters

Users searching "where to watch Premier Padel Spain" or "Tapia vs Coello live stream" are well-served once they land on our pages, but Google has no signal we have the answer. The page ranks for the player/match name but loses the broadcast-intent query.

## Approach

Two artifacts added to each of the two existing server-side layouts. No new tables. No migrations. No new UI.

### 1. `publication: BroadcastEvent[]` on existing `SportsEvent`

The existing JSON-LD in `match/[id]/layout.tsx` (around line 202) and `tournaments/[id]/layout.tsx` (around line 105) already builds a `SportsEvent` object. We append a `publication` array whose entries follow schema.org's `BroadcastEvent` → `BroadcastService` chain.

Shape for a YT live entry:

```json
{
  "@type": "BroadcastEvent",
  "name": "Premier Padel on YouTube",
  "isLiveBroadcast": true,
  "videoFormat": "HD",
  "publishedOn": {
    "@type": "BroadcastService",
    "name": "Premier Padel",
    "broadcastDisplayName": "Premier Padel",
    "url": "https://www.youtube.com/@PremierPadelOfficial",
    "broadcaster": {
      "@type": "Organization",
      "name": "Premier Padel"
    }
  }
}
```

Shape for a regional broadcaster entry:

```json
{
  "@type": "BroadcastEvent",
  "name": "Watch on Movistar Plus+ in Spain",
  "isLiveBroadcast": false,
  "publishedOn": {
    "@type": "BroadcastService",
    "name": "Movistar Plus+",
    "url": "https://www.movistarplus.es/...",
    "areaServed": {
      "@type": "Country",
      "name": "Spain"
    },
    "broadcaster": {
      "@type": "Organization",
      "name": "Movistar Plus+"
    }
  }
}
```

**Scope of entries (locked: option B from brainstorming):** every active broadcaster with `channel_id` matching the page's circuit, plus the active YouTube channel for the circuit. With ~398 broadcasters currently (all Premier Padel), each page emits 1 YT entry + ~398 country entries when the circuit is Premier Padel, ~1 YT entry + 0 broadcasters for FIP. Per-page JSON-LD payload grows by roughly 60–100 KB raw, ~10–15 KB gzipped.

> Why no country filter: the JSON-LD is the canonical crawlable view. Google personalizes the "where to watch" panel per searcher; we just provide the full set of supported regions. Per-user country preference still drives the interactive panel via cookie/localStorage; it doesn't touch this server-side data.

### 2. sr-only sentence

Both layouts already emit a `<header className="sr-only">` containing an `<h1>` and a fact list. We append one `<p>` after the fact list:

> `<p>Watch [Match Name] live on Premier Padel YouTube, Movistar Plus+ (Spain), Red Bull TV (Spain, Italy, Germany, UK, US, +8 more), Sky Sport (Italy, Germany), DirecTV (Argentina, Brazil, Chile, +5 more), and 18 other regional broadcasters.</p>`

Format rules:
- Lead broadcaster: YouTube channel name (always free, always global)
- Then top broadcasters by number of country licenses (most common first)
- Show up to 4 country names per broadcaster, then "+N more"
- Cap at 5 named broadcasters, append "and N other regional broadcasters"
- Same sentence pattern on the tournament layout, swapping the match name for the tournament name

The cap keeps the sentence under ~50 words even when many broadcasters exist.

Worked example: with the current data (PP YouTube + Movistar Plus+/ES, Red Bull TV/12 countries, Sky Sport/2 countries, DirecTV/8 countries, beIN Sports/8 countries, plus ~370 more single-country broadcasters), the rendered sentence becomes roughly:

> *Watch Buenos Aires P1 Final live on Premier Padel YouTube, Movistar Plus+ (Spain), Red Bull TV (Spain, Italy, Germany, UK, +8 more), Sky Sport (Italy, Germany), DirecTV (Argentina, Brazil, Chile, Peru, +4 more), and 370 other regional broadcasters.*

### 3. Data fetch

Each layout already runs server-side Supabase queries for the match/tournament. Add one helper:

```ts
// src/lib/where-to-watch/fetch-seo-broadcasters.ts
export async function fetchSeoBroadcasters(
  supabase: SupabaseClient,
  channelAbbr: string | null,
): Promise<{
  channelMeta: ChannelMeta | null
  liveStreams: Array<{ videoId: string; title: string }>
  broadcasters: BroadcasterRow[]
}>
```

`channelAbbr` derives from the match's or tournament's `tournament.level` via the existing `levelToChannelAbbr` lookup. Returns empty data when the circuit isn't tracked. The two layouts call this in parallel with the existing match/tournament queries via `Promise.all`.

When `channelMeta` is null (unknown circuit, e.g. legacy `wpt_*` levels), both the JSON-LD `publication` array and the sr-only sentence are omitted — clean degradation.

## Component structure

```
src/lib/where-to-watch/
  fetch-seo-broadcasters.ts        — new: scoped server query for the SEO layer
  build-broadcast-jsonld.ts        — new: pure fn (channelMeta, liveStreams, broadcasters) → BroadcastEvent[]
  build-seo-summary.ts             — new: pure fn → sr-only sentence string (i18n-aware)
  __tests__/
    build-broadcast-jsonld.test.ts — covers YT-only, YT+broadcasters, empty, special chars in names
    build-seo-summary.test.ts      — covers cap behaviour, country count formatting, en/es/pt/it/fr

src/app/[locale]/match/[id]/layout.tsx
  — Add: parallel fetchSeoBroadcasters call
  — Modify: jsonLd construction includes `publication: buildBroadcastJsonLd(...)` when non-empty
  — Modify: sr-only header appends the SEO sentence when non-empty

src/app/[locale]/(app)/tournaments/[id]/layout.tsx
  — Same three changes
```

Both pure functions stay testable in isolation. The fetch helper is the only thing that hits Supabase; the JSON-LD + sentence builders are deterministic given their inputs.

## i18n

The sr-only sentence is locale-aware. New keys under existing `whereToWatch.*` namespace:

```
whereToWatch.seo.summaryMatch     — "Watch {match} live on {broadcasterList} and {extra, plural, one {# other regional broadcaster} other {# other regional broadcasters}}."
whereToWatch.seo.summaryTournament — "Watch {tournament} live on {broadcasterList} and {extra, plural, ...}."
whereToWatch.seo.broadcasterCountries — "{broadcaster} ({countryList})"
whereToWatch.seo.broadcasterCountriesPlus — "{broadcaster} ({countryList}, +{extra} more)"
```

5 locales (en/es/pt/it/fr).

The JSON-LD strings (broadcaster names, country names) are sourced from DB and aren't translated — Google parses the schema regardless of page locale.

## Verification

1. **`https://search.google.com/test/rich-results`** — paste a match URL after deploy; the SportsEvent object should now show a `publication` array with the expected number of BroadcastEvent items, no validation errors.
2. **Search Console → URL Inspection** on a match page — the rendered HTML should include the new sr-only sentence and the expanded JSON-LD. Live test should match.
3. **Manual:** `curl -s [url] | grep -oE 'BroadcastEvent|BroadcastService|Watch .* live on'` returns expected counts.
4. **Lighthouse:** TTFB should not regress meaningfully (one extra parallel query, expect <50ms in p95).
5. **Snapshot tests** for the two pure builders confirm output shape across the cases listed in the test files.

## Out of scope

- Dedicated `/where-to-watch/...` landing pages (SEO lever #3 from earlier discussion). Separate spec.
- `FAQPage` JSON-LD with "Where can I watch X?" Q&A pairs. Separate spec.
- Per-locale broadcaster names (we send the DB-canonical name to Google regardless of page locale).
- Country names translation for sr-only sentence (using English names sourced from existing ISO2_TO_NAME map; future i18n pass can localize).
- Cleanup of the unused `whereToWatch.bannerWatchIn` key from the previous spec — separate cleanup PR.

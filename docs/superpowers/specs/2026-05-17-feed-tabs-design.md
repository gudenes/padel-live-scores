# Feed page — tabs & layout fix

**Date:** 2026-05-17
**Status:** Approved
**Author:** Pair-designed (operator + Claude)

## Problem

Two issues on `/[locale]/feed`:

1. **Layout bug.** The `<NewsRail>` (first-party "DESDE PADELNACHOS" hero) is rendered in [feed/page.tsx:18-23](../../../src/app/[locale]/(app)/feed/page.tsx) *above* `<FeedClient>`. Because the search bar lives inside `FeedClient`'s `<AppHeader>`, every new first-party article gets pushed above the search bar. Operator confirmed this in a screenshot.
2. **No segmentation.** The feed is a single mixed firehose of third-party articles + YouTube highlights, with a single "Saved" filter chip. No way for users to focus on one content type.

## Goals

- Fix the article-above-search-bar layout regression.
- Give users top-level tabs to focus on a single content type.
- Reuse existing patterns and queries — no new ingestion, no new schemas.
- Preserve current personalization/scoring behavior on the News tab.

## Non-goals

- No "Following" tab (needs entity tagging on articles/highlights that isn't built).
- No last-visited tab persistence (tabs are one tap away).
- No swipe-between-tabs gesture.
- No changes to `/news` route — it stays as the dedicated SEO landing page.
- No changes to scoring/feed-scoring logic.

## Design

### Tab set & order

`News (default) · Videos · Originals · Saved`

- **News** — third-party articles only.
- **Videos** — YouTube highlights only.
- **Originals** — first-party posts from `news_posts` (replaces the broken `<NewsRail>`).
- **Saved** — bookmarked articles only (promotes the existing `Saved` filter chip to a tab).

Rationale for label "Originals": matches industry convention (Netflix, Disney+, B/R) — signals "we made this" without being promotional. Translates cleanly: Originales / Originais / Originali / Originaux.

### Visual style

Reuse the chunky-tab pattern from [PicksTabs.tsx](../../../src/components/picks/PicksTabs.tsx):

- Active: `background: #7ED321` (GREEN), `color: #0a0a0a`
- Inactive: `background: #1A1A1A`, `color: #6B7280` (MUTED)
- Shape: `clipPath: polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)`
- Typography: `fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: uppercase`
- Padding: `8px 14px`
- Layout: horizontal flex with `overflow-x: auto`, `gap: 6px`

### Position & sticky behavior

Tabs sit directly below `<AppHeader>` inside `<FeedClient>`, sticky to the top of the scroll container.

```
┌─────────────────────────────────────┐
│ AppHeader (logo + search + avatar)  │  ← scrolls away
├─────────────────────────────────────┤
│ [NEWS] [Videos] [Originals] [Saved] │  ← sticky
├─────────────────────────────────────┤
│ feed content                        │
│ …                                   │
```

### URL state

Tab is reflected in the URL as a query param:

- `/feed` → News (default)
- `/feed?tab=videos`
- `/feed?tab=originals`
- `/feed?tab=saved`

Read with `useSearchParams()`. Write with `router.replace()` (no history spam — back button goes to wherever the user came from, not through every tab they tried).

Unknown values (`?tab=garbage`) fall back to News silently.

### Per-tab content

#### News tab

- Source: same `articles` query as today. The `articles` table is third-party only by design — first-party lives in `news_posts`. No additional filter needed.
- Scoring: existing `buildScoredFeed()` + `diversifyFeed()` + `capSources()`. No change.
- Personalization: existing language affinity, category prefs, channel engagement, bookmark relevance, dedup clustering. No change.
- Note: today's mixed-feed also includes videos when this query runs. On the News tab specifically, the scored feed renders **articles only** — videos drop out of the cluster list for this tab.

#### Videos tab

- Source: existing `highlights` query.
- Scoring: existing highlight scoring (channel quality, recency, country filter). No change.
- Country availability filter (`isAvailableInCountry`) preserved.

#### Originals tab

- Source: `listPublished(locale)` from [news-queries.ts:56](../../../src/lib/news-queries.ts).
- Order: chronological by `published_at desc` (already the order from `listPublished`).
- Rendering: first item gets `<NewsCard variant="hero">` (same as today's `<NewsRail>`), the rest get the default variant.
- Pagination: load all at once initially. If `news_posts` grows past ~50 published rows, revisit with infinite scroll. For now (small corpus), single-page is fine.

#### Saved tab

- Source: filter the News tab's articles to those in `bookmarkedArticles`.
- Empty state when no bookmarks (e.g. "Bookmark articles to see them here. Tap the bookmark icon on any article.").
- Localized.

### Tab visibility

All four tabs are always visible, including Saved with zero bookmarks. Tabs that appear/disappear are jarring and break URL deeplinks.

### Empty states

Each tab gets a localized empty state in `feed.empty.<tab>`. Visual style matches the existing "No content available" block in [FeedClient.tsx:932-938](../../../src/app/[locale]/(app)/feed/FeedClient.tsx) (centered, muted, 60px vertical padding).

### Loading states

Each tab uses the existing `<FeedSkeleton>` during initial load. Tab switches are instant (data already in state) — no per-tab loaders needed.

### i18n keys (new)

In `src/messages/{en,es,pt,it,fr}.json` under namespace `feed`:

| Key | EN | ES | PT | IT | FR |
|---|---|---|---|---|---|
| `tabs.news` | News | Noticias | Notícias | Notizie | Actualités |
| `tabs.videos` | Videos | Videos | Vídeos | Video | Vidéos |
| `tabs.originals` | Originals | Originales | Originais | Originali | Originaux |
| `tabs.saved` | Saved | Guardados | Salvos | Salvati | Enregistrés |
| `empty.news` | No articles yet. Check back soon. | Aún no hay artículos. Vuelve pronto. | Ainda não há artigos. Volte em breve. | Ancora nessun articolo. Torna presto. | Pas encore d'articles. Reviens bientôt. |
| `empty.videos` | No highlights available in your region. | No hay highlights disponibles en tu región. | Sem destaques disponíveis na tua região. | Nessun highlight disponibile nella tua regione. | Aucun highlight disponible dans ta région. |
| `empty.originals` | First posts coming soon. | Próximamente. | Em breve. | Prossimamente. | Bientôt. |
| `empty.saved` | Bookmark articles to see them here. | Guarda artículos para verlos aquí. | Guarde artigos para vê-los aqui. | Salva articoli per vederli qui. | Enregistre des articles pour les voir ici. |

Translation context per the project's i18n rules — keys are descriptive (`feed.tabs.*`, `feed.empty.*`) and disambiguating.

### Files to change

| File | Change |
|---|---|
| `src/app/[locale]/(app)/feed/page.tsx` | Remove `<NewsRail>` import + render. Page becomes just `<FeedClient />`. |
| `src/app/[locale]/(app)/feed/FeedClient.tsx` | Add tab state from `useSearchParams`. Render tabs row sticky below `<AppHeader>`. Switch content render based on active tab. Remove the existing "Saved" filter chip block. Add Originals query (`listPublished`). |
| `src/components/news/NewsRail.tsx` | Delete. Orphaned after removal. |
| `src/messages/{en,es,pt,it,fr}.json` | Add `feed.tabs.*` and `feed.empty.*` keys. |

### What is NOT changed

- `/news` route — keeps its SEO indexing, category filters, hreflang.
- `news_posts` schema and queries — unchanged.
- `articles` / `highlights` schemas — unchanged.
- Feed scoring (`buildScoredFeed`, `diversifyFeed`, `capSources`) — unchanged.
- `<NewsCard>`, `<VideoCard>`, `<NewsPeekSheet>`, `<SearchOverlay>` — unchanged.
- `<AppHeader>` — unchanged.

## Testing plan

- Cold visit to `/feed` lands on News tab with the same scored article list as today.
- Switching tabs updates URL to `?tab=<id>` and content swaps without a full reload.
- Direct hit to `/feed?tab=videos` lands on Videos with no flash of News.
- `?tab=garbage` falls back to News silently.
- Back button after tab switching returns to the previous page (not the previous tab).
- Bookmark an article → it appears in Saved.
- Empty Saved tab shows the localized empty state.
- Originals tab shows the first-party post that previously appeared above the search bar.
- All four tab labels render correctly in all 5 locales.
- Tabs stay pinned (sticky) during scroll.
- Tabs horizontally scroll on narrow viewports without breaking the search bar.

## Future work (deferred)

- "Following" tab — surfaces only content mentioning followed players/tournaments. Blocked on entity tagging in `articles` and `highlights` (not currently populated).
- Last-visited tab persistence — if signal emerges that users repeatedly switch on every visit, persist via localStorage.
- Swipe-between-tabs gesture — use [`<SwipeTabView>`](../../../src/components/SwipeTabView.tsx).
- Per-tab unread badges (e.g. "3 new" on News since last visit).

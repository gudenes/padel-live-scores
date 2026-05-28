# Home News Immersive Link — design

**Status:** Design (proposed)
**Author:** Claude (with @GuDenes brainstorming session 2026-05-28)
**Builds on:** [2026-05-23-immersive-news-feed-design.md](./2026-05-23-immersive-news-feed-design.md) — the V1 For You feed
**Builds on:** [2026-05-23-source-curation-tools-design.md](./2026-05-23-source-curation-tools-design.md) — admin Articles tab + V2 source curation

## 1. Goal

Stop the home page from being a *separate* news experience. Today the home rail and the For You immersive feed pull from the same `articles` table but with different filters, no dedup, and divergent tap behavior. Three concrete outcomes:

1. **Aligned corpus.** Home rail, For You, and the admin Articles tab all draw from the same underlying query. User-facing surfaces filter to `enrichment_status = 'enriched'`; the admin keeps its triage-friendly unfiltered view.
2. **Cross-source dedup.** When 3 sources cover the same story, users see one card with a `+2 sources` chip. The chip can be tapped to reveal the siblings.
3. **Click-to-immersive.** Tapping a home rail news card enters the For You overlay positioned at that article — not the source URL, not a peek sheet. Swipe down or back to dismiss returns to the home page **without a re-fetch**, scroll position preserved.

This is a UX consolidation, not a data overhaul. The pipeline keeps producing the same articles; we're aligning how they surface and how users navigate between them.

## 2. Out of scope (this ship)

- **Translating to new languages.** All 5 locales (`en`, `es`, `pt`, `it`, `fr`) are already covered by the existing Haiku translation pass for summaries. The only gap is title backfill for older articles (Section 7.3).
- **Algorithmic feed personalization** beyond what For You already does.
- **Per-cluster analytics** (which clusters drove most engagement). Deferred until clusters have a stable identity (requires pipeline-time clustering, which we explicitly rejected — see §4).
- **Native iOS/Android Capacitor sheet semantics.** The overlay uses CSS transforms + `popstate`; it does not hook into platform navigation primitives. Hardware back on Android is captured but treated as a generic popstate.
- **Replacing the regular `/feed` Videos / Originals / Saved tabs.** They keep their existing behavior — this work touches only the For You tab + the home rail.

## 3. Approaches considered

### Dedup execution

| Approach | Description | Verdict |
|---|---|---|
| **Read-time clustering** | Reuse the tested `feed-scoring.ts` token-overlap function (50% Jaccard). Computed on each fetch. No schema changes. | **Picked.** Fast enough on our corpus (~2k articles), always fresh, no migration. |
| Pipeline-time clustering | Background cron writes `cluster_id`/`cluster_role` columns. Reads filter to primaries. | Rejected: schema migration + new cron + freshness lag, all for marginal benefit at our scale. |

### Deep-link transition

| Approach | Description | Verdict |
|---|---|---|
| **Overlay-on-home** | For You renders as a `position: fixed` overlay on top of the home page. Home stays mounted, no re-fetch on dismiss. URL still updates via `pushState`. | **Picked.** User-validated via interactive mockup. Animation feels native; home state preserved naturally. |
| Route navigation | `router.push('/feed?tab=foryou&article=X')`. Standard Next.js. | Rejected: home re-renders on return, scroll/state restoration is best-effort, animation only on the outgoing page. |

### Dedup visibility

| Approach | Description | Verdict |
|---|---|---|
| Hard hide | Duplicates invisible from feed. Operator can still see them in admin. | Rejected as default — too aggressive; users may want to read alternative takes. |
| **Soft hide with reveal** | Primary card shows `+N sources` chip. Tap chip → siblings expand inline. | **Picked.** Preserves choice without cluttering the default view. |

## 4. Locked decisions

From the brainstorming Q&A:

| # | Question | Decision |
|---|---|---|
| 1 | What happens to duplicate articles? | Soft hide with `+N sources` chip on the primary |
| 2 | What does the card vs chip do? | Card → For You overlay; chip → expand inline on home rail (no nav) |
| 3 | Article corpus alignment | Enriched-only for users; admin Articles tab keeps unfiltered triage view |
| 4 | Dedup execution point | Read-time, reusing existing `feed-scoring.ts` clustering |
| 5 | Deep-link / exit animation | Overlay architecture: home stays mounted, overlay slides up/down |
| 6 | Animation timing | 280ms `cubic-bezier(0.32, 0.72, 0, 1)` (ease-out-quint) |

## 5. Architecture overview

```
                     ┌──────────────────────────────┐
                     │   src/lib/news-feed-queries  │
                     │   fetchClusteredNews()       │
                     │   • enrichment='enriched'    │
                     │   • applyDedup=true          │
                     │   • pinnedFirst=<uuid?>      │
                     └─────────┬────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
       ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐
       │ Home rail   │  │ For You     │  │ Admin       │
       │ (Highlights │  │ (overlay +  │  │ Articles    │
       │  Preview)   │  │  route)     │  │ tab         │
       └─────────────┘  └─────────────┘  └─────────────┘
                                                ▲
                                                │
                                ┌───────────────┴───────────────┐
                                │  (admin uses its OWN existing │
                                │   /api/articles route — sees  │
                                │   ALL statuses, no dedup;     │
                                │   gets a "Cluster" column +   │
                                │   "Translations" column for   │
                                │   visibility, not enforcement)│
                                └───────────────────────────────┘
```

Three rules that bind the user-facing surfaces:

1. **Corpus**: `enrichment_status = 'enriched'` AND `status = 'active'`.
2. **Dedup**: Token-overlap clustering ≥ 0.5 Jaccard. Newest article in each cluster becomes the primary.
3. **Deep-link**: URL param `?article=<uuid>`; server reorders to put requested article first.

No DB schema changes. All work happens at the query layer + UI layer.

## 6. Shared query library

### 6.1 New file: `src/lib/news-feed-queries.ts`

```ts
import type { Database } from '@/types/supabase'
import { clusterArticles } from './feed-scoring'

export type ArticleRow = /* fields from articles table; same as ForYouArticle */

export interface ClusteredArticle {
  primary: ArticleRow
  siblings: ArticleRow[]
}

export interface FetchNewsOptions {
  limit?: number               // default 50
  beforeId?: string            // pagination cursor for For You scroll
  pinnedFirst?: string         // article UUID to put at top (deep-link from home)
  applyDedup?: boolean         // default true; admin Articles tab passes false
}

export async function fetchClusteredNews(
  supabase: SupabaseClient,
  opts: FetchNewsOptions = {},
): Promise<ClusteredArticle[]>
```

### 6.2 Internal flow

```
fetchClusteredNews:
  SELECT id, title, title_translations, snippet, summary_md, summary_translations,
         source_url, source_name, source_key, source_icon, favicon_url,
         image_url, language, published_at, tournament_level
  FROM articles
  WHERE enrichment_status = 'enriched'
    AND status = 'active'
  ORDER BY
    CASE WHEN id = $pinnedFirst THEN 0 ELSE 1 END,
    published_at DESC
  LIMIT $limit

  IF applyDedup:
    return clusterArticles(rows)
  ELSE:
    return rows.map(r => ({ primary: r, siblings: [] }))
```

### 6.3 Refactor: extract `clusterArticles` from `feed-scoring.ts`

The existing `buildScoredFeed()` in `src/lib/feed-scoring.ts` clusters items internally. Extract the clustering as a standalone export:

```ts
// src/lib/feed-scoring.ts
export function clusterArticles<T extends { id: string; title: string }>(
  articles: T[],
): Array<{ primary: T; siblings: T[] }> {
  // Walks articles in order. For each, compare token-overlap (Jaccard) against
  // each existing cluster's primary. Match >= 0.5 → append as sibling.
  // No match → start new cluster, this article becomes primary.
  // Returns clusters in the order their primaries appeared in input.
}
```

`buildScoredFeed` calls `clusterArticles` internally where it used to do the inline grouping. No behavior change for the regular feed (same threshold, same noise-word filter, same Jaccard computation). One place for the dedup logic.

**Primary selection rule**: first article in input order becomes primary. Since input is ordered by `published_at DESC`, the most recent article wins each cluster.

### 6.4 Cost + caching

- 50 articles × avg 8 significant tokens per title = ~1,200 Jaccard ops per request.
- Sub-millisecond on Node.
- Home page server fetch already wraps in `revalidate` on the Supabase query timeout — the dedup pass adds no measurable latency.

## 7. Admin Articles tab enhancements

The admin Articles tab at `admin.padelnachos.com/news-sources?tab=articles` (from the V2 source curation PR #413) gets three additions for ops visibility.

### 7.1 "Translations" column

New column between **Enriched** and **Published**. Renders 4 small locale chips representing translation coverage:

```
 ES   PT   IT   FR   ← all present (article fully translated)
 ─    PT   IT   FR   ← ES missing (older article needs backfill)
```

**Logic** per locale: chip is **filled** (brand color) if both `title_translations[locale]` AND `summary_translations[locale]` exist. **Outlined / muted** if either is missing. EN is the source language and not shown as a chip.

A small filter chip in the existing filter row: "Translations: All / Complete / Has gaps" — lets operators isolate incomplete articles.

**Server-side**: the existing `GET /api/articles` endpoint (PR #413) extends the SELECT to include both translation JSONB columns. Computed coverage flags happen client-side per row — cheap, no extra round-trip.

### 7.2 "Cluster" column

Shows the dedup decision for each article. Renders as a small text chip:

```
 unique       ← no duplicates detected
 primary +2   ← this article wins its cluster; 2 siblings hidden from users
 sibling      ← hidden from users; click to jump to the primary
```

The cluster is computed by calling `clusterArticles()` on a window of articles (newest 200 by default). Clicking a `sibling` chip jumps the table to the primary's row.

**Cost**: 200-article window × ~8 tokens = ~20k comparisons. ~5ms. Fine for an admin page on user-driven loads.

A new filter chip: "Cluster: All / Primary / Sibling / Unique" — lets operators audit dedup decisions.

### 7.3 "Run translation backfill" button

In the existing Discovery Health tab (siblings: top-volume sources, recent auto-disables, AI discovery history), add a button next to the new Cluster panel:

```
[ Run title-translation backfill ]   ← triggers POST /api/admin/backfill-title-translations
                                        Shows result count when complete.
```

Wraps the existing `/api/admin/backfill-title-translations` route that was built for exactly this case but never run on the full backlog (141 ES gaps + 76 PT gaps as of 2026-05-28).

**Cross-app call detail**: the admin app at `admin.padelnachos.com` lives in `apps/ops/` (separate Vercel project) but the backfill route lives in the main `padelnachos.com` app. The button fetches across: `POST https://padelnachos.com/api/admin/backfill-title-translations` with `Authorization: Bearer $CRON_SECRET`. The `CRON_SECRET` env var is already shared between both apps.

### 7.4 Admin Articles tab does NOT change its corpus

The admin tab keeps showing **all** articles regardless of `enrichment_status` and dedup status. The dedup machinery is informational only — it tells operators which articles get hidden from users, without hiding them from the admin. This was an explicit choice during brainstorming.

## 8. Deep-link + exit animation

The architectural commitment that drives the home tap → For You experience.

### 8.1 Two render modes for For You

| Mode | When | DOM position | Back goes to |
|---|---|---|---|
| **Route** | Direct URL hit on `/feed?tab=foryou` | Standalone page | Previous page in history |
| **Overlay** | Triggered from `openForYou(id)` on home | `position: fixed; inset: 0` on top of home | Closes overlay, home remains underneath |

Both modes mount the same `<ForYouTab>` content. The route version renders it inside the regular page shell. The overlay version renders it inside `<ForYouOverlay>`. `ForYouTab` accepts an optional `pinnedFirst` prop to position the requested article first; otherwise the API is unchanged.

### 8.2 New files

- `src/components/feed/foryou/ForYouOverlay.tsx` — the overlay shell + animation + dismiss handlers
- `src/hooks/useForYouOverlay.ts` — React context with `{ isOpen, articleId, openForYou(id), closeForYou() }`

### 8.3 Context provider scope

Wrap `<ForYouOverlayProvider>` at the layout level (`src/app/[locale]/(app)/layout.tsx`) so it's available to home, /feed, /following — anywhere a news card might link in.

### 8.4 Open sequence

```
1. User taps a news card on home.
2. HighlightsPreview calls openForYou(article.id).
3. Context flips isOpen=true, sets articleId.
4. ForYouOverlay renders:
   - Backdrop fades in (opacity 0 → 1 over 200ms)
   - Panel translates from translateY(100%) → 0 over 280ms with cubic-bezier(0.32, 0.72, 0, 1)
5. URL gets history.pushState with /feed?tab=foryou&article=<id>.
6. document.body.style.overflow = 'hidden' (lock background scroll).
7. fetchClusteredNews({ pinnedFirst: articleId, limit: 50 }) runs server-side via a fetch wrapper.
8. First card rendered is the deep-linked article; swiping down moves to next.
```

### 8.5 Dismiss sequence

Triggered by **any** of: swipe down (drag overlay top half > 120px), tap `‹` back chip, browser back button, ESC key, backdrop click.

```
1. Slide-down animation begins: translateY(0 → 100%) over 280ms.
2. Backdrop fades out in parallel.
3. After 280ms, isOpen → false, ForYouOverlay unmounts.
4. document.body.style.overflow = '' (restore scroll).
5. URL gets history.back() (or pushState back to /home if entered via direct deep-link with no history).
6. Home page is exactly where the user left it — same DOM, same scroll, no re-fetch.
```

### 8.6 Edge cases

- **Direct deep-link** (`/feed?tab=foryou&article=X` in a new tab): renders as a route, NOT an overlay. Same component, different wrapper. Back goes to `/home`.
- **Hardware back** on Capacitor Android: captured by the `popstate` listener; closes overlay before allowing real nav.
- **Refresh while overlay open**: URL contains the deep-link, so we land in route mode pointed at the same article. Continuity preserved.
- **`prefers-reduced-motion`**: animation duration → 0ms. Open / close are instant; opacity transition skipped.
- **Tap a sibling from the chip-expanded state**: `openForYou(siblingId)` while overlay is already open updates `articleId` and the panel does a horizontal-feel "swipe to article X" (existing For You navigation). No overlay close/reopen.

### 8.7 Animation tokens

```css
:root {
  --foryou-overlay-duration: 280ms;
  --foryou-overlay-easing: cubic-bezier(0.32, 0.72, 0, 1);
}

@media (prefers-reduced-motion: reduce) {
  :root { --foryou-overlay-duration: 0ms; }
}
```

## 9. Home rail changes

The existing `HighlightsPreview.tsx` carousel keeps its layout — same horizontal scroll, same 200px card width. Three behavioral changes.

### 9.1 Data shape

Props change from `news: NewsItem[]` to `news: ClusteredArticle[]`. The home page server fetch calls `fetchClusteredNews({ limit: 20 })` from §6 instead of the inline Supabase query at `home/page.tsx:308`.

### 9.2 Card render

```
┌──────────────────────────┐
│   [hero image]            │
│              +2 sources ▾ │   ← only if primary.siblings.length > 0
├──────────────────────────┤
│  ⓘ FIP · 3h ago           │
│  Galán & Chingotto reach  │
│  Buenos Aires final       │
└──────────────────────────┘
```

The `+N sources ▾` chip sits in the top-right of the hero image, with `backdrop-filter: blur(8px)` so it reads on any photo. Tap target ≈ 64×24px, distinct from the card body. Chevron rotates 180° when expanded.

### 9.3 Tap behavior

| Action | Result |
|---|---|
| **Tap card body** (anywhere except chip) | `openForYou(primary.id)` from context. Overlay opens. |
| **Tap `+N sources` chip** | Card expands in place. ~80px taller. Siblings render as a vertical list of `{ favicon, source_name, truncated_title }` rows below the title. Chip rotates 180° (`▾` → `▴`). |
| **Tap a sibling row** | `openForYou(sibling.id)`. Overlay opens for that sibling article. |
| **Tap chip again when expanded** | Collapses card. Chip rotates back. |

Card height transitions over 200ms `ease-out`. Rail row uses `align-items: flex-start` so neighboring cards stay anchored — only this card grows.

### 9.4 No bookmark / share affordances change

The existing `localStorage['padel-bookmarked-articles']` set in `HighlightsPreview` stays unchanged. Bookmark gestures on the home rail card preserved.

## 10. Cleanup + retirement

**Files deleted in this PR:**
- `src/components/home/NewsPeekSheet.tsx` — replaced by the overlay deep-link.

**Files preserved** (still in use):
- `src/hooks/useSwipeDownToClose.ts` — the overlay reuses this hook for swipe gesture detection.
- `src/lib/feed-scoring.ts` — refactored to expose `clusterArticles` but otherwise unchanged.

**Files deprecated** (kept for now; cleanup PR removes them after 14 days):
- `src/app/api/articles/[id]/translate/route.ts` — was used by `NewsPeekSheet` for on-demand translation. If no other surface calls it, removal is safe.

**No DB schema changes.**

## 11. Rollout

### 11.1 Feature flag

| Flag | Default in prod | Default in local | Purpose |
|---|---|---|---|
| `home_news_immersive_link` | OFF | ON | Gates the home-rail overlay behavior + new card chip. When OFF, the old `NewsPeekSheet` path stays active. |

A single flag, gating all UX changes. Backend changes (shared query lib, dedup, translation column in admin) ship un-flagged because they're additive / observability-only.

### 11.2 Rollout sequence

| Day | Action |
|---|---|
| 0 | Merge PR. Backend live. Admin Articles tab shows new columns. Home page UX unchanged. |
| 0–2 | Operator dogfoods flag-ON locally + via Vercel preview. Verifies overlay animation feels right, dedup looks sane. Translation backfill triggered from admin. |
| 3 | `home_news_immersive_link.enabled = true` in prod. All users see the new behavior. |
| 10 | Cleanup PR: delete `NewsPeekSheet.tsx` and `/api/articles/[id]/translate/route.ts`. Remove the flag. |

### 11.3 Observability

New `ops_events` entry on every overlay open (using the V2 schema — `source` / `status` / `meta`):

```sql
INSERT INTO ops_events (source, status, meta) VALUES (
  'news_feed.deep_link_open',
  'ok',
  jsonb_build_object(
    'origin', 'home_rail',           -- 'home_rail' | 'direct_url' | 'foryou_sibling'
    'article_id', '<uuid>',
    'cluster_size', 3                -- 1 = unique, >1 = duplicate cluster
  )
)
```

Surfaced in the existing Discovery Health recent-events panel. Lets ops see which articles drive the most overlay traffic.

### 11.4 Rollback

- Flip `home_news_immersive_link.enabled = false` → users see the old `NewsPeekSheet` path immediately. No deploy needed.
- The shared query lib and admin columns are flag-independent and stay live; they're additive and have no user-visible effect when the flag is off.

## 12. Files to change

### New files

| Path | Purpose |
|---|---|
| `src/lib/news-feed-queries.ts` | `fetchClusteredNews()` (§6) |
| `src/components/feed/foryou/ForYouOverlay.tsx` | The overlay shell + animation (§8) |
| `src/hooks/useForYouOverlay.ts` | React context (§8) |
| `apps/ops/src/app/(app)/news-sources/TranslationChips.tsx` | The 4-locale chip component for the admin Articles row (§7.1) |
| `apps/ops/src/app/(app)/news-sources/ClusterChip.tsx` | The unique/primary/sibling chip (§7.2) |

### Modified files

| Path | Change |
|---|---|
| `src/lib/feed-scoring.ts` | Extract `clusterArticles` as a public export; `buildScoredFeed` calls it internally (§6.3) |
| `src/app/[locale]/(app)/home/page.tsx` | Replace inline articles SELECT (~line 308) with `fetchClusteredNews({ limit: 20 })`. Mount `<ForYouOverlayProvider>` at the layout level. |
| `src/components/home/HighlightsPreview.tsx` | Accept `ClusteredArticle[]` instead of `NewsItem[]`. Render `+N sources` chip + expanded siblings (§9). Replace `setPeekArticle()` calls with `openForYou(id)`. |
| `src/components/home/shared.tsx` | Type updates for `ClusteredArticle`. Keep `localizedTitle` helper. |
| `src/components/feed/foryou/ForYouTab.tsx` | Accept optional `pinnedFirst` prop; pass through to query. Add overlay mode wrapper detection. |
| `src/app/[locale]/(app)/layout.tsx` | Wrap children with `<ForYouOverlayProvider>` |
| `apps/ops/src/app/(app)/news-sources/ArticlesTable.tsx` | Add Translations + Cluster columns + new filter chips |
| `apps/ops/src/app/api/articles/route.ts` | Extend SELECT with `title_translations`, `summary_translations`; compute cluster windows server-side |
| `apps/ops/src/app/(app)/news-sources/DiscoveryHealth.tsx` | Add "Run title-translation backfill" button (§7.3) |
| `src/lib/feature-flags.ts` | Register `HOME_NEWS_IMMERSIVE_LINK` |
| `supabase/migrations/20260528_home_immersive_flag.sql` | Seed the feature flag row (`enabled=false, enabled_local=true`) |

### Deleted files (this PR)

- `src/components/home/NewsPeekSheet.tsx`

### Deprecated (cleanup PR later)

- `src/app/api/articles/[id]/translate/route.ts`

## 13. Testing plan

### 13.1 Unit tests (Vitest)

- `src/lib/__tests__/news-feed-queries.test.ts`
  - 3 articles with overlapping titles → 1 cluster of 3
  - 3 articles with no overlap → 3 clusters of 1
  - `pinnedFirst` puts requested article at index 0
  - `applyDedup: false` returns every article with `siblings: []`
  - Empty input → empty output
- `src/lib/__tests__/feed-scoring.test.ts` — extend with explicit `clusterArticles` test. Confirm `buildScoredFeed` produces identical output on a fixture (no regression).

### 13.2 Component tests (Vitest + jsdom)

- `src/hooks/__tests__/useForYouOverlay.test.tsx`
  - `openForYou(id)` flips `isOpen` to true, sets `articleId`
  - `closeForYou()` flips back, no `articleId` retained
  - Multiple consecutive `openForYou` calls swap article without unmount

### 13.3 Manual smoke tests

- Home rail: tap card → overlay slides up. Swipe down → home is at the exact scroll position, no re-fetch (verify with Network tab).
- Home rail: tap `+N sources` chip → siblings expand below title. Tap a sibling → overlay opens at that article.
- Direct URL: visit `/feed?tab=foryou&article=<uuid>` in a fresh tab → renders that article first as a route (not overlay). Back goes to `/home`.
- Hardware back (Android Capacitor): inside overlay, hardware back closes overlay first; second hardware back navigates away.
- Refresh inside overlay: URL has deep-link → reloads in route mode pointed at the article.
- `prefers-reduced-motion: reduce` (Chrome DevTools rendering tab) → no slide animation; instant open/close.
- Admin Articles tab: new Translations column shows correct coverage for known articles (cross-check with DB). Cluster column shows `primary +N` / `sibling` / `unique` correctly. "Has gaps" filter narrows to incomplete articles.
- Run translation backfill from admin → article count drops in "Has gaps" filter.

### 13.4 Observability check

After flipping the flag in prod for 24h:

```sql
SELECT meta->>'origin' AS origin, count(*) AS opens
FROM ops_events
WHERE source = 'news_feed.deep_link_open'
  AND created_at > now() - interval '24 hours'
GROUP BY origin
ORDER BY opens DESC;
```

Expected distribution: `home_rail` > `foryou_sibling` > `direct_url`. If `direct_url` dominates we'd suspect the home tap isn't routing correctly.

## 14. Open questions / risks

| # | Question / risk | Mitigation |
|---|---|---|
| 1 | Overlay above home means scroll lock breaks for non-trivial home scrolls — what if home scroll position isn't restored? | Home stays mounted with no DOM mutation while overlay is open. Scroll lock is just `body { overflow: hidden }`. On dismiss, lock released; scroll is exactly where it was. Verified in the mockup. |
| 2 | Direct deep-link to `/feed?tab=foryou&article=X` with no home history → back is broken | Detect "no history" via `window.history.length <= 1` on overlay close and `router.push('/home')` instead of `router.back()`. |
| 3 | Dedup primary selection is purely chronological — newest wins. Sometimes the older article has a better photo or summary. | Acceptable for V1. If user feedback says otherwise, add a quality score (length of summary_md, source_weight, image_url presence) as a tiebreaker — but that's a follow-up. |
| 4 | Sibling articles never appear in For You alone; they only appear when a user taps the chip | Trade-off accepted in §3 (soft hide). The chip + cluster column in admin make this discoverable + tunable. |
| 5 | Title backfill creates Anthropic API cost spike | Existing `/api/admin/backfill-title-translations` route batches requests; cost ≈ $0.30 for 200 articles per the V1 pricing. Acceptable one-time cost. |
| 6 | Two render modes for For You (route vs overlay) is more complex than one | Worth it — overlay solves the "back to home" UX requirement. The shared inner `<ForYouTab>` (rendered with `pinnedFirst` prop in overlay mode) keeps duplication minimal. |

## 15. References

- Brainstorming session, 2026-05-28
- Visual mockup: `mockups/foryou-photo-variants.html` (precursor), `.superpowers/brainstorm/13609-1779943005/content/exit-animation.html` (current)
- V1 For You design: `docs/superpowers/specs/2026-05-23-immersive-news-feed-design.md`
- V2 source curation: `docs/superpowers/specs/2026-05-23-source-curation-tools-design.md`
- Existing dedup logic: `src/lib/feed-scoring.ts` lines 163–220
- Existing home page news fetch: `src/app/[locale]/(app)/home/page.tsx:308`
- Existing news peek sheet: `src/components/home/NewsPeekSheet.tsx`
- Existing admin Articles tab: PR #413 + `apps/ops/src/app/(app)/news-sources/ArticlesTable.tsx`
- Existing title backfill route: `src/app/api/admin/backfill-title-translations/route.ts`

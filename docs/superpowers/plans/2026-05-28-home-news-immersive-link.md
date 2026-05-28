# Home News Immersive Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align home rail + For You + admin Articles tab on a single shared query library, dedup duplicate stories with a `+N sources` chip, and turn the home-page news tap into an overlay-on-home immersive view that gracefully slides down to restore the user's scroll position.

**Architecture:** One new query lib (`fetchClusteredNews`) reused by home + For You. Existing `feed-scoring.ts` clustering extracted as a public export. New overlay component renders For You on top of home (home stays mounted; no re-fetch on dismiss). All UX changes gated behind the `home_news_immersive_link` feature flag.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, Supabase, Vitest, next-intl.

**Spec:** `docs/superpowers/specs/2026-05-28-home-news-immersive-link-design.md`

**Estimated effort:** 2–3 days. 17 tasks across 6 phases.

---

## Pre-flight

Verify these before Task 0.1. If any fail, stop and investigate.

- [ ] Working from a branch off `origin/main` (NOT a stale branch — main has the V1 news pipeline + V2 source curation that this builds on)
- [ ] `src/lib/feed-scoring.ts` exists with `extractSignatureTokens`, `tokenSimilarity`, and `buildScoredFeed`
- [ ] `src/components/feed/foryou/ForYouTab.tsx` and `ForYouCard.tsx` exist
- [ ] `src/components/home/HighlightsPreview.tsx` and `NewsPeekSheet.tsx` exist
- [ ] `src/hooks/useSwipeDownToClose.ts` exists (overlay reuses it)
- [ ] `src/lib/feature-flags.ts` exists with the `FLAG_KEYS` registry
- [ ] `apps/ops/src/app/(app)/news-sources/ArticlesTable.tsx` exists (from PR #413)
- [ ] `src/app/api/admin/backfill-title-translations/route.ts` exists
- [ ] `articles` table has `title_translations` (jsonb) and `summary_translations` (jsonb) columns populated
- [ ] No DB schema changes needed — `home_news_immersive_link` is the only new DB row (seed-only)

Run: `git ls-tree -r HEAD --name-only | grep -E 'foryou|HighlightsPreview|feed-scoring|news-source|NewsPeekSheet|useSwipeDownToClose' | head -20`

---

## Phase 0 — Foundation (shared query lib + flag)

### Task 0.1: Extract `clusterArticles` from `feed-scoring.ts`

**Files:**
- Modify: `src/lib/feed-scoring.ts`
- Modify: `src/lib/__tests__/feed-scoring.test.ts` (if exists) or create

- [ ] **Step 1: Write failing test for the new `clusterArticles` export**

Append to `src/lib/__tests__/feed-scoring.test.ts` (create the file if missing):

```ts
import { describe, it, expect } from 'vitest'
import { clusterArticles } from '../feed-scoring'

describe('clusterArticles', () => {
  it('groups articles with overlapping title tokens (>= 50% Jaccard)', () => {
    const articles = [
      { id: 'a', title: 'Galán y Chingotto a la final del Buenos Aires P1' },
      { id: 'b', title: 'Galán Chingotto llegan a la final en Buenos Aires' },
      { id: 'c', title: 'Tapia y Coello caen en semifinales' },
    ]
    const clusters = clusterArticles(articles)
    expect(clusters).toHaveLength(2)
    expect(clusters[0].primary.id).toBe('a')
    expect(clusters[0].siblings).toEqual([articles[1]])
    expect(clusters[1].primary.id).toBe('c')
    expect(clusters[1].siblings).toEqual([])
  })

  it('returns each article as its own cluster when no overlap', () => {
    const articles = [
      { id: 'a', title: 'Premier Padel Madrid champions' },
      { id: 'b', title: 'FIP rankings updated' },
      { id: 'c', title: 'Bullpadel releases new racket' },
    ]
    const clusters = clusterArticles(articles)
    expect(clusters).toHaveLength(3)
    clusters.forEach(c => expect(c.siblings).toEqual([]))
  })

  it('returns empty array for empty input', () => {
    expect(clusterArticles([])).toEqual([])
  })

  it('first article in input order wins as primary', () => {
    const articles = [
      { id: 'newer', title: 'Galán Chingotto Buenos Aires final' },
      { id: 'older', title: 'Galán y Chingotto a la final Buenos Aires' },
    ]
    const clusters = clusterArticles(articles)
    expect(clusters[0].primary.id).toBe('newer')
    expect(clusters[0].siblings.map(s => s.id)).toEqual(['older'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/feed-scoring.test.ts`

Expected: FAIL — `clusterArticles is not exported`.

- [ ] **Step 3: Extract the clustering as a public function**

In `src/lib/feed-scoring.ts`, after the existing `tokenSimilarity` function (around line 204) and before `buildScoredFeed` (line 217), add:

```ts
export interface ArticleCluster<T extends { id: string; title: string }> {
  primary: T
  siblings: T[]
}

/**
 * Cluster articles by title-token overlap (≥ 0.5 Jaccard).
 * First article in input order becomes the primary of each cluster.
 * Returns clusters in the order their primaries appeared.
 *
 * Extracted from buildScoredFeed so non-feed-scoring callers
 * (home rail, For You server fetch) can reuse the same dedup logic.
 */
export function clusterArticles<T extends { id: string; title: string }>(
  articles: T[],
): ArticleCluster<T>[] {
  if (articles.length === 0) return []

  const tokenized = articles.map(a => ({
    article: a,
    tokens: extractSignatureTokens(a.title),
  }))

  const clusters: ArticleCluster<T>[] = []
  const clusterTokens: string[][] = [] // tokens of each cluster's primary

  for (const { article, tokens } of tokenized) {
    let matchedIdx = -1
    for (let i = 0; i < clusters.length; i++) {
      if (tokenSimilarity(tokens, clusterTokens[i]) >= 0.5) {
        matchedIdx = i
        break
      }
    }
    if (matchedIdx >= 0) {
      clusters[matchedIdx].siblings.push(article)
    } else {
      clusters.push({ primary: article, siblings: [] })
      clusterTokens.push(tokens)
    }
  }

  return clusters
}
```

- [ ] **Step 4: Refactor `buildScoredFeed` to use the new function**

Locate the existing clustering loop inside `buildScoredFeed` (around lines 240–280, where the inline clustering currently runs). Replace it with a call to `clusterArticles`. Specifically, find this block (or similar):

```ts
// OLD: inline clustering inside buildScoredFeed
const clusters: ScoredCluster<T>[] = []
const used = new Set<number>()
for (let i = 0; i < scored.length; i++) {
  if (used.has(i)) continue
  const cluster: ScoredCluster<T> = { primary: scored[i].item, score: scored[i].score, collapsed: [] }
  for (let j = i + 1; j < scored.length; j++) {
    if (used.has(j)) continue
    const sim = tokenSimilarity(scored[i].tokens, scored[j].tokens)
    if (sim >= 0.5) {
      cluster.collapsed.push(scored[j].item)
      used.add(j)
    }
  }
  clusters.push(cluster)
  used.add(i)
}
```

Replace with:

```ts
// NEW: delegate to clusterArticles for the grouping, then attach scores
const articleClusters = clusterArticles(
  scored.map(s => ({ id: s.id, title: s.title, _ref: s }))
)
const clusters: FeedCluster<T>[] = articleClusters.map(ac => ({
  primary: (ac.primary as { _ref: { item: T } })._ref.item,
  score: (ac.primary as { _ref: { score: number } })._ref.score,
  collapsed: ac.siblings.map(sib => (sib as { _ref: { item: T } })._ref.item),
}))
```

The reference field (`_ref`) lets `clusterArticles` operate on the abstract `{ id, title }` shape while we keep the full scored item under it. If the existing `scored` items don't have `id`/`title` at top level (they have `.tokens`), generate placeholder ids: `s.item.data?.id ?? String(i)`. Look at the existing scored shape in `feed-scoring.ts` to adapt the exact field names — the goal is to keep `buildScoredFeed`'s public output identical.

- [ ] **Step 5: Run all feed-scoring tests**

Run: `npx vitest run src/lib/__tests__/feed-scoring.test.ts`

Expected: PASS — all 4 new `clusterArticles` tests + any pre-existing tests for `buildScoredFeed`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/feed-scoring.ts src/lib/__tests__/feed-scoring.test.ts
git commit -m "refactor(feed-scoring): extract clusterArticles as public export

Pulls the inline clustering loop out of buildScoredFeed into a standalone
function so non-feed callers (home rail, For You overlay) can reuse the
same Jaccard ≥0.5 token-overlap logic. buildScoredFeed now delegates to
clusterArticles — no behavior change for the regular feed."
```

### Task 0.2: Create `fetchClusteredNews` library

**Files:**
- Create: `src/lib/news-feed-queries.ts`
- Create: `src/lib/__tests__/news-feed-queries.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/__tests__/news-feed-queries.test.ts
import { describe, it, expect, vi } from 'vitest'
import { fetchClusteredNews, type ArticleRow } from '../news-feed-queries'

function makeSupabaseMock(rows: ArticleRow[]) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
  }
  return { from: vi.fn().mockReturnValue(builder) } as never
}

const FIXTURE: ArticleRow[] = [
  { id: 'a', title: 'Galán Chingotto a la final', source_name: 'FIP', source_url: 'https://x', source_key: 'fip', image_url: null, language: 'es', published_at: '2026-05-28T10:00:00Z', summary_md: '', summary_translations: {}, title_translations: {}, snippet: null, source_icon: null, favicon_url: null, tournament_level: null },
  { id: 'b', title: 'Galán y Chingotto llegan a la final', source_name: 'Padel Addict', source_url: 'https://y', source_key: 'padel-addict', image_url: null, language: 'es', published_at: '2026-05-28T09:00:00Z', summary_md: '', summary_translations: {}, title_translations: {}, snippet: null, source_icon: null, favicon_url: null, tournament_level: null },
  { id: 'c', title: 'Tapia y Coello caen', source_name: 'beIN', source_url: 'https://z', source_key: 'bein', image_url: null, language: 'es', published_at: '2026-05-28T08:00:00Z', summary_md: '', summary_translations: {}, title_translations: {}, snippet: null, source_icon: null, favicon_url: null, tournament_level: null },
]

describe('fetchClusteredNews', () => {
  it('clusters articles by default and returns ClusteredArticle[]', async () => {
    const supabase = makeSupabaseMock(FIXTURE)
    const result = await fetchClusteredNews(supabase, { limit: 50 })
    expect(result).toHaveLength(2)
    expect(result[0].primary.id).toBe('a')
    expect(result[0].siblings.map(s => s.id)).toEqual(['b'])
    expect(result[1].primary.id).toBe('c')
    expect(result[1].siblings).toEqual([])
  })

  it('with applyDedup=false returns every article as primary, no siblings', async () => {
    const supabase = makeSupabaseMock(FIXTURE)
    const result = await fetchClusteredNews(supabase, { applyDedup: false })
    expect(result).toHaveLength(3)
    result.forEach(c => expect(c.siblings).toEqual([]))
  })

  it('returns empty array on supabase error', async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }),
      }),
    } as never
    const result = await fetchClusteredNews(supabase, {})
    expect(result).toEqual([])
  })

  it('respects limit option (default 50)', async () => {
    const supabase = makeSupabaseMock(FIXTURE)
    await fetchClusteredNews(supabase, { limit: 10 })
    const builder = (supabase as { from: () => { limit: ReturnType<typeof vi.fn> } }).from()
    expect(builder.limit).toHaveBeenCalledWith(10)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/news-feed-queries.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the library**

```ts
// src/lib/news-feed-queries.ts
// Shared news article fetcher used by the home rail, For You feed, and any
// other user-facing surface that needs the canonical "enriched + dedup'd"
// view. The admin Articles tab does NOT use this — it has its own fetch
// that intentionally shows the full unfiltered corpus for triage.

import type { SupabaseClient } from '@supabase/supabase-js'
import { clusterArticles } from './feed-scoring'

export interface ArticleRow {
  id: string
  title: string
  title_translations: Record<string, string> | null
  source_url: string
  source_name: string | null
  source_key: string
  source_icon: string | null
  favicon_url: string | null
  image_url: string | null
  language: string | null
  published_at: string
  snippet: string | null
  summary_md: string | null
  summary_translations: Record<string, string>
  tournament_level: string | null
}

export interface ClusteredArticle {
  primary: ArticleRow
  siblings: ArticleRow[]
}

export interface FetchNewsOptions {
  limit?: number
  /** Article UUID to put at the top of the result. Used by deep-link overlay. */
  pinnedFirst?: string
  /** Default true. Pass false to bypass dedup (used by admin triage UIs). */
  applyDedup?: boolean
}

const SELECT_FIELDS = [
  'id', 'title', 'title_translations', 'source_url', 'source_name', 'source_key',
  'source_icon', 'favicon_url', 'image_url', 'language', 'published_at',
  'snippet', 'summary_md', 'summary_translations', 'tournament_level',
].join(',')

export async function fetchClusteredNews(
  supabase: SupabaseClient,
  opts: FetchNewsOptions = {},
): Promise<ClusteredArticle[]> {
  const limit = opts.limit ?? 50
  const applyDedup = opts.applyDedup !== false

  // Filter to enriched-only, then order so the pinned article (if any) is
  // first. The CASE clause is portable PostgREST syntax via .order with
  // a generated column-free pattern: we do it client-side after fetch.
  const { data, error } = await supabase
    .from('articles')
    .select(SELECT_FIELDS)
    .eq('enrichment_status', 'enriched')
    .eq('status', 'active')
    .order('published_at', { ascending: false })
    .limit(limit)

  if (error || !data) {
    console.warn('fetchClusteredNews: supabase error', error)
    return []
  }

  let rows = data as ArticleRow[]

  // Pinned-first reordering (client-side — small N so cost is negligible).
  if (opts.pinnedFirst) {
    const idx = rows.findIndex(r => r.id === opts.pinnedFirst)
    if (idx > 0) {
      const [pinned] = rows.splice(idx, 1)
      rows = [pinned, ...rows]
    }
  }

  if (!applyDedup) {
    return rows.map(r => ({ primary: r, siblings: [] }))
  }

  return clusterArticles(rows)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/news-feed-queries.test.ts`

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/news-feed-queries.ts src/lib/__tests__/news-feed-queries.test.ts
git commit -m "feat(news): fetchClusteredNews shared query lib

Single source of truth for 'fetch enriched news articles + dedup'.
Used by home rail + For You feed. Admin Articles tab keeps its own
unfiltered fetch for triage. Wraps the just-extracted clusterArticles
from feed-scoring.ts.

Options:
- limit (default 50)
- pinnedFirst — UUID to put at the top (deep-link overlay)
- applyDedup (default true)"
```

### Task 0.3: Add `HOME_NEWS_IMMERSIVE_LINK` feature flag

**Files:**
- Modify: `src/lib/feature-flags.ts`
- Create: `supabase/migrations/20260528_home_immersive_flag.sql`

- [ ] **Step 1: Extend FLAG_KEYS**

In `src/lib/feature-flags.ts`, add to `FLAG_KEYS`:

```ts
export const FLAG_KEYS = {
  HOME_LIVE_TOURNAMENTS_CAROUSEL: 'home_live_tournaments_carousel',
  NEWS_PIPELINE_ENRICHMENT:       'news_pipeline_enrichment',
  FORYOU_ENABLED:                 'foryou_enabled',
  SUGGEST_A_SOURCE_BUTTON:        'suggest_a_source_button',
  HOME_NEWS_IMMERSIVE_LINK:       'home_news_immersive_link',
} as const
```

- [ ] **Step 2: Seed migration**

```sql
-- supabase/migrations/20260528_home_immersive_flag.sql
-- Home page news rail: when ON, tapping a news card opens For You as an
-- overlay on top of home (no NewsPeekSheet). When OFF, keeps the current
-- NewsPeekSheet flow. Gates the home_news_immersive_link work.

INSERT INTO public.feature_flags (key, label, enabled, enabled_local, description)
VALUES (
  'home_news_immersive_link',
  'Home News → Immersive (overlay)',
  false,
  true,
  'Tap on home news card opens the For You overlay positioned at that article. When off, the legacy NewsPeekSheet preview is shown instead.'
)
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 3: Apply to prod**

```bash
node scripts/apply-migration.mjs supabase/migrations/20260528_home_immersive_flag.sql
```

Expected: `Applied.`

- [ ] **Step 4: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/feature-flags.ts supabase/migrations/20260528_home_immersive_flag.sql
git commit -m "feat(flags): HOME_NEWS_IMMERSIVE_LINK — gates the home → For You overlay"
```

---

## Phase 1 — Overlay infrastructure

### Task 1.1: `useForYouOverlay` hook + context provider

**Files:**
- Create: `src/hooks/useForYouOverlay.ts`
- Create: `src/hooks/__tests__/useForYouOverlay.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// src/hooks/__tests__/useForYouOverlay.test.tsx
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { ForYouOverlayProvider, useForYouOverlay } from '../useForYouOverlay'

function wrapper({ children }: { children: React.ReactNode }) {
  return <ForYouOverlayProvider>{children}</ForYouOverlayProvider>
}

describe('useForYouOverlay', () => {
  it('initial state: closed, no articleId', () => {
    const { result } = renderHook(() => useForYouOverlay(), { wrapper })
    expect(result.current.isOpen).toBe(false)
    expect(result.current.articleId).toBeNull()
  })

  it('openForYou(id) flips to open with articleId', () => {
    const { result } = renderHook(() => useForYouOverlay(), { wrapper })
    act(() => result.current.openForYou('article-123'))
    expect(result.current.isOpen).toBe(true)
    expect(result.current.articleId).toBe('article-123')
  })

  it('closeForYou() flips back; articleId can be retained briefly for unmount animation', () => {
    const { result } = renderHook(() => useForYouOverlay(), { wrapper })
    act(() => result.current.openForYou('article-123'))
    act(() => result.current.closeForYou())
    expect(result.current.isOpen).toBe(false)
  })

  it('consecutive openForYou calls swap the articleId without unmount', () => {
    const { result } = renderHook(() => useForYouOverlay(), { wrapper })
    act(() => result.current.openForYou('a'))
    expect(result.current.articleId).toBe('a')
    act(() => result.current.openForYou('b'))
    expect(result.current.articleId).toBe('b')
    expect(result.current.isOpen).toBe(true)
  })

  it('throws when used outside the provider', () => {
    const orig = console.error
    console.error = () => {}
    expect(() => renderHook(() => useForYouOverlay())).toThrow(/ForYouOverlayProvider/)
    console.error = orig
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/__tests__/useForYouOverlay.test.tsx`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// src/hooks/useForYouOverlay.ts
// Context + hook that drives the home → For You overlay.
//
// The OVERLAY itself (slide-up panel) lives in
// src/components/feed/foryou/ForYouOverlay.tsx and reads from this context.
// Any surface that wants to deep-link into For You (home rail card, embedded
// player card, push notification) just calls openForYou(articleId).

'use client'

import {
  createContext, useCallback, useContext, useMemo, useState,
  type ReactNode,
} from 'react'

interface ForYouOverlayState {
  isOpen: boolean
  articleId: string | null
  openForYou: (articleId: string) => void
  closeForYou: () => void
}

const Ctx = createContext<ForYouOverlayState | null>(null)

export function ForYouOverlayProvider({ children }: { children: ReactNode }) {
  const [articleId, setArticleId] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  const openForYou = useCallback((id: string) => {
    setArticleId(id)
    setIsOpen(true)
  }, [])

  const closeForYou = useCallback(() => {
    setIsOpen(false)
    // We keep articleId until the next open — lets the overlay's exit
    // animation finish without the inner article suddenly going blank.
  }, [])

  const value = useMemo(
    () => ({ isOpen, articleId, openForYou, closeForYou }),
    [isOpen, articleId, openForYou, closeForYou],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useForYouOverlay(): ForYouOverlayState {
  const ctx = useContext(Ctx)
  if (!ctx) {
    throw new Error('useForYouOverlay must be used inside <ForYouOverlayProvider>')
  }
  return ctx
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/__tests__/useForYouOverlay.test.tsx`

Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useForYouOverlay.ts src/hooks/__tests__/useForYouOverlay.test.tsx
git commit -m "feat(foryou): useForYouOverlay hook + provider for home deep-link"
```

### Task 1.2: `ForYouTab` accepts `pinnedFirst` prop

**Files:**
- Modify: `src/components/feed/foryou/ForYouTab.tsx`

- [ ] **Step 1: Read the existing component first**

Run: `head -50 src/components/feed/foryou/ForYouTab.tsx`

Look for the props interface and the article-fetching code (likely a `useEffect` or `useQuery` that hits supabase).

- [ ] **Step 2: Add the `pinnedFirst` prop**

Modify the props interface (typically near the top of the file):

```tsx
export interface ForYouTabProps {
  // ... existing props (showForYou flag, etc.) ...
  /** Article UUID to position at index 0. Used by deep-link from home. */
  pinnedFirst?: string
}
```

- [ ] **Step 3: Replace the existing article fetch with `fetchClusteredNews`**

Find the existing supabase query inside `ForYouTab` (likely something like `supabase.from('articles').select(...).eq('enrichment_status', 'enriched')...`). Replace with:

```tsx
import { fetchClusteredNews, type ClusteredArticle } from '@/lib/news-feed-queries'

// inside the component body:
const [clusters, setClusters] = useState<ClusteredArticle[]>([])
const [loading, setLoading] = useState(true)

useEffect(() => {
  let cancelled = false
  setLoading(true)
  fetchClusteredNews(supabase, { limit: 50, pinnedFirst })
    .then(rows => { if (!cancelled) { setClusters(rows); setLoading(false) } })
    .catch(() => { if (!cancelled) setLoading(false) })
  return () => { cancelled = true }
}, [pinnedFirst])
```

Then change the existing iteration over flat articles to iterate over `clusters.map(c => c.primary)` — the rest of the card render is unchanged.

- [ ] **Step 4: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/feed/foryou/ForYouTab.tsx
git commit -m "feat(foryou): ForYouTab accepts pinnedFirst + uses shared query lib

ForYouTab now sources articles via fetchClusteredNews. The pinnedFirst
prop positions a specific article at index 0 — used by the home → For You
deep-link to land users on the article they tapped."
```

### Task 1.3: `ForYouOverlay` component (animation + dismiss handlers)

**Files:**
- Create: `src/components/feed/foryou/ForYouOverlay.tsx`

- [ ] **Step 1: Create the overlay component**

```tsx
// src/components/feed/foryou/ForYouOverlay.tsx
// Slide-up overlay that renders ForYouTab on top of whatever page the user
// is on (home, /following, etc.). Reads from useForYouOverlay context.
//
// Animation: 280ms cubic-bezier(0.32, 0.72, 0, 1) — feels native on iOS.
// Honors prefers-reduced-motion: 0ms duration, instant open/close.
//
// Dismiss triggers (all converge to closeForYou()):
//   - tap ‹ back chip
//   - browser back button (popstate)
//   - swipe down on top half (via useSwipeDownToClose)
//   - backdrop click
//   - ESC key

'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from '@/i18n/navigation'
import { useForYouOverlay } from '@/hooks/useForYouOverlay'
import { useSwipeDownToClose } from '@/hooks/useSwipeDownToClose'
import { ForYouTab } from './ForYouTab'

const DURATION_MS = 280
const EASING = 'cubic-bezier(0.32, 0.72, 0, 1)'

export function ForYouOverlay() {
  const { isOpen, articleId, closeForYou } = useForYouOverlay()
  const pathname = usePathname()
  const panelRef = useRef<HTMLDivElement>(null)

  // Push deep-link URL when opening; restore when closing.
  useEffect(() => {
    if (!isOpen || !articleId) return
    const targetUrl = `/feed?tab=foryou&article=${articleId}`
    window.history.pushState({ foryouOverlay: true }, '', targetUrl)
    const onPop = () => {
      if (isOpen) closeForYou()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [isOpen, articleId, closeForYou])

  // Lock background scroll while overlay is open.
  useEffect(() => {
    if (!isOpen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prevOverflow }
  }, [isOpen])

  // ESC to dismiss.
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeForYou()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, closeForYou])

  // Swipe-down dismiss (reuses the same hook NewsPeekSheet uses).
  useSwipeDownToClose(panelRef, isOpen ? closeForYou : () => {})

  // Don't mount when closed AND no article — first paint stays cheap.
  if (!isOpen && !articleId) return null

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={closeForYou}
        aria-hidden
        style={{
          position: 'fixed', inset: 0, zIndex: 90,
          background: 'rgba(0,0,0,0.5)',
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
          transition: `opacity ${DURATION_MS}ms ${EASING}`,
        }}
      />
      {/* Slide-up panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed', inset: 0, zIndex: 91,
          background: '#0a0a0a',
          transform: isOpen ? 'translateY(0)' : 'translateY(100%)',
          transition: `transform ${DURATION_MS}ms ${EASING}`,
        }}
      >
        {articleId && (
          <ForYouTab pinnedFirst={articleId} showForYou={true} />
        )}
      </div>

      {/* prefers-reduced-motion: 0ms duration */}
      <style jsx>{`
        @media (prefers-reduced-motion: reduce) {
          div { transition-duration: 0ms !important; }
        }
      `}</style>
    </>
  )
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: zero errors.

If `useSwipeDownToClose`'s signature doesn't match `(ref, onClose)`, peek at its existing usage in `NewsPeekSheet.tsx` and adapt the call. The hook is the same; the calling convention may differ.

- [ ] **Step 3: Commit**

```bash
git add src/components/feed/foryou/ForYouOverlay.tsx
git commit -m "feat(foryou): ForYouOverlay slide-up panel with 280ms animation

Renders ForYouTab on top of the current page when the
useForYouOverlay context is open. Dismiss via ‹ back chip, browser
back, swipe-down, backdrop click, or ESC. URL deep-links via
pushState. Body scroll locked while open. Honors
prefers-reduced-motion."
```

---

## Phase 2 — Layout + home page integration

### Task 2.1: Mount `ForYouOverlayProvider` in the app layout

**Files:**
- Modify: `src/app/[locale]/(app)/layout.tsx`

- [ ] **Step 1: Read existing layout**

Run: `cat src/app/\[locale\]/\(app\)/layout.tsx | head -40`

- [ ] **Step 2: Wrap children with the provider + mount the overlay**

Add the imports:

```tsx
import { ForYouOverlayProvider } from '@/hooks/useForYouOverlay'
import { ForYouOverlay } from '@/components/feed/foryou/ForYouOverlay'
```

Wrap whatever the layout already renders for `children` with `<ForYouOverlayProvider>`. Inside the provider, after `{children}`, mount `<ForYouOverlay />` so it sits at the top-level of every (app) route's DOM (above page content but below toasts/headers if any):

```tsx
return (
  <ForYouOverlayProvider>
    {/* existing layout content + children */}
    {children}
    <ForYouOverlay />
  </ForYouOverlayProvider>
)
```

If the layout has multiple branches (auth gate, etc.), wrap at the highest level inside the authenticated branch.

- [ ] **Step 3: Verify tsc + build**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add 'src/app/[locale]/(app)/layout.tsx'
git commit -m "feat(layout): mount ForYouOverlayProvider in (app) layout

Provides the overlay context to home, following, feed and any other
authenticated route. The overlay component itself sits above page
content so deep-links from any surface land on top of where the user
was."
```

### Task 2.2: Home page uses `fetchClusteredNews`

**Files:**
- Modify: `src/app/[locale]/(app)/home/page.tsx`

- [ ] **Step 1: Locate the existing articles query**

The home page has an inline supabase query around line 308:

```ts
wrap(supabase.from('articles').select('id, title, ...').eq('status', 'active').not('image_url', 'is', null).order('published_at', { ascending: false }).limit(20) as any, 'home:articles'),
```

This is inside a `Promise.all` block that fetches multiple parallel queries.

- [ ] **Step 2: Replace with `fetchClusteredNews`**

Add the import at the top of the file:

```ts
import { fetchClusteredNews, type ClusteredArticle } from '@/lib/news-feed-queries'
```

Replace the articles query inside the `Promise.all`:

```ts
// OLD:
wrap(supabase.from('articles').select('id, title, title_translations, snippet, snippet_translations, source_icon, source_name, url, published_at, language, image_url').eq('status', 'active').not('image_url', 'is', null).order('published_at', { ascending: false }).limit(20) as any, 'home:articles'),

// NEW:
wrap(fetchClusteredNews(supabase, { limit: 20 }), 'home:articles'),
```

Then find where the articles result is consumed (look for the destructure of the `Promise.all` result + how `news` is passed down to `<HighlightsPreview>`). Update the type to `ClusteredArticle[]`. The new shape is `{ primary, siblings }[]` instead of flat `NewsItem[]`.

```tsx
// OLD: assuming flat array
<HighlightsPreview highlights={highlights} news={articles} />

// NEW: clusters
<HighlightsPreview highlights={highlights} news={articleClusters} />
```

Where `articleClusters` is the variable that received the `Promise.all` result for `home:articles`. The next task (3.1) updates `HighlightsPreview` to accept `ClusteredArticle[]`.

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: there WILL be TS errors at this point because `HighlightsPreview` still expects `NewsItem[]`. That's OK — Task 3.1 fixes that. Commit this as a WIP if you want clean per-task commits, or land both Tasks 2.2 and 3.1 in a single commit (preferred).

- [ ] **Step 4: Commit (or hold for next task)**

If holding for Task 3.1, skip this commit. Otherwise:

```bash
git add 'src/app/[locale]/(app)/home/page.tsx'
git commit -m "feat(home): switch articles fetch to fetchClusteredNews (WIP — needs HighlightsPreview update)" --allow-empty-message
```

(Recommended: keep this uncommitted and land it together with Task 3.1.)

---

## Phase 3 — Home rail UI

### Task 3.1: `HighlightsPreview` accepts `ClusteredArticle[]` + renders `+N` chip

**Files:**
- Modify: `src/components/home/HighlightsPreview.tsx`
- Modify: `src/components/home/shared.tsx` (re-export ClusteredArticle for convenience)

- [ ] **Step 1: Update the props type**

In `HighlightsPreview.tsx`, change:

```tsx
// OLD
function HighlightsPreviewInner({ highlights, news }: { highlights: Highlight[]; news: NewsItem[] }) {

// NEW
import type { ClusteredArticle } from '@/lib/news-feed-queries'

function HighlightsPreviewInner({ highlights, news }: { highlights: Highlight[]; news: ClusteredArticle[] }) {
```

- [ ] **Step 2: Update the articles iteration**

Find the loop that renders article cards. Replace `articles.map(article => ...)` with iteration over clusters:

```tsx
const clusters = news.slice(0, 20)
// ...
{clusters.map(cluster => {
  const article = cluster.primary
  const siblingCount = cluster.siblings.length
  return (
    // ... existing card render, but article = cluster.primary
    // Add the +N chip overlay when siblingCount > 0 (see Step 3)
  )
})}
```

- [ ] **Step 3: Add the `+N sources` chip to the hero image area**

Inside the card's hero image container, layer a positioned chip:

```tsx
<div style={{ position: 'relative', aspectRatio: '16/9' }}>
  {/* eslint-disable-next-line @next/next/no-img-element */}
  <img src={article.image_url ?? undefined} alt={article.title} loading="lazy"
       style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
  {siblingCount > 0 && (
    <button
      type="button"
      aria-label={`Show ${siblingCount} other sources`}
      onClick={e => { e.stopPropagation(); /* expand logic in Task 3.2 */ }}
      style={{
        position: 'absolute', top: 6, right: 6,
        padding: '3px 7px',
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        borderRadius: 10,
        color: '#fff', fontSize: 9, fontWeight: 700,
        border: 0, cursor: 'pointer',
      }}
    >
      +{siblingCount} sources
    </button>
  )}
</div>
```

- [ ] **Step 4: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: zero errors (now that both home/page.tsx and HighlightsPreview use the cluster shape).

- [ ] **Step 5: Commit (combining Tasks 2.2 + 3.1)**

```bash
git add 'src/app/[locale]/(app)/home/page.tsx' src/components/home/HighlightsPreview.tsx
git commit -m "feat(home): rail uses fetchClusteredNews + renders +N sources chip

Home page articles fetch routes through the shared news query lib
(enriched + dedup'd). HighlightsPreview now receives ClusteredArticle[]
and displays a +N sources chip on the hero image of any card with
siblings. Chip is a static badge for this commit; expand interaction
lands in the next task."
```

### Task 3.2: `HighlightsPreview` chip expand interaction

**Files:**
- Modify: `src/components/home/HighlightsPreview.tsx`

- [ ] **Step 1: Add expand state**

Inside `HighlightsPreviewInner`:

```tsx
const [expandedClusterId, setExpandedClusterId] = useState<string | null>(null)
const isExpanded = (clusterId: string) => expandedClusterId === clusterId

const toggleExpand = (e: React.MouseEvent, clusterId: string) => {
  e.stopPropagation()
  setExpandedClusterId(prev => prev === clusterId ? null : clusterId)
}
```

- [ ] **Step 2: Wire the chip click + render the expanded siblings**

Update the chip's onClick:

```tsx
<button
  onClick={e => toggleExpand(e, cluster.primary.id)}
  // ... existing styles
>
  +{siblingCount} sources {isExpanded(cluster.primary.id) ? '▴' : '▾'}
</button>
```

Below the card title block, add the expanded siblings list (rendered only when this cluster is expanded):

```tsx
{isExpanded(cluster.primary.id) && cluster.siblings.length > 0 && (
  <div style={{
    padding: '8px 12px 10px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    background: 'rgba(0,0,0,0.25)',
  }}>
    {cluster.siblings.map(sib => (
      <button
        key={sib.id}
        type="button"
        onClick={e => { e.stopPropagation(); /* open overlay — wired in Task 3.3 */ }}
        style={{
          width: '100%', textAlign: 'left',
          background: 'transparent', border: 0, padding: '6px 0',
          cursor: 'pointer', color: '#fff',
          display: 'flex', alignItems: 'center', gap: 8,
        }}
      >
        {sib.favicon_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={sib.favicon_url} alt="" width={14} height={14} style={{ borderRadius: 2 }} />
        )}
        <span style={{ fontSize: 10, fontWeight: 700, color: '#7ED321' }}>
          {sib.source_name?.toUpperCase()}
        </span>
        <span style={{ fontSize: 11, color: '#ccc',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {sib.title}
        </span>
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 3: Animate the card height change**

The expansion happens by adding the sibling block under the card body. To get a smooth height transition, wrap the article body + sibling block in a container with `transition: max-height 200ms ease-out`. Since max-height transitions don't auto-size, use a generous fixed max-height (`400px` collapsed → `800px` expanded) — pure CSS, no JS measurement needed.

Or simpler: skip the height transition for V1. The expand feels immediate and looks fine. If you want polish later, do it in a follow-up.

- [ ] **Step 4: Smoke test**

Run dev server. On the home page, tap a `+N sources` chip on a clustered card. Verify:
- Card expands, showing the sibling sources below the title
- Tapping the chip again collapses
- Only one cluster can be expanded at a time
- Card tap (outside chip) doesn't accidentally toggle the chip

- [ ] **Step 5: Commit**

```bash
git add src/components/home/HighlightsPreview.tsx
git commit -m "feat(home): chip expand reveals sibling sources inline

Tapping +N sources chip on a clustered card expands the card in-place
to show the sibling source titles + favicons. Chevron rotates. Card
tap is preserved (stopPropagation on chip)."
```

### Task 3.3: `HighlightsPreview` tap behavior (gated by flag)

**Files:**
- Modify: `src/components/home/HighlightsPreview.tsx`

- [ ] **Step 1: Read the feature flag**

Add to the component (above the JSX):

```tsx
import { useFeatureFlag } from '@/lib/feature-flags-client' // or whatever the existing client-side hook is
import { useForYouOverlay } from '@/hooks/useForYouOverlay'

// inside HighlightsPreviewInner:
const immersiveEnabled = useFeatureFlag('home_news_immersive_link')
const { openForYou } = useForYouOverlay()
```

If `useFeatureFlag` doesn't exist as a hook, look at how the existing `HOME_LIVE_TOURNAMENTS_CAROUSEL` flag is read in the same project — match that pattern. Likely it's a context-based read in the `(app)/layout.tsx` that passes flag values as props.

- [ ] **Step 2: Update the card tap handler**

Find where the card click currently sets `peekArticle` (calls `setPeekArticle(article)` to open `NewsPeekSheet`). Replace with:

```tsx
const handleCardTap = (article: ArticleRow) => {
  if (immersiveEnabled) {
    openForYou(article.id)
  } else {
    setPeekArticle(article as never) // legacy path; types may need a cast
  }
}

// In the card JSX:
<div onClick={() => handleCardTap(cluster.primary)} /* ... */>
```

And in the sibling expand list (Task 3.2 placeholder):

```tsx
<button onClick={e => {
  e.stopPropagation()
  if (immersiveEnabled) {
    openForYou(sib.id)
  } else {
    setPeekArticle(sib as never)
  }
}}>
```

- [ ] **Step 3: Verify both code paths still type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors. The `as never` casts above are intentional bridges for the legacy `NewsPeekSheet` type, which expects `NewsItem` (the old shape). When the flag flips fully on and `NewsPeekSheet` is deleted, those casts go away.

- [ ] **Step 4: Smoke test both paths**

```bash
# Flag OFF locally: should still open NewsPeekSheet
psql "$LOCAL_DB_URL" -c "UPDATE feature_flags SET enabled_local=false WHERE key='home_news_immersive_link';"
# Refresh /home → tap card → NewsPeekSheet opens

# Flag ON:
psql "$LOCAL_DB_URL" -c "UPDATE feature_flags SET enabled_local=true WHERE key='home_news_immersive_link';"
# Refresh /home → tap card → ForYou overlay opens
```

- [ ] **Step 5: Commit**

```bash
git add src/components/home/HighlightsPreview.tsx
git commit -m "feat(home): card tap opens ForYou overlay (behind flag)

When home_news_immersive_link is ON, tapping a news card calls
openForYou(article.id) which slides up the ForYou overlay positioned
at that article. When OFF, falls back to the existing NewsPeekSheet
preview. Sibling sources in the expanded chip view also route via
the same flag check."
```

---

## Phase 4 — Admin Articles tab enhancements

### Task 4.1: Extend `GET /api/articles` with translation cols + cluster computation

**Files:**
- Modify: `apps/ops/src/app/api/articles/route.ts`

- [ ] **Step 1: Add JSONB columns to the SELECT**

Find the `query.select(...)` call in the route. Append `title_translations` and `summary_translations`:

```ts
// OLD:
.select('id, title, source_name, source_key, url, image_url, language, published_at, click_count, enrichment_status, summary_md, ...')

// NEW (append the two JSONB cols):
.select('id, title, source_name, source_key, url, image_url, language, published_at, click_count, enrichment_status, summary_md, title_translations, summary_translations, ...')
```

- [ ] **Step 2: Compute clusters across a 200-article enriched window**

After the main rows query but before returning, fetch the latest 200 enriched articles (id + title only) and compute clusters:

```ts
import { clusterArticles } from '@/lib/feed-scoring'

// ... existing rows fetch ...

// Cluster the latest 200 enriched articles
const { rows: enrichedWindow } = await pgPool().query<{ id: string; title: string }>(`
  SELECT id, title
  FROM articles
  WHERE enrichment_status = 'enriched'
    AND status = 'active'
  ORDER BY published_at DESC
  LIMIT 200
`)

const clusters = clusterArticles(enrichedWindow)

// Build a lookup: article_id -> { role, siblingCount, primaryId }
type ClusterInfo = {
  role: 'unique' | 'primary' | 'sibling'
  siblingCount: number
  primaryId: string | null
}
const clusterInfo = new Map<string, ClusterInfo>()
for (const c of clusters) {
  if (c.siblings.length === 0) {
    clusterInfo.set(c.primary.id, { role: 'unique', siblingCount: 0, primaryId: null })
  } else {
    clusterInfo.set(c.primary.id, { role: 'primary', siblingCount: c.siblings.length, primaryId: null })
    for (const sib of c.siblings) {
      clusterInfo.set(sib.id, { role: 'sibling', siblingCount: 0, primaryId: c.primary.id })
    }
  }
}

// Attach cluster info to each returned row
const articlesWithClusterInfo = (rows ?? []).map(r => ({
  ...r,
  cluster: clusterInfo.get(r.id) ?? { role: 'unique' as const, siblingCount: 0, primaryId: null },
}))

return NextResponse.json({
  articles: articlesWithClusterInfo,
  total: countRows[0]?.n ?? 0,
  page,
  page_size: PAGE_SIZE,
  facets,
})
```

Note: this depends on `clusterArticles` being exported from `src/lib/feed-scoring.ts` (Task 0.1) AND being reachable from `apps/ops`. The two Next.js apps can't directly import from each other. Mirror the function into `apps/ops/src/lib/feed-scoring.ts` — copy `clusterArticles`, `extractSignatureTokens`, `tokenSimilarity`, and the `NOISE_WORDS` set. Keep the implementations byte-identical. The pattern was already used for `source-detector-public.ts` in V2.

So actually the import is:

```ts
import { clusterArticles } from '@/lib/feed-scoring' // apps/ops/src/lib/feed-scoring.ts (mirror)
```

- [ ] **Step 3: Verify tsc**

```bash
cd apps/ops && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add apps/ops/src/app/api/articles/route.ts apps/ops/src/lib/feed-scoring.ts
git commit -m "feat(admin): GET /api/articles returns translations + cluster info

Extends the SELECT to include title_translations and summary_translations.
Computes cluster role (unique / primary / sibling) for each article by
running clusterArticles on the latest 200 enriched articles and looking
up each returned row. clusterArticles is mirrored into apps/ops/src/lib/
since the two Next.js apps can't share code directly."
```

### Task 4.2: `TranslationChips` component

**Files:**
- Create: `apps/ops/src/app/(app)/news-sources/TranslationChips.tsx`

- [ ] **Step 1: Create the component**

```tsx
// apps/ops/src/app/(app)/news-sources/TranslationChips.tsx
// 4 small locale chips showing translation coverage for an article.
// Each chip is filled (brand color) when BOTH title and summary
// translations exist for that locale, outlined / muted otherwise.

const LOCALES = ['es', 'pt', 'it', 'fr'] as const

interface Props {
  title_translations: Record<string, string> | null
  summary_translations: Record<string, string> | null
}

export function TranslationChips({ title_translations, summary_translations }: Props) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {LOCALES.map(loc => {
        const hasTitle = !!title_translations?.[loc]
        const hasSummary = !!summary_translations?.[loc]
        const complete = hasTitle && hasSummary
        return (
          <span
            key={loc}
            title={
              complete
                ? `${loc.toUpperCase()}: complete`
                : `${loc.toUpperCase()}: missing ${[
                    !hasTitle && 'title',
                    !hasSummary && 'summary',
                  ].filter(Boolean).join(' + ')}`
            }
            style={{
              display: 'inline-block',
              padding: '2px 6px',
              fontSize: 9, fontWeight: 800,
              letterSpacing: '0.05em',
              borderRadius: 3,
              background: complete ? 'var(--brand-primary)' : 'transparent',
              color: complete ? 'var(--brand-primary-fg)' : 'var(--status-neutral)',
              border: complete ? 'none' : '1px solid var(--border-subtle)',
            }}
          >
            {loc.toUpperCase()}
          </span>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Verify tsc**

```bash
cd apps/ops && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/app/\(app\)/news-sources/TranslationChips.tsx
git commit -m "feat(admin): TranslationChips — 4-locale coverage indicator"
```

### Task 4.3: `ClusterChip` component + column + filter

**Files:**
- Create: `apps/ops/src/app/(app)/news-sources/ClusterChip.tsx`
- Modify: `apps/ops/src/app/(app)/news-sources/ArticlesTable.tsx`

- [ ] **Step 1: Create the ClusterChip component**

```tsx
// apps/ops/src/app/(app)/news-sources/ClusterChip.tsx
// Small chip showing whether an article is unique / primary +N / sibling.

interface Props {
  role: 'unique' | 'primary' | 'sibling'
  siblingCount?: number
  primaryId?: string | null
  onSiblingClick?: (primaryId: string) => void
}

export function ClusterChip({ role, siblingCount, primaryId, onSiblingClick }: Props) {
  if (role === 'unique') {
    return (
      <span style={{
        fontSize: 10, color: 'var(--status-neutral)',
        padding: '2px 6px', border: '1px solid var(--border-subtle)',
        borderRadius: 3,
      }}>unique</span>
    )
  }
  if (role === 'primary') {
    return (
      <span style={{
        fontSize: 10, fontWeight: 700,
        color: 'var(--brand-primary-fg)', background: 'var(--brand-primary)',
        padding: '2px 6px', borderRadius: 3,
      }}>primary +{siblingCount}</span>
    )
  }
  // sibling
  return (
    <button
      type="button"
      onClick={() => primaryId && onSiblingClick?.(primaryId)}
      title={primaryId ? `Jump to primary (${primaryId})` : 'Sibling'}
      style={{
        fontSize: 10, fontWeight: 700,
        color: 'var(--status-warn)', background: 'transparent',
        padding: '2px 6px', border: '1px solid var(--status-warn)',
        borderRadius: 3, cursor: primaryId ? 'pointer' : 'default',
      }}
    >sibling</button>
  )
}
```

- [ ] **Step 2: Integrate both chips into `ArticlesTable.tsx`**

Add the imports:

```tsx
import { TranslationChips } from './TranslationChips'
import { ClusterChip } from './ClusterChip'
```

Extend the row type:

```tsx
interface ArticleRow {
  // ... existing fields ...
  title_translations: Record<string, string> | null
  summary_translations: Record<string, string> | null
  cluster: { role: 'unique' | 'primary' | 'sibling'; siblingCount: number; primaryId: string | null }
}
```

Add two new `<th>` cells in the table header (between Enriched and Published, per spec):

```tsx
<th align="left">Translations</th>
<th align="left">Cluster</th>
```

Add two new `<td>` cells in the row render:

```tsx
<td>
  <TranslationChips
    title_translations={article.title_translations}
    summary_translations={article.summary_translations}
  />
</td>
<td>
  <ClusterChip
    role={article.cluster.role}
    siblingCount={article.cluster.siblingCount}
    primaryId={article.cluster.primaryId}
    onSiblingClick={pid => {
      // Scroll to / highlight the primary's row
      const el = document.querySelector(`[data-article-id="${pid}"]`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }}
  />
</td>
```

And add `data-article-id={article.id}` to the row `<tr>` so the sibling jump works.

- [ ] **Step 3: Add filter chips for Translations + Cluster**

Find the existing filter chip row in ArticlesTable (uses the `source_key`, `language`, `enrichment_status` filters from PR #413). Add two new filter state vars + UI:

```tsx
const [translationsFilter, setTranslationsFilter] = useState<'all' | 'complete' | 'has-gaps'>('all')
const [clusterFilter, setClusterFilter] = useState<'all' | 'primary' | 'sibling' | 'unique'>('all')

// In the filter chip row JSX, append (using the same chip pattern as the existing filters):
<select value={translationsFilter} onChange={e => setTranslationsFilter(e.target.value as never)} style={selectStyle}>
  <option value="all">Translations: All</option>
  <option value="complete">Complete</option>
  <option value="has-gaps">Has gaps</option>
</select>

<select value={clusterFilter} onChange={e => setClusterFilter(e.target.value as never)} style={selectStyle}>
  <option value="all">Cluster: All</option>
  <option value="primary">Primary</option>
  <option value="sibling">Sibling</option>
  <option value="unique">Unique</option>
</select>
```

The filters are CLIENT-SIDE for now (apply on the rows already fetched):

```tsx
const filteredRows = rows.filter(r => {
  if (clusterFilter !== 'all' && r.cluster.role !== clusterFilter) return false
  if (translationsFilter === 'complete') {
    const allFilled = ['es', 'pt', 'it', 'fr'].every(l =>
      r.title_translations?.[l] && r.summary_translations?.[l]
    )
    if (!allFilled) return false
  }
  if (translationsFilter === 'has-gaps') {
    const allFilled = ['es', 'pt', 'it', 'fr'].every(l =>
      r.title_translations?.[l] && r.summary_translations?.[l]
    )
    if (allFilled) return false
  }
  return true
})
```

Then iterate over `filteredRows` instead of `rows`. Server-side filtering can come later if needed — at 50/page it's negligible client-side.

- [ ] **Step 4: Verify tsc**

```bash
cd apps/ops && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/app/\(app\)/news-sources/ClusterChip.tsx apps/ops/src/app/\(app\)/news-sources/ArticlesTable.tsx
git commit -m "feat(admin): Articles tab gets Translations + Cluster columns

Two new columns rendered per row:
- Translations: 4 locale chips (ES/PT/IT/FR) filled when both title
  and summary translations exist for that locale
- Cluster: unique / primary +N / sibling chip. Tapping a sibling
  scrolls the table to its primary

Plus two new filter chips (Translations: all/complete/has-gaps;
Cluster: all/primary/sibling/unique) applied client-side."
```

### Task 4.4: Discovery Health backfill button

**Files:**
- Modify: `apps/ops/src/app/(app)/news-sources/DiscoveryHealth.tsx`

- [ ] **Step 1: Read the existing component**

Run: `head -60 'apps/ops/src/app/(app)/news-sources/DiscoveryHealth.tsx'`

Look at the panel structure used for the quality distribution, recent auto-disables, and AI discovery runs panels (from PR #410).

- [ ] **Step 2: Add a new panel**

Inside the existing component layout (after the AI discovery runs panel is a sensible spot), add:

```tsx
const [backfillRunning, setBackfillRunning] = useState(false)
const [backfillResult, setBackfillResult] = useState<string | null>(null)

const runBackfill = async () => {
  setBackfillRunning(true)
  setBackfillResult(null)
  try {
    const r = await fetch('https://padelnachos.com/api/admin/backfill-title-translations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.NEXT_PUBLIC_CRON_SECRET ?? ''}` },
    })
    const data = await r.json().catch(() => ({}))
    if (r.ok) {
      setBackfillResult(`OK — translated ${data.updated_count ?? 0} articles (cost: $${(data.cost_usd ?? 0).toFixed(2)})`)
    } else {
      setBackfillResult(`Failed: ${data.error ?? r.status}`)
    }
  } catch (e) {
    setBackfillResult(`Error: ${(e as Error).message}`)
  } finally {
    setBackfillRunning(false)
  }
}

// In JSX:
<section style={{ padding: 16 }}>
  <h4 style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--status-neutral)', textTransform: 'uppercase' }}>
    Title translation backfill
  </h4>
  <p style={{ fontSize: 12, color: 'var(--status-neutral)', margin: '0 0 12px' }}>
    Runs the backfill cron for older enriched articles whose title was never translated.
    Currently 141 ES gaps + 76 PT gaps as of last check. Approx $0.30 / 200 articles.
  </p>
  <button
    onClick={runBackfill}
    disabled={backfillRunning}
    style={{
      background: 'var(--brand-primary)', color: 'var(--brand-primary-fg)',
      border: 0, padding: '8px 16px', fontWeight: 700, cursor: 'pointer',
      clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
    }}
  >
    {backfillRunning ? 'Running…' : 'Run title-translation backfill'}
  </button>
  {backfillResult && (
    <div style={{ marginTop: 10, fontSize: 12, color: 'var(--status-neutral)' }}>
      {backfillResult}
    </div>
  )}
</section>
```

**CRITICAL**: the `NEXT_PUBLIC_CRON_SECRET` exposes the cron secret to the browser, which is unsafe. **Don't do that.** Instead, proxy the request through a server-side route in `apps/ops` that reads `CRON_SECRET` from server env and forwards to the main app. Create:

`apps/ops/src/app/api/internal/trigger-translation-backfill/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const r = await fetch('https://padelnachos.com/api/admin/backfill-title-translations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  })
  const body = await r.json().catch(() => ({}))
  return NextResponse.json(body, { status: r.status })
}
```

And update the button to call `/api/internal/trigger-translation-backfill` (relative path on the admin app) instead of the cross-domain URL with secret.

- [ ] **Step 3: Verify tsc + build**

```bash
cd apps/ops && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add 'apps/ops/src/app/(app)/news-sources/DiscoveryHealth.tsx' apps/ops/src/app/api/internal/trigger-translation-backfill/
git commit -m "feat(admin): Discovery Health gets title-translation backfill button

New panel runs the existing /api/admin/backfill-title-translations
route via a server-side proxy on the admin app (avoids exposing
CRON_SECRET to the browser). Shows updated count and cost after run."
```

---

## Phase 5 — Observability

### Task 5.1: `ops_events` emission for `news_feed.deep_link_open`

**Files:**
- Modify: `src/hooks/useForYouOverlay.ts`
- Create: `src/app/api/internal/log-deep-link/route.ts`

- [ ] **Step 1: Create the logging endpoint**

```ts
// src/app/api/internal/log-deep-link/route.ts
// Server-side endpoint that the home rail / overlay calls when the user
// opens a deep-link. Writes an ops_event using the V2 schema
// (source / status / meta).

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    origin?: 'home_rail' | 'direct_url' | 'foryou_sibling'
    article_id?: string
    cluster_size?: number
  }
  if (!body.article_id || !body.origin) {
    return NextResponse.json({ error: 'missing origin or article_id' }, { status: 400 })
  }
  const supabase = createServerClient()
  await supabase.from('ops_events').insert({
    source: 'news_feed.deep_link_open',
    status: 'ok',
    meta: {
      origin: body.origin,
      article_id: body.article_id,
      cluster_size: body.cluster_size ?? 1,
    },
  })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Wire the emission into `useForYouOverlay`**

Extend `openForYou` to accept an optional `origin` + `clusterSize`:

```ts
// src/hooks/useForYouOverlay.ts
const openForYou = useCallback((
  id: string,
  meta?: { origin: 'home_rail' | 'foryou_sibling'; clusterSize?: number },
) => {
  setArticleId(id)
  setIsOpen(true)
  // Fire-and-forget log
  if (meta) {
    fetch('/api/internal/log-deep-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        origin: meta.origin,
        article_id: id,
        cluster_size: meta.clusterSize,
      }),
    }).catch(() => {})
  }
}, [])
```

For `direct_url` (someone landed on `/feed?tab=foryou&article=X` directly), add a separate logger inside `ForYouTab` mount:

```ts
useEffect(() => {
  if (pinnedFirst) {
    fetch('/api/internal/log-deep-link', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin: 'direct_url', article_id: pinnedFirst, cluster_size: 1 }),
    }).catch(() => {})
  }
}, []) // mount only
```

Update callers to pass the meta:

```tsx
// HighlightsPreview.tsx — card tap
openForYou(cluster.primary.id, { origin: 'home_rail', clusterSize: cluster.siblings.length + 1 })

// HighlightsPreview.tsx — sibling click in expanded chip
openForYou(sib.id, { origin: 'foryou_sibling', clusterSize: cluster.siblings.length + 1 })
```

- [ ] **Step 3: Smoke test**

After running the dev server, tap a card, then check the DB:

```bash
psql "$LOCAL_DB_URL" -c "SELECT source, status, meta, created_at FROM ops_events WHERE source = 'news_feed.deep_link_open' ORDER BY created_at DESC LIMIT 3;"
```

Expected: 1+ rows with `meta.origin` matching what was triggered.

- [ ] **Step 4: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useForYouOverlay.ts src/app/api/internal/log-deep-link/
git commit -m "feat(observability): log news_feed.deep_link_open ops_events

Fires server-side when a user opens For You via deep-link.
Meta records origin (home_rail / direct_url / foryou_sibling),
article_id, and cluster_size. Surfaced via Discovery Health
recent-events panel."
```

---

## Phase 6 — Final verification + PR

### Task 6.1: Run full test suite + open PR

- [ ] **Step 1: Run all tests**

```bash
# Main app tests
npx vitest run

# Admin app tests
cd apps/ops && npx vitest run
```

Expected: all tests pass. New tests in feed-scoring.test.ts, news-feed-queries.test.ts, and useForYouOverlay.test.tsx should be green.

- [ ] **Step 2: TypeScript + lint check**

```bash
# Main app
npx tsc --noEmit
npx eslint src/lib/news-feed-queries.ts src/lib/feed-scoring.ts src/hooks/useForYouOverlay.ts src/components/feed/foryou/ForYouOverlay.tsx src/components/home/HighlightsPreview.tsx 'src/app/[locale]/(app)/home/page.tsx' 'src/app/[locale]/(app)/layout.tsx'

# Admin app
cd apps/ops && npx tsc --noEmit
cd apps/ops && npx eslint 'src/app/(app)/news-sources/TranslationChips.tsx' 'src/app/(app)/news-sources/ClusterChip.tsx' 'src/app/(app)/news-sources/ArticlesTable.tsx' 'src/app/(app)/news-sources/DiscoveryHealth.tsx' src/app/api/articles/route.ts
```

Expected: zero TS errors, zero lint errors on touched files.

- [ ] **Step 3: End-to-end smoke (dev server, with the flag ON locally)**

```bash
# Make sure flag is ON locally
psql "$LOCAL_DB_URL" -c "UPDATE feature_flags SET enabled_local=true WHERE key='home_news_immersive_link';"

# Run dev server
npm run dev

# In another terminal, also run the admin app
cd apps/ops && PORT=3004 npm run dev
```

Manual smoke checklist:

```
Home + overlay (localhost:3001 or 3002 — main app):
[ ] Visit /home as gudenes@gmail.com (For You allow-list)
[ ] Scroll home news rail; see articles
[ ] Tap a card → overlay slides up over home
[ ] URL bar updates to /feed?tab=foryou&article=<uuid>
[ ] Swipe down on overlay top half → overlay slides down, home position preserved
[ ] Tap ‹ back chip → same dismiss
[ ] Hit browser back button → same dismiss
[ ] Tap card with +N sources chip; tap chip itself → sibling list expands
[ ] Tap a sibling row → overlay opens for that article
[ ] Hard-refresh while overlay is open → reload lands at /feed?tab=foryou&article=<uuid> as a route
[ ] With prefers-reduced-motion ON (DevTools rendering tab) → animation is instant

Admin (localhost:3004 — apps/ops):
[ ] Visit /news-sources?tab=articles
[ ] See new Translations column (4 chips per row, filled/outlined)
[ ] See new Cluster column (unique / primary +N / sibling)
[ ] Filter: Cluster: Primary → only primary rows visible
[ ] Filter: Translations: Has gaps → only incomplete rows visible
[ ] Click a sibling chip → table scrolls to the primary
[ ] Discovery Health tab → see Title translation backfill panel
[ ] Click "Run title-translation backfill" → result shows count + cost

ops_events:
[ ] After ~5 overlay opens, check DB:
    SELECT meta->>'origin', count(*) FROM ops_events
    WHERE source = 'news_feed.deep_link_open'
    GROUP BY meta->>'origin';
[ ] Expected origins: home_rail (most), foryou_sibling (some)
```

- [ ] **Step 4: Push branch + open PR**

```bash
git push -u origin feat/home-news-immersive-link

gh pr create --title "feat: home news → immersive For You overlay (with dedup + translations column)" \
  --body "$(cat <<'EOF'
## Summary

Aligns home rail + For You + admin Articles tab on a single shared query lib. Tapping a home news card now opens For You as an **overlay on top of home** — home stays mounted, no re-fetch, no scroll loss. Cross-source duplicates get a \`+N sources\` chip with inline expand.

Behind \`home_news_immersive_link\` feature flag (OFF in prod, ON in local).

Spec: \`docs/superpowers/specs/2026-05-28-home-news-immersive-link-design.md\`
Plan: \`docs/superpowers/plans/2026-05-28-home-news-immersive-link.md\`

## What's in the diff

- 17 tasks across 6 phases (~2 days of work)
- Core: \`src/lib/news-feed-queries.ts\` (new), \`clusterArticles\` extracted from feed-scoring, \`useForYouOverlay\` hook + provider, \`ForYouOverlay\` slide-up component
- Admin: Translations column (4 ES/PT/IT/FR chips), Cluster column (unique/primary+N/sibling), backfill-button panel
- Observability: \`news_feed.deep_link_open\` ops_events (origin: home_rail / direct_url / foryou_sibling)
- 17 unit tests passing (extracted clusterArticles + fetchClusteredNews + useForYouOverlay)

## Rollout

| Day | Action |
|---|---|
| 0 | Merge. Backend + admin changes live. Home UX unchanged (flag OFF). |
| 0–2 | Operator dogfoods flag ON locally + Vercel preview. Run translation backfill from admin. |
| 3 | Flip \`home_news_immersive_link.enabled = true\` in prod. All users see the new behavior. |
| 10 | Cleanup PR: delete \`NewsPeekSheet.tsx\` + translate-endpoint + flag. |

## Test plan
- [ ] Tap a news card on /home → overlay slides up
- [ ] Swipe down / back chip / browser back / ESC all dismiss with 280ms slide
- [ ] Home scroll position + state preserved across overlay open/close (no re-fetch)
- [ ] +N sources chip expands sibling sources inline; tap sibling opens overlay at that one
- [ ] /feed?tab=foryou&article=<uuid> opens as a route in a fresh tab (not overlay)
- [ ] prefers-reduced-motion → instant dismiss, no slide
- [ ] Admin Articles tab: Translations + Cluster columns render correctly with filters
- [ ] Discovery Health: Run-backfill button completes and shows count
- [ ] After dogfood: ops_events query shows news_feed.deep_link_open with origin distribution

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Auto-squash-merge after CI passes**

```bash
PR=$(gh pr list --head feat/home-news-immersive-link --json number -q '.[0].number')
gh pr merge $PR --squash --delete-branch --auto
```

After merge, monitor flag rollout per the rollout sequence in the spec (§11.2).

---

## Self-review checklist (run before handoff)

- [ ] Spec coverage: every section of `2026-05-28-home-news-immersive-link-design.md` maps to ≥1 task above
- [ ] No placeholders (TBD/TODO/"similar to Task N")
- [ ] Every code step shows actual code
- [ ] Type names consistent across tasks (ArticleRow, ClusteredArticle, useForYouOverlay, etc.)
- [ ] Migration filenames sorted chronologically (20260528_)
- [ ] All admin endpoints have auth checks (`session?.user?.isOperator`)
- [ ] Flag gate (`home_news_immersive_link`) wrapped around all UX changes

## Open risks called out for executor

1. **`ForYouTab` refactor (Task 1.2) is invasive.** The current component does its own fetch. Replacing with `fetchClusteredNews` may break some assumptions (e.g. pagination cursor, type of items rendered). If the refactor cascades, isolate it as its own commit and verify the route-mode `/feed?tab=foryou` still works before moving to Task 1.3.
2. **`clusterArticles` mirror in apps/ops.** Task 4.1 copies the function into `apps/ops/src/lib/feed-scoring.ts` to avoid cross-app imports. The two copies MUST stay byte-identical with `extractSignatureTokens`, `tokenSimilarity`, and `NOISE_WORDS`. If you change the main lib later, mirror the change. (Same pattern as `source-detector-public.ts` in V2.)
3. **`useSwipeDownToClose` signature.** Task 1.3 assumes `useSwipeDownToClose(ref, onClose)` — verify against the existing usage in `NewsPeekSheet.tsx` before wiring. If the API differs, adapt.
4. **Type cast `as never` in Task 3.3.** The legacy `setPeekArticle(article as never)` is intentional — `NewsPeekSheet` expects the old `NewsItem` shape but we're now passing `ArticleRow`. Casts go away in the cleanup PR (Day 10) when NewsPeekSheet is deleted.

---

**End of plan.** 17 tasks across 6 phases. Estimated 2–3 days of focused work.

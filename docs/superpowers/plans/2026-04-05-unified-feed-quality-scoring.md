# Unified Feed + Quality Scoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace tabbed Videos/News feed with a unified mixed feed, add quality scoring microservice (hourly Supabase Edge Function), impression tracking, admin quality dashboard with email-based auth.

**Architecture:** Phase 1 modifies the client-side feed scoring and page to mix content types with diversity constraints. Phase 2 adds server-side quality scoring via DB migration + Supabase Edge Function + impression tracking API. Phase 3 adds an admin dashboard at `/admin/feed` with email-based auth (`@padelnachos.com`).

**Tech Stack:** Next.js 16, React 19, Supabase (Edge Functions + PostgreSQL), TypeScript, IntersectionObserver

**Spec:** `docs/superpowers/specs/2026-04-05-unified-feed-quality-scoring-design.md`

---

## File Structure

| File | Action | Phase | Responsibility |
|------|--------|-------|---------------|
| `src/lib/feed-scoring.ts` | Modify | 1 | Add diversifyFeed, capSources, article click normalization, event anchoring |
| `src/app/(app)/feed/page.tsx` | Modify | 1+2 | Remove tabs, render mixed feed, add impression tracking |
| `supabase/migrations/20260405_quality_scoring.sql` | Create | 2 | Add quality_score, impression_count columns |
| `src/app/api/feed/impressions/route.ts` | Create | 2 | Batch impression tracking endpoint |
| `src/app/api/cron/quality-scores/route.ts` | Create | 2 | Vercel cron → compute quality scores |
| `src/lib/quality-scoring.ts` | Create | 2 | Quality score computation logic (shared between cron and dashboard) |
| `vercel.json` | Modify | 2 | Add hourly quality-scores cron |
| `src/lib/admin-auth.ts` | Create | 3 | Shared admin auth helper (isAdmin, getAdminSession) |
| `src/middleware.ts` | Modify | 3 | Add /admin/* email-based auth |
| `src/app/admin/feed/page.tsx` | Create | 3 | Quality dashboard UI |
| `src/app/api/admin/feed-quality/route.ts` | Create | 3 | Dashboard data API |

---

### Task 1: Feed Scoring — Diversity & Source Capping

**Files:**
- Modify: `src/lib/feed-scoring.ts`

- [ ] **Step 1: Add article click normalization**

In `src/lib/feed-scoring.ts`, find the `scoreItem` function where article base clicks are computed. The current code uses `click_count` directly for articles. Multiply by 10 to normalize against video view counts (which are divided by 100):

Find where articles get their base popularity (the `baseScore` helper or similar). For articles, change the clicks input from `item.click_count` to `item.click_count * 10`.

- [ ] **Step 2: Add `diversifyFeed` function**

Add after the `buildScoredFeed` function:

```typescript
/**
 * Enforce content type diversity — no more than maxConsecutive items
 * of the same type in a row. Swaps items to break streaks.
 */
export function diversifyFeed<T extends { type: string }>(
  items: T[],
  maxConsecutive = 2,
): T[] {
  const result = [...items]
  for (let i = maxConsecutive; i < result.length; i++) {
    let allSame = true
    for (let j = 1; j <= maxConsecutive; j++) {
      if (result[i].type !== result[i - j].type) { allSame = false; break }
    }
    if (!allSame) continue
    const otherType = result[i].type === 'video' ? 'news' : 'video'
    for (let k = i + 1; k < result.length; k++) {
      if (result[k].type === otherType) {
        ;[result[i], result[k]] = [result[k], result[i]]
        break
      }
    }
  }
  return result
}
```

- [ ] **Step 3: Add `capSources` function**

Add after `diversifyFeed`:

```typescript
/**
 * Cap items per source to prevent any single source/channel from dominating.
 */
export function capSources<T extends { type: string; data: any }>(
  items: T[],
  limit = 3,
): T[] {
  const counts: Record<string, number> = {}
  return items.filter(item => {
    const source = item.type === 'video'
      ? (item.data as any).channel_name
      : (item.data as any).source_name
    const key = `${item.type}:${source}`
    counts[key] = (counts[key] ?? 0) + 1
    return counts[key] <= limit
  })
}
```

- [ ] **Step 4: Add `ScoredItem` quality_score field**

Add `quality_score?: number | null` to both `ScoredHighlight` and `ScoredArticle` interfaces so it can be used in scoring when available:

In `ScoredArticle`, add:
```typescript
quality_score?: number | null
```

- [ ] **Step 5: Update scoring to use quality_score when available**

In the `scoreItem` function, where `source_weight` is used as the weight multiplier, change to:

```typescript
const effectiveWeight = (item.type === 'news' && (item as ScoredArticle).quality_score)
  ? (item as ScoredArticle).quality_score!
  : (item.type === 'news' ? (item as ScoredArticle).source_weight : ((item as ScoredHighlight).channel_quality_score ?? 1.0))
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/feed-scoring.ts
git commit -m "feat: add feed diversity, source capping, and quality_score support"
```

---

### Task 2: Unified Feed Page — Remove Tabs, Mix Content

**Files:**
- Modify: `src/app/(app)/feed/page.tsx`

- [ ] **Step 1: Remove ContentFilter type and filter state**

Remove the `ContentFilter` type definition (line ~143). Remove the `filter` state and `initialFilter` logic. Remove the `setFilter` calls.

- [ ] **Step 2: Remove tab buttons from render**

Remove the entire `{/* Category tabs */}` section that renders the Videos/News buttons (around lines 782-803).

- [ ] **Step 3: Combine items in buildScoredFeed call**

Replace the current `feedClusters` computation that filters by type:

```typescript
const feedClusters: FeedCluster<FeedItem>[] = (() => {
  const items: FeedItem[] = []
  for (const h of availableHighlights) items.push({ type: 'video', data: h })
  for (const a of visibleNews) items.push({ type: 'news', data: a })

  const toScorable = (item: FeedItem): ScoredHighlight | ScoredArticle => {
    if (item.type === 'video') {
      const h = item.data as Highlight
      return {
        type: 'video', id: h.id, title: h.title, channel_name: h.channel_name,
        published_at: h.published_at, view_count: h.view_count, like_count: h.like_count,
        channel_quality_score: h.channel_quality_score, category: h.category,
      }
    }
    const a = item.data as NewsItem
    return {
      type: 'news', id: a.id, title: a.title, source_name: a.source_name,
      published_at: a.published_at, click_count: a.click_count, source_weight: a.source_weight,
      language: a.language, category: a.category,
      quality_score: (a as any).quality_score,
    }
  }

  const ctx: ScoringContext = { prefs: feedPrefs, bookmarkedPlayerNames }
  const clusters = buildScoredFeed(items, toScorable, ctx)
  // Apply diversity and source capping
  const diversified = diversifyFeed(clusters)
  return capSources(diversified)
})()
```

Import `diversifyFeed` and `capSources` from `@/lib/feed-scoring`.

- [ ] **Step 4: Update rendering to handle mixed types**

Replace the current render that checks `filter` type with a single loop:

```typescript
{feedClusters.map((cluster, i) => {
  const item = cluster.primary
  const collapsed = cluster.collapsed.length

  return (
    <div key={`${item.type}-${item.type === 'video' ? (item.data as Highlight).id : (item.data as NewsItem).id}`}>
      {item.type === 'video' ? (
        <VideoCard
          item={item.data as Highlight}
          onPlay={setPlaying}
          onBroken={markBroken}
          onHide={hideFeedItem}
          hero={i === 0}
        />
      ) : (
        <NewsCard
          item={item.data as NewsItem}
          onClickArticle={handleArticleClick}
          bookmarked={bookmarkedArticles.has((item.data as NewsItem).id)}
          onToggleBookmark={toggleBookmarkArticle}
          onHide={hideFeedItem}
        />
      )}
      {collapsed > 0 && (
        <div style={{
          fontSize: 11, color: MUTED, padding: '6px 4px 0',
          fontWeight: 600, letterSpacing: '0.3px',
        }}>
          +{collapsed} similar {item.type === 'video' ? (collapsed === 1 ? 'video' : 'videos') : (collapsed === 1 ? 'article' : 'articles')}
        </div>
      )}
    </div>
  )
})}
```

- [ ] **Step 5: Also add quality_score to the articles fetch**

In the `fetchData` function, add `quality_score` to the articles select:

```typescript
.select('id, title, source_name, source_icon, source_key, url, image_url, snippet, language, published_at, category, click_count, source_weight, favicon_url, quality_score')
```

- [ ] **Step 6: Verify in browser**

Open `/feed` — should show mixed videos and news in one unified feed with no tabs. No more than 2 consecutive items of the same type. No source appearing more than 3 times.

- [ ] **Step 7: Commit**

```bash
git add src/app/(app)/feed/page.tsx
git commit -m "feat: unified mixed feed — remove tabs, interleave videos and news"
```

---

### Task 3: Event Anchoring Boost

**Files:**
- Modify: `src/app/(app)/feed/page.tsx`
- Modify: `src/lib/feed-scoring.ts`

- [ ] **Step 1: Add livePlayerNames to ScoringContext**

In `feed-scoring.ts`, extend `ScoringContext`:

```typescript
export interface ScoringContext {
  prefs: FeedPrefs
  bookmarkedPlayerNames?: Set<string>
  livePlayerNames?: Set<string>
  recentPlayerNames?: Set<string>
}
```

- [ ] **Step 2: Add event anchoring boost to scoreItem**

In the `scoreItem` function, after the bookmark boost, add:

```typescript
// Event anchoring: boost content about live/recent match players
if (ctx.livePlayerNames?.size) {
  const tokens = title.toLowerCase().split(/\s+/)
  const liveMatches = tokens.filter(t => ctx.livePlayerNames!.has(t)).length
  if (liveMatches >= 1) score *= 1.5
}
if (ctx.recentPlayerNames?.size) {
  const tokens = title.toLowerCase().split(/\s+/)
  const recentMatches = tokens.filter(t => ctx.recentPlayerNames!.has(t)).length
  if (recentMatches >= 1 && !(ctx.livePlayerNames?.size)) score *= 1.2
}
```

- [ ] **Step 3: Fetch live player names in feed page**

In the feed page, add a state and effect to fetch player names from live matches:

```typescript
const [livePlayerNames, setLivePlayerNames] = useState<Set<string>>(new Set())
const [recentPlayerNames, setRecentPlayerNames] = useState<Set<string>>(new Set())

useEffect(() => {
  async function fetchEventPlayers() {
    const { data: liveMatches } = await supabase
      .from('matches')
      .select('pair1_player1:players!matches_pair1_player1_id_fkey(name), pair1_player2:players!matches_pair1_player2_id_fkey(name), pair2_player1:players!matches_pair2_player1_id_fkey(name), pair2_player2:players!matches_pair2_player2_id_fkey(name)')
      .eq('status', 'live')
      .limit(20)

    const { data: recentMatches } = await supabase
      .from('matches')
      .select('pair1_player1:players!matches_pair1_player1_id_fkey(name), pair1_player2:players!matches_pair1_player2_id_fkey(name), pair2_player1:players!matches_pair2_player1_id_fkey(name), pair2_player2:players!matches_pair2_player2_id_fkey(name)')
      .eq('status', 'finished')
      .gte('finished_at', new Date(Date.now() - 6 * 3600000).toISOString())
      .limit(20)

    const extractNames = (matches: any[]) => {
      const names = new Set<string>()
      for (const m of matches) {
        for (const key of ['pair1_player1', 'pair1_player2', 'pair2_player1', 'pair2_player2']) {
          const p = (m as any)[key]
          if (p?.name) {
            const parts = p.name.trim().split(/\s+/)
            names.add(parts[parts.length - 1].toLowerCase())
          }
        }
      }
      return names
    }

    setLivePlayerNames(extractNames(liveMatches ?? []))
    setRecentPlayerNames(extractNames(recentMatches ?? []))
  }
  fetchEventPlayers()
}, [])
```

Then pass to the scoring context:

```typescript
const ctx: ScoringContext = { prefs: feedPrefs, bookmarkedPlayerNames, livePlayerNames, recentPlayerNames }
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/feed-scoring.ts src/app/(app)/feed/page.tsx
git commit -m "feat: event anchoring boost — prioritize content about live match players"
```

---

### Task 4: Database Migration

**Files:**
- Create: `supabase/migrations/20260405_quality_scoring.sql`

- [ ] **Step 1: Create the migration**

```sql
-- Add quality scoring and impression tracking columns
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS quality_score REAL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS impression_count INTEGER DEFAULT 0;

ALTER TABLE public.highlights
  ADD COLUMN IF NOT EXISTS impression_count INTEGER DEFAULT 0;

-- Index for quality dashboard queries
CREATE INDEX IF NOT EXISTS idx_articles_quality ON public.articles (quality_score) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_articles_impressions ON public.articles (impression_count) WHERE status = 'active';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260405_quality_scoring.sql
git commit -m "feat: add quality_score and impression_count columns"
```

---

### Task 5: Impression Tracking API

**Files:**
- Create: `src/app/api/feed/impressions/route.ts`
- Modify: `src/app/(app)/feed/page.tsx`

- [ ] **Step 1: Create the impressions API route**

Create `src/app/api/feed/impressions/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const items: { id: string; type: 'article' | 'video' }[] = body.items

    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
      return NextResponse.json({ error: 'Invalid items array (1-50)' }, { status: 400 })
    }

    const supabase = createServerClient()

    const articleIds = items.filter(i => i.type === 'article').map(i => i.id)
    const videoIds = items.filter(i => i.type === 'video').map(i => i.id)

    const promises: Promise<any>[] = []

    if (articleIds.length > 0) {
      promises.push(
        supabase.rpc('increment_impressions_articles', { article_ids: articleIds })
      )
    }
    if (videoIds.length > 0) {
      promises.push(
        supabase.rpc('increment_impressions_highlights', { highlight_ids: videoIds })
      )
    }

    await Promise.all(promises)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Add RPC functions to migration**

Update the migration file to include the RPC functions:

```sql
-- Batch increment impression_count for articles
CREATE OR REPLACE FUNCTION increment_impressions_articles(article_ids UUID[])
RETURNS void AS $$
  UPDATE public.articles
  SET impression_count = impression_count + 1
  WHERE id = ANY(article_ids);
$$ LANGUAGE sql;

-- Batch increment impression_count for highlights
CREATE OR REPLACE FUNCTION increment_impressions_highlights(highlight_ids UUID[])
RETURNS void AS $$
  UPDATE public.highlights
  SET impression_count = impression_count + 1
  WHERE id = ANY(highlight_ids);
$$ LANGUAGE sql;
```

- [ ] **Step 3: Add IntersectionObserver to feed page**

In the feed page, add impression tracking via IntersectionObserver:

```typescript
// Impression tracking
const impressionBuffer = useRef<Set<string>>(new Set())
const observerRef = useRef<IntersectionObserver | null>(null)

useEffect(() => {
  const flush = () => {
    if (impressionBuffer.current.size === 0) return
    const items = Array.from(impressionBuffer.current).map(key => {
      const [type, id] = key.split(':')
      return { id, type: type as 'article' | 'video' }
    })
    impressionBuffer.current.clear()
    fetch('/api/feed/impressions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    }).catch(() => {})
  }

  const interval = setInterval(flush, 30000)

  observerRef.current = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          const key = (entry.target as HTMLElement).dataset.impressionKey
          if (key) impressionBuffer.current.add(key)
        }
      }
    },
    { threshold: 0.5 },
  )

  return () => {
    clearInterval(interval)
    flush()
    observerRef.current?.disconnect()
  }
}, [])
```

Then wrap each feed item `<div>` with a `data-impression-key` and ref callback:

```typescript
<div
  key={...}
  data-impression-key={`${item.type}:${item.type === 'video' ? (item.data as Highlight).id : (item.data as NewsItem).id}`}
  ref={(el) => { if (el && observerRef.current) observerRef.current.observe(el) }}
>
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/feed/impressions/route.ts src/app/(app)/feed/page.tsx supabase/migrations/20260405_quality_scoring.sql
git commit -m "feat: add impression tracking with IntersectionObserver + batch API"
```

---

### Task 6: Quality Scoring Cron

**Files:**
- Create: `src/lib/quality-scoring.ts`
- Create: `src/app/api/cron/quality-scores/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Create quality scoring logic**

Create `src/lib/quality-scoring.ts`:

```typescript
// src/lib/quality-scoring.ts
// Computes quality_score for articles based on multiple signals.

export function computeArticleQuality(article: {
  title: string
  source_weight: number
  click_count: number
  impression_count: number
  quality_score: number | null
}, globalAvgCTR: number, sourceDailyCount: number): number {
  let q = article.source_weight ?? 1.0

  // Title quality (0.7–1.0)
  const tLen = article.title.length
  if (tLen < 20 || tLen > 120) q *= 0.8
  const capsWords = article.title.split(' ').filter(w => w === w.toUpperCase() && w.length > 2).length
  if (capsWords > 2) q *= 0.7
  if (/[!?]{2,}/.test(article.title)) q *= 0.8

  // Engagement rate (0.9–1.3)
  if (article.impression_count > 10) {
    const bayesian = (article.click_count + 20 * globalAvgCTR) / (article.impression_count + 20)
    q *= 0.9 + Math.min(bayesian * 4, 0.4) // scale to 0.9-1.3 range
  } else {
    q *= 1 + 0.1 * Math.log10(1 + article.click_count)
  }

  // Flood penalty
  if (sourceDailyCount > 5) q *= 0.8

  return Math.round(q * 100) / 100
}

export function computeVideoQuality(video: {
  title: string
  channel_quality_score: number | null
  duration: string | null
}): number {
  let q = video.channel_quality_score ?? 1.0

  // Duration quality (0.7–1.0)
  const dur = parseDurationSeconds(video.duration)
  if (dur < 30) q *= 0.7
  else if (dur < 60) q *= 0.85
  else if (dur > 2700) q *= 0.8

  // Title quality
  const tLen = video.title.length
  if (tLen < 10 || tLen > 150) q *= 0.8
  const capsWords = video.title.split(' ').filter(w => w === w.toUpperCase() && w.length > 2).length
  if (capsWords > 3) q *= 0.7

  return Math.round(q * 100) / 100
}

function parseDurationSeconds(dur: string | null): number {
  if (!dur) return 0
  const parts = dur.split(':').map(Number)
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return 0
}
```

- [ ] **Step 2: Create the cron API route**

Create `src/app/api/cron/quality-scores/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { computeArticleQuality, computeVideoQuality } from '@/lib/quality-scoring'

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()
  const since = new Date(Date.now() - 7 * 24 * 3600000).toISOString()

  // Fetch articles from last 7 days
  const { data: articles } = await supabase
    .from('articles')
    .select('id, title, source_name, source_weight, click_count, impression_count, quality_score, published_at')
    .eq('status', 'active')
    .gte('published_at', since)

  if (!articles || articles.length === 0) {
    return NextResponse.json({ ok: true, articles_scored: 0 })
  }

  // Compute global avg CTR
  const totalClicks = articles.reduce((s, a) => s + (a.click_count ?? 0), 0)
  const totalImpressions = articles.reduce((s, a) => s + (a.impression_count ?? 0), 0)
  const globalAvgCTR = totalImpressions > 0 ? totalClicks / totalImpressions : 0.05

  // Count articles per source in last 6 hours
  const recentSince = new Date(Date.now() - 6 * 3600000).toISOString()
  const sourceCounts: Record<string, number> = {}
  for (const a of articles) {
    if (a.published_at >= recentSince) {
      sourceCounts[a.source_name] = (sourceCounts[a.source_name] ?? 0) + 1
    }
  }

  // Score each article
  const updates: { id: string; quality_score: number }[] = []
  for (const a of articles) {
    const score = computeArticleQuality(a, globalAvgCTR, sourceCounts[a.source_name] ?? 0)
    if (Math.abs(score - (a.quality_score ?? 1.0)) > 0.01) {
      updates.push({ id: a.id, quality_score: score })
    }
  }

  // Batch update (chunks of 50)
  for (let i = 0; i < updates.length; i += 50) {
    const chunk = updates.slice(i, i + 50)
    for (const u of chunk) {
      await supabase.from('articles').update({ quality_score: u.quality_score }).eq('id', u.id)
    }
  }

  return NextResponse.json({
    ok: true,
    articles_scored: updates.length,
    global_avg_ctr: Math.round(globalAvgCTR * 10000) / 100,
  })
}
```

- [ ] **Step 3: Add cron to vercel.json**

Add to the `crons` array:

```json
{ "path": "/api/cron/quality-scores", "schedule": "7 * * * *" }
```

(Runs at :07 past every hour to avoid the :00 rush)

- [ ] **Step 4: Commit**

```bash
git add src/lib/quality-scoring.ts src/app/api/cron/quality-scores/route.ts vercel.json
git commit -m "feat: hourly quality scoring cron for articles"
```

---

### Task 7: Admin Auth Helper

**Files:**
- Create: `src/lib/admin-auth.ts`
- Modify: `src/middleware.ts`

- [ ] **Step 1: Create admin auth helper**

Create `src/lib/admin-auth.ts`:

```typescript
// src/lib/admin-auth.ts
// Email-based admin auth for /admin/* pages and API routes.
// Only @padelnachos.com emails are granted admin access.

import { createServerClient } from '@/lib/supabase'
import { NextRequest } from 'next/server'

const ADMIN_DOMAIN = 'padelnachos.com'

export function isAdminEmail(email: string | undefined | null): boolean {
  return !!email && email.endsWith(`@${ADMIN_DOMAIN}`)
}

/**
 * Verify admin access from an API route request.
 * Returns the user email if admin, null otherwise.
 */
export async function verifyAdminRequest(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.slice(7)
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser(token)

  if (error || !user) return null
  if (!isAdminEmail(user.email)) return null

  return user.email!
}
```

- [ ] **Step 2: Update middleware for /admin/* routes**

In `src/middleware.ts`, add admin route handling. The middleware can't directly check Supabase sessions (no async auth in Edge middleware easily), so use a simpler approach: let the page/API handle auth client-side, and the middleware just ensures the route is accessible:

After the existing ops handling, add:

```typescript
// Admin routes — auth is handled client-side via Supabase session
if (pathname.startsWith('/admin')) {
  // No server-side blocking in middleware — let the page component check auth
  return NextResponse.next()
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/admin-auth.ts src/middleware.ts
git commit -m "feat: add email-based admin auth helper (@padelnachos.com)"
```

---

### Task 8: Quality Dashboard — API Route

**Files:**
- Create: `src/app/api/admin/feed-quality/route.ts`

- [ ] **Step 1: Create the dashboard data API**

Create `src/app/api/admin/feed-quality/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { isAdminEmail } from '@/lib/admin-auth'

export async function GET(request: NextRequest) {
  // Auth: check Supabase session via cookie
  const supabase = createServerClient()

  // Try to get user from auth header or cookie
  const authHeader = request.headers.get('authorization')
  let email: string | null = null

  if (authHeader?.startsWith('Bearer ')) {
    const { data: { user } } = await supabase.auth.getUser(authHeader.slice(7))
    email = user?.email ?? null
  }

  // Fallback: check CRON_SECRET for ops compatibility
  if (!email) {
    const cronSecret = process.env.CRON_SECRET
    const cookieToken = request.cookies.get('ops_token')?.value
    if (cronSecret && cookieToken === cronSecret) {
      email = 'ops@padelnachos.com' // synthetic admin
    }
  }

  if (!isAdminEmail(email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const since24h = new Date(now.getTime() - 24 * 3600000).toISOString()
  const since7d = new Date(now.getTime() - 7 * 24 * 3600000).toISOString()

  // Fetch articles (7d)
  const { data: articles } = await supabase
    .from('articles')
    .select('id, title, source_name, quality_score, click_count, impression_count, published_at, status')
    .gte('published_at', since7d)
    .eq('status', 'active')

  // Fetch highlights (7d)
  const { data: highlights } = await supabase
    .from('highlights')
    .select('id, title, channel_name, channel_quality_score, view_count, impression_count, published_at, status')
    .gte('published_at', since7d)
    .eq('status', 'active')

  const arts = articles ?? []
  const vids = highlights ?? []

  // Overview stats
  const arts24h = arts.filter(a => a.published_at >= since24h)
  const vids24h = vids.filter(v => v.published_at >= since24h)
  const totalImpressions24h = [...arts24h, ...vids24h].reduce((s, i) => s + ((i as any).impression_count ?? 0), 0)
  const totalClicks24h = arts24h.reduce((s, a) => s + (a.click_count ?? 0), 0) + vids24h.reduce((s, v) => s + (v.view_count ?? 0), 0)

  const overview = {
    articles_24h: arts24h.length,
    articles_7d: arts.length,
    videos_24h: vids24h.length,
    videos_7d: vids.length,
    avg_quality_articles: arts.length > 0 ? Math.round(arts.reduce((s, a) => s + (a.quality_score ?? 1), 0) / arts.length * 100) / 100 : 0,
    avg_quality_videos: vids.length > 0 ? Math.round(vids.reduce((s, v) => s + (v.channel_quality_score ?? 1), 0) / vids.length * 100) / 100 : 0,
    impressions_24h: totalImpressions24h,
    ctr_24h: totalImpressions24h > 0 ? Math.round(totalClicks24h / totalImpressions24h * 10000) / 100 : 0,
  }

  // Source performance
  const sourceMap: Record<string, { type: string; items: number; totalQuality: number; clicks: number; impressions: number }> = {}
  for (const a of arts) {
    const key = `article:${a.source_name}`
    if (!sourceMap[key]) sourceMap[key] = { type: 'Article', items: 0, totalQuality: 0, clicks: 0, impressions: 0 }
    sourceMap[key].items++
    sourceMap[key].totalQuality += a.quality_score ?? 1
    sourceMap[key].clicks += a.click_count ?? 0
    sourceMap[key].impressions += a.impression_count ?? 0
  }
  for (const v of vids) {
    const key = `video:${v.channel_name}`
    if (!sourceMap[key]) sourceMap[key] = { type: 'Video', items: 0, totalQuality: 0, clicks: 0, impressions: 0 }
    sourceMap[key].items++
    sourceMap[key].totalQuality += v.channel_quality_score ?? 1
    sourceMap[key].clicks += v.view_count ?? 0
    sourceMap[key].impressions += v.impression_count ?? 0
  }
  const sources = Object.entries(sourceMap).map(([key, v]) => ({
    source: key.split(':').slice(1).join(':'),
    type: v.type,
    items: v.items,
    avg_quality: Math.round(v.totalQuality / v.items * 100) / 100,
    clicks: v.clicks,
    impressions: v.impressions,
    ctr: v.impressions > 0 ? Math.round(v.clicks / v.impressions * 10000) / 100 : 0,
  })).sort((a, b) => b.items - a.items)

  // Low quality items
  const lowQuality = arts
    .filter(a => (a.quality_score ?? 1) < 0.8)
    .map(a => ({ id: a.id, title: a.title, source: a.source_name, quality_score: a.quality_score, type: 'article' }))
    .sort((a, b) => (a.quality_score ?? 0) - (b.quality_score ?? 0))
    .slice(0, 20)

  // Daily content mix (last 7 days)
  const dailyMix: Record<string, { articles: number; videos: number; avgQuality: number; totalQuality: number }> = {}
  for (let d = 0; d < 7; d++) {
    const date = new Date(now.getTime() - d * 86400000).toISOString().slice(0, 10)
    dailyMix[date] = { articles: 0, videos: 0, avgQuality: 0, totalQuality: 0 }
  }
  for (const a of arts) {
    const date = a.published_at.slice(0, 10)
    if (dailyMix[date]) {
      dailyMix[date].articles++
      dailyMix[date].totalQuality += a.quality_score ?? 1
    }
  }
  for (const v of vids) {
    const date = v.published_at.slice(0, 10)
    if (dailyMix[date]) {
      dailyMix[date].videos++
      dailyMix[date].totalQuality += v.channel_quality_score ?? 1
    }
  }
  const contentMix = Object.entries(dailyMix).map(([date, v]) => ({
    date,
    articles: v.articles,
    videos: v.videos,
    avg_quality: (v.articles + v.videos) > 0 ? Math.round(v.totalQuality / (v.articles + v.videos) * 100) / 100 : 0,
  })).sort((a, b) => a.date.localeCompare(b.date))

  // Top performers
  const allItems = [
    ...arts.map(a => ({ id: a.id, title: a.title, type: 'article' as const, source: a.source_name, clicks: a.click_count ?? 0, impressions: a.impression_count ?? 0, quality: a.quality_score ?? 1 })),
    ...vids.map(v => ({ id: v.id, title: v.title, type: 'video' as const, source: v.channel_name, clicks: v.view_count ?? 0, impressions: v.impression_count ?? 0, quality: v.channel_quality_score ?? 1 })),
  ]
  const topPerformers = allItems
    .filter(i => i.impressions >= 10)
    .map(i => ({ ...i, ctr: Math.round(i.clicks / i.impressions * 10000) / 100 }))
    .sort((a, b) => b.ctr - a.ctr)
    .slice(0, 10)

  return NextResponse.json({ overview, sources, lowQuality, contentMix, topPerformers })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/admin/feed-quality/route.ts
git commit -m "feat: add feed quality dashboard API endpoint"
```

---

### Task 9: Quality Dashboard — UI Page

**Files:**
- Create: `src/app/admin/feed/page.tsx`

- [ ] **Step 1: Create the dashboard page**

Create `src/app/admin/feed/page.tsx` — a `'use client'` page that:

1. Checks if the user is signed in with `@padelnachos.com` email using `useAuth()`
2. If not admin: shows "Access denied" message with sign-in prompt
3. If admin: fetches data from `/api/admin/feed-quality` (passes Supabase access token in Authorization header)
4. Renders 5 sections:
   - **Overview cards** — grid of stat cards (articles count, videos count, avg quality, impressions, CTR)
   - **Source Performance** — sortable table with rows highlighted green (CTR > avg) or red (quality < 0.8)
   - **Low Quality Items** — list with "Hide" button per item
   - **Content Mix** — simple text-based daily breakdown (no chart library needed)
   - **Top Performers** — ranked list with CTR, clicks, impressions

Style: dark theme matching the app (`#1A1A1A` body, `#0A0A0A` cards), inline styles, no external dependencies.

Auth: use `useAuth()` hook → get `session.access_token` → pass as `Authorization: Bearer {token}` to the API.

The "Hide" button calls: `POST /api/admin/feed-quality/hide` with `{ id, type }` (or directly updates via Supabase client).

- [ ] **Step 2: Commit**

```bash
git add src/app/admin/feed/page.tsx
git commit -m "feat: add feed quality dashboard at /admin/feed"
```

---

### Task 10: End-to-End Verification

- [ ] **Step 1: Verify unified feed**

Open `/feed` — confirm mixed videos and news, no tabs, diversity enforced, source capping working.

- [ ] **Step 2: Verify impression tracking**

Open browser dev tools Network tab, scroll through feed items, confirm `POST /api/feed/impressions` fires every 30s with item IDs.

- [ ] **Step 3: Verify quality scoring cron**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/quality-scores
```

Expected: `{ ok: true, articles_scored: N, global_avg_ctr: X.XX }`

- [ ] **Step 4: Verify admin dashboard**

Sign in with a `@padelnachos.com` email, navigate to `/admin/feed`. Confirm all 5 sections render with data.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: address integration issues from unified feed testing"
```

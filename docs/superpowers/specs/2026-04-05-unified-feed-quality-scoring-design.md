# Unified Feed + Quality Scoring — Design Spec

**Date:** 2026-04-05
**Status:** Approved

---

## Overview

Replace the tabbed Videos/News feed with a single unified feed that intelligently mixes content types. Add a quality scoring microservice (Supabase Edge Function, hourly) that computes article/video quality scores. Add impression tracking to enable CTR-based ranking over time.

Two phases:
- **Phase 1:** Unified feed with diversity + source capping (client-side)
- **Phase 2:** Quality microservice + impression tracking (server-side)

---

## Phase 1: Unified Mixed Feed

### Remove Tabs

The feed page (`src/app/(app)/feed/page.tsx`) currently shows "Videos" and "News" tab buttons with a `ContentFilter` type. Remove the tabs entirely. Fetch both videos and articles, combine into one pool, score, diversify, render.

### Score Normalization

Videos and articles have different engagement scales (views vs clicks). Normalize before combining:

- **Videos:** `baseClicks = viewCount / 100` (already done in feed-scoring.ts)
- **Articles:** `baseClicks = clickCount × 10` (multiply up to compensate for the 100x scale difference)

This makes a video with 1,000 views (~10 baseClicks) comparable to an article with 1 click (~10 baseClicks).

### Unified Scoring Pipeline

Modify `buildScoredFeed` in `src/lib/feed-scoring.ts` to accept mixed items:

1. **Score** each item using existing formula: `freshness × popularity × source_weight × personalization_boosts`
2. **Cluster** (dedup) across types — a video and article about the same match topic get clustered, highest-scored item wins as primary
3. **Diversify** — enforce max 2 consecutive items of the same type. After sorting by score, scan the list and swap items that violate the constraint with the next item of the other type.
4. **Source cap** — max 3 items per source (channel_name for videos, source_name for articles) per feed page. Filter excess items after diversification.

### Diversity Algorithm (Score-Then-Diversify)

```typescript
function diversifyFeed(items: ScoredItem[], maxConsecutive = 2): ScoredItem[] {
  const result = [...items] // already sorted by score desc
  for (let i = maxConsecutive; i < result.length; i++) {
    // Check if last maxConsecutive items are same type
    let allSame = true
    for (let j = 1; j <= maxConsecutive; j++) {
      if (result[i].type !== result[i - j].type) { allSame = false; break }
    }
    if (!allSame) continue
    // Same type streak — find next item of other type and swap
    const otherType = result[i].type === 'video' ? 'news' : 'video'
    for (let k = i + 1; k < result.length; k++) {
      if (result[k].type === otherType) {
        const temp = result[i]
        result[i] = result[k]
        result[k] = temp
        break
      }
    }
  }
  return result
}
```

### Source Capping

```typescript
function capSources(items: ScoredItem[], limit = 3): ScoredItem[] {
  const counts: Record<string, number> = {}
  return items.filter(item => {
    const source = item.type === 'video' ? item.data.channel_name : item.data.source_name
    counts[source] = (counts[source] ?? 0) + 1
    return counts[source] <= limit
  })
}
```

### Feed Page Changes

**`src/app/(app)/feed/page.tsx`:**
- Remove `ContentFilter` type, `filter` state, and tab buttons
- Fetch both highlights AND articles in one pass (already done, just remove the filter gate)
- Combine into one `items` array before calling `buildScoredFeed`
- Remove the `filter === 'videos'` / `filter === 'news'` conditionals in render
- Render `VideoCard` or `NewsCard` based on item type in a single flat list

### Event Anchoring Boost

In `feed-scoring.ts`, add a boost for content mentioning players/tournaments with currently live or recently finished matches. This uses the same mechanism as the existing bookmark relevance boost:

- At feed load time, fetch live match player names (small query: `status = 'live'`, select player names)
- If any item title contains a live-match player name: ×1.5 boost
- If any item title contains a today-finished match player name: ×1.2 boost

This makes the feed feel contextually relevant during tournament days.

---

## Phase 2: Quality Scoring Microservice

### Supabase Edge Function

**Function name:** `compute-quality-scores`
**Trigger:** Called by Vercel cron every hour via `POST /api/cron/quality-scores`
**Runtime:** Deno (Supabase Edge Functions)

### Quality Score Formula

Computes `quality_score` (0.0–2.5 range) per article and highlight:

**Article quality:**
```
quality_score = source_tier
  × title_quality      (0.7–1.0)
  × entity_specificity (1.0–1.3)
  × engagement_rate    (0.9–1.3)
  × flood_penalty      (0.8–1.0)
```

| Signal | Formula | Range |
|--------|---------|-------|
| source_tier | Existing `source_weight` | 1.0–1.5 |
| title_quality | Penalize if <20 chars OR >120 chars OR >2 ALL-CAPS words OR `!?` spam | 0.7–1.0 |
| entity_specificity | Count player/tournament names in title (lookup against DB top 200 players + active tournaments) | 1.0 + min(matches, 3) × 0.1 |
| engagement_rate | Bayesian: `(clicks + 20 × globalAvgCTR) / (impressions + 20)`. Falls back to `1 + 0.1 × log10(1 + clicks)` when no impressions | 0.9–1.3 |
| flood_penalty | If source published >5 articles in the last 6 hours: ×0.8 | 0.8–1.0 |

**Video quality:**
```
quality_score = channel_quality_score    (already 1.0–1.8)
  × duration_quality                     (0.7–1.0)
  × title_quality                        (0.7–1.0)
```

| Signal | Formula | Range |
|--------|---------|-------|
| channel_quality_score | Already computed at sync time | 1.0–1.8 |
| duration_quality | <30s: 0.7, 30s–1min: 0.85, 1–10min: 1.0, 10–45min: 1.0, >45min: 0.8 | 0.7–1.0 |
| title_quality | Same clickbait detection as articles | 0.7–1.0 |

### DB Changes

**Migration: `20260405_quality_scoring.sql`**

```sql
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS quality_score REAL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS impression_count INTEGER DEFAULT 0;

ALTER TABLE public.highlights
  ADD COLUMN IF NOT EXISTS impression_count INTEGER DEFAULT 0;
-- highlights already has channel_quality_score which serves as quality_score
```

### Impression Tracking

**Client-side:**
- Use `IntersectionObserver` on each feed item
- Track which items enter the viewport (threshold: 50%, min 1 second visible)
- Batch-send impressions every 30 seconds: `POST /api/feed/impressions`
- Body: `{ items: [{ id: string, type: 'article' | 'video' }] }`

**API route: `POST /api/feed/impressions`**
- Batch upsert: increment `impression_count` on articles and highlights
- Rate limit: max 50 items per request, max 1 request per 10 seconds per IP

### Vercel Cron Entry

Add to `vercel.json`:
```json
{ "path": "/api/cron/quality-scores", "schedule": "0 * * * *" }
```

### Integration with Feed Scoring

In `feed-scoring.ts`, replace `source_weight` with `quality_score` in the base score formula when available:

```typescript
const effectiveWeight = item.quality_score ?? item.source_weight ?? 1.0
baseScore = freshness × popularity × effectiveWeight
```

---

## Files to Create/Modify

### Phase 1
| File | Action |
|------|--------|
| `src/lib/feed-scoring.ts` | Modify — add diversifyFeed, capSources, normalize video/article scores, event anchoring boost |
| `src/app/(app)/feed/page.tsx` | Modify — remove tabs, combine items, render mixed feed |

### Phase 2
| File | Action |
|------|--------|
| `supabase/migrations/20260405_quality_scoring.sql` | Create — add quality_score, impression_count columns |
| `supabase/functions/compute-quality-scores/index.ts` | Create — Edge Function for quality scoring |
| `src/app/api/cron/quality-scores/route.ts` | Create — Vercel cron to trigger Edge Function |
| `src/app/api/feed/impressions/route.ts` | Create — batch impression tracking endpoint |
| `src/app/(app)/feed/page.tsx` | Modify — add IntersectionObserver for impression tracking |
| `src/lib/feed-scoring.ts` | Modify — use quality_score in scoring formula |

---

## Out of Scope

- ML-based content scoring
- A/B testing framework (future: hash-based variant assignment)
- MMR diversity algorithm (future refinement if feed still feels repetitive)
- User-level feed personalization settings UI
- Content recommendation engine ("you might also like")

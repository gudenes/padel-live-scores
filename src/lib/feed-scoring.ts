// src/lib/feed-scoring.ts
// Enhanced feed scoring with personalization signals.
// Pure functions — no side effects, no hooks, no React.

import type { FeedPrefs } from '@/hooks/useFeedPreferences'

// ── Types ──────────────────────────────────────────────────────────────────

export interface ScoredHighlight {
  type: 'video'
  id: string
  title: string
  channel_name: string
  published_at: string
  view_count: number
  like_count?: number
  channel_quality_score?: number | null
  category: string | null
}

export interface ScoredArticle {
  type: 'news'
  id: string
  title: string
  source_name: string
  published_at: string
  click_count: number
  source_weight: number
  quality_score?: number | null
  language: string | null
  category: string | null
}

type ScoredItem = ScoredHighlight | ScoredArticle

// ── Base score (unchanged formula) ─────────────────────────────────────────

function baseScore(publishedAt: string, clicks: number, weight: number): number {
  const hoursOld = (Date.now() - new Date(publishedAt).getTime()) / 3600000
  const freshness = Math.exp(-hoursOld / 48)
  const popularity = 1 + Math.log10(1 + clicks)
  return freshness * popularity * weight
}

// ── Signal: stale year penalty ─────────────────────────────────────────────

function staleYearPenalty(title: string): number {
  const currentYear = new Date().getFullYear()
  const match = title.match(/\b(20[0-9]{2})\b/)
  if (!match) return 1
  const year = parseInt(match[1])
  if (year < currentYear - 1) return 0.3 // 2+ years old
  if (year < currentYear) return 0.7     // last year
  return 1
}

// ── Signal: language affinity ──────────────────────────────────────────────

function languageBoost(language: string | null, langClicks: Record<string, number>): number {
  if (!language) return 1
  const total = Object.values(langClicks).reduce((a, b) => a + b, 0)
  if (total < 3) return 1 // not enough data yet
  const share = (langClicks[language] ?? 0) / total
  // Boost up to 1.3x for dominant language, never penalize
  return 1 + 0.3 * share
}

// ── Signal: category preference ────────────────────────────────────────────

function categoryBoost(category: string | null, catClicks: { men: number; women: number }): number {
  if (!category) return 1
  const total = catClicks.men + catClicks.women
  if (total < 5) return 1 // not enough data yet
  const preferred = catClicks.men > catClicks.women ? 'men' : 'women'
  // Only apply if there's a clear preference (>65% of clicks)
  const dominance = Math.max(catClicks.men, catClicks.women) / total
  if (dominance < 0.65) return 1
  return category === preferred ? 1.3 : 0.7
}

// ── Signal: channel engagement ─────────────────────────────────────────────

function channelBoost(channelName: string, channelPlays: Record<string, number>): number {
  const plays = channelPlays[channelName] ?? 0
  if (plays >= 5) return 1.3
  if (plays >= 3) return 1.15
  return 1
}

// ── Main scoring function ──────────────────────────────────────────────────

// ── Signal: bookmark relevance ─────────────────────────────────────────────

function bookmarkBoost(title: string, playerNames: Set<string>): number {
  if (playerNames.size === 0) return 1
  const lower = title.toLowerCase()
  let matches = 0
  for (const name of playerNames) {
    if (lower.includes(name)) matches++
  }
  if (matches >= 2) return 1.8 // Multiple player names — very relevant
  if (matches >= 1) return 1.4 // Single player name match
  return 1
}

export interface ScoringContext {
  prefs: FeedPrefs
  /** Lowercased player last names from bookmarked matches */
  bookmarkedPlayerNames?: Set<string>
  /** Lowercased player last names from currently live matches */
  livePlayerNames?: Set<string>
  /** Lowercased player last names from recently finished matches */
  recentPlayerNames?: Set<string>
}

export function scoreItem(item: ScoredItem, ctx: ScoringContext): number {
  const { prefs } = ctx
  let score: number

  if (item.type === 'video') {
    score = baseScore(item.published_at, Math.floor(item.view_count / 100), 1.0)
    score *= channelBoost(item.channel_name, prefs.channelPlays)
    // Low view count penalty — videos under 1K views are likely low quality
    if (item.view_count < 500) score *= 0.2
    else if (item.view_count < 1000) score *= 0.4
    else if (item.view_count < 2000) score *= 0.7
    // Server-computed channel quality (engagement rate + priority status)
    if (item.channel_quality_score && item.channel_quality_score !== 1.0) {
      score *= item.channel_quality_score
    }
    // Engagement rate boost: high like/view ratio = quality content
    if (item.like_count && item.view_count > 100) {
      const engRate = item.like_count / item.view_count
      // Typical YouTube engagement is 2-5%. Boost above-average content.
      if (engRate > 0.04) score *= 1.2
      else if (engRate > 0.02) score *= 1.1
    }
  } else {
    const weight = (item as ScoredArticle).quality_score != null
      ? (item as ScoredArticle).quality_score!
      : (item as ScoredArticle).source_weight
    score = baseScore(item.published_at, item.click_count * 10, weight)
    score *= languageBoost(item.language, prefs.langClicks)
  }

  // Common signals
  score *= staleYearPenalty(item.title)
  score *= categoryBoost(item.category, prefs.catClicks)
  score *= bookmarkBoost(item.title, ctx.bookmarkedPlayerNames ?? new Set())

  // Event anchoring: boost content about live/recent match players
  if (ctx.livePlayerNames?.size) {
    const tokens = item.title.toLowerCase().split(/\s+/)
    if (tokens.some(t => ctx.livePlayerNames!.has(t))) score *= 1.5
  } else if (ctx.recentPlayerNames?.size) {
    const tokens = item.title.toLowerCase().split(/\s+/)
    if (tokens.some(t => ctx.recentPlayerNames!.has(t))) score *= 1.2
  }

  return score
}

// ── Title-based dedup (match clustering) ───────────────────────────────────

// Common padel player last names — extracted from titles
// We normalize and compare overlapping name tokens between titles
const NOISE_WORDS = new Set([
  'premier', 'padel', 'highlights', 'highlight', 'final', 'finals',
  'semifinal', 'semifinals', 'semi', 'quarterfinal', 'quarterfinals',
  'quarter', 'round', 'match', 'best', 'points', 'point', 'live',
  'full', 'men', 'women', 'mens', 'womens', "men's", "women's",
  'p1', 'p2', 'major', 'master', 'open',
  'the', 'of', 'de', 'del', 'la', 'las', 'los', 'en', 'vs', 'and', 'y',
])

/**
 * Extract a simplified signature from a title for clustering.
 * Returns an array of significant name-like tokens.
 */
function extractSignatureTokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')     // strip punctuation
    .replace(/\b20\d{2}\b/g, '')  // strip years
    .split(/\s+/)
    .filter(w => w.length > 2 && !NOISE_WORDS.has(w))
    .filter(w => !/^\d+$/.test(w)) // strip numbers
}

/**
 * Compute similarity between two token sets (Jaccard-like).
 * Returns 0..1 where 1 = identical.
 */
function tokenSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  let intersection = 0
  for (const token of setA) {
    if (setB.has(token)) intersection++
  }
  const union = new Set([...a, ...b]).size
  return union > 0 ? intersection / union : 0
}

export interface FeedCluster<T> {
  primary: T
  score: number
  collapsed: T[]
}

/**
 * Score, sort, and deduplicate feed items.
 * Items with similar titles (>50% token overlap) are clustered.
 * The highest-scoring item in each cluster becomes the primary.
 */
export function buildScoredFeed<T extends { type: string; data: any }>(
  items: T[],
  getScorableItem: (item: T) => ScoredItem,
  ctx: ScoringContext,
  similarityThreshold = 0.5,
): FeedCluster<T>[] {
  // Score all items
  const scored = items.map(item => ({
    item,
    score: scoreItem(getScorableItem(item), ctx),
    tokens: extractSignatureTokens(
      getScorableItem(item).title
    ),
  }))

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score)

  // Cluster similar items
  const used = new Set<number>()
  const clusters: FeedCluster<T>[] = []

  for (let i = 0; i < scored.length; i++) {
    if (used.has(i)) continue
    used.add(i)

    const cluster: FeedCluster<T> = {
      primary: scored[i].item,
      score: scored[i].score,
      collapsed: [],
    }

    // Find similar items not yet clustered
    for (let j = i + 1; j < scored.length; j++) {
      if (used.has(j)) continue
      const sim = tokenSimilarity(scored[i].tokens, scored[j].tokens)
      if (sim >= similarityThreshold) {
        used.add(j)
        cluster.collapsed.push(scored[j].item)
      }
    }

    clusters.push(cluster)
  }

  return clusters
}

/**
 * Enforce type diversity in a sorted feed.
 * When `maxConsecutive` items in a row share the same type, the next item of
 * the other type is swapped forward to break the streak.
 */
export function diversifyFeed<T extends { type: string }>(items: T[], maxConsecutive = 2): T[] {
  const result = [...items]
  for (let i = maxConsecutive; i < result.length; i++) {
    // Check if the last maxConsecutive + 1 items are all the same type
    const currentType = result[i].type
    let allSame = true
    for (let k = 1; k <= maxConsecutive; k++) {
      if (result[i - k].type !== currentType) {
        allSame = false
        break
      }
    }
    if (!allSame) continue

    // Find the next item of a different type after i
    let swapIdx = -1
    for (let j = i + 1; j < result.length; j++) {
      if (result[j].type !== currentType) {
        swapIdx = j
        break
      }
    }
    if (swapIdx !== -1) {
      // Move the different-type item to just after i
      const tmp = result[swapIdx]
      result.splice(swapIdx, 1)
      result.splice(i + 1, 0, tmp)
    }
  }
  return result
}

/**
 * Cap the number of items from any single source.
 * Videos are keyed by `channel_name`; articles by `source_name`.
 * Items beyond the `limit` for a given source are dropped.
 */
export function capSources<T extends { type: string; data: any }>(items: T[], limit = 3): T[] {
  const counts: Record<string, number> = {}
  return items.filter(item => {
    const sourceKey =
      item.type === 'video'
        ? (item.data as { channel_name?: string }).channel_name ?? '__unknown__'
        : (item.data as { source_name?: string }).source_name ?? '__unknown__'
    counts[sourceKey] = (counts[sourceKey] ?? 0) + 1
    return counts[sourceKey] <= limit
  })
}

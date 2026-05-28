// apps/ops/src/lib/feed-scoring.ts
// MIRROR of clusterArticles + helpers from src/lib/feed-scoring.ts.
// The two apps can't share code directly. Keep these byte-identical with
// the main app's copy — change here, mirror there. Pattern same as
// source-detector-public.ts in the V2 source curation work.

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
export function extractSignatureTokens(title: string): string[] {
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
export function tokenSimilarity(a: string[], b: string[]): number {
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

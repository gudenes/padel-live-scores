// Closed topic vocabulary for news article classification.
// Passed to Claude as part of the enrichment system prompt; any
// topic Claude returns outside this list is silently dropped.

export const ARTICLE_TOPICS = [
  'transfer-news',
  'result-recap',
  'preview',
  'profile',
  'controversy',
  'olympics',
  'business',
] as const

export type ArticleTopic = (typeof ARTICLE_TOPICS)[number]

export function isValidTopic(s: string): s is ArticleTopic {
  return (ARTICLE_TOPICS as readonly string[]).includes(s)
}

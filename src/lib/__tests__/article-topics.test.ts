import { describe, expect, it } from 'vitest'
import { ARTICLE_TOPICS, isValidTopic, type ArticleTopic } from '../article-topics'

describe('article-topics', () => {
  it('exports a closed vocabulary of 7 topics', () => {
    expect(ARTICLE_TOPICS).toHaveLength(7)
    expect(ARTICLE_TOPICS).toEqual([
      'transfer-news', 'result-recap', 'preview',
      'profile', 'controversy', 'olympics', 'business',
    ])
  })

  it('isValidTopic returns true for valid topics', () => {
    expect(isValidTopic('transfer-news')).toBe(true)
    expect(isValidTopic('olympics')).toBe(true)
  })

  it('isValidTopic returns false for unknown strings (silently drops Claude hallucinations)', () => {
    expect(isValidTopic('made-up-topic')).toBe(false)
    expect(isValidTopic('')).toBe(false)
    expect(isValidTopic('TRANSFER-NEWS')).toBe(false)  // case-sensitive
  })
})

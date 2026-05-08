// src/lib/news-slug.test.ts
import { describe, expect, it } from 'vitest'
import { generateSlug } from './news-slug'

describe('generateSlug', () => {
  it('lowercases and hyphenates', () => {
    expect(generateSlug('Hello World')).toBe('hello-world')
  })

  it('strips accents', () => {
    expect(generateSlug('Acción Nueva')).toBe('accion-nueva')
  })

  it('removes punctuation', () => {
    expect(generateSlug('Partnership: A New Era!')).toBe('partnership-a-new-era')
  })

  it('collapses multiple spaces and hyphens', () => {
    expect(generateSlug('Hello   --  World')).toBe('hello-world')
  })

  it('trims leading/trailing hyphens', () => {
    expect(generateSlug('---hello---')).toBe('hello')
  })

  it('handles empty input', () => {
    expect(generateSlug('')).toBe('')
    expect(generateSlug('   ')).toBe('')
  })

  it('preserves digits', () => {
    expect(generateSlug('Top 10 Players 2026')).toBe('top-10-players-2026')
  })

  it('handles unicode emojis by stripping them', () => {
    expect(generateSlug('Big news 🎉 today')).toBe('big-news-today')
  })

  it('caps length at 80 chars (cuts on word boundary)', () => {
    const long = 'a'.repeat(50) + ' ' + 'b'.repeat(50)
    const result = generateSlug(long)
    expect(result.length).toBeLessThanOrEqual(80)
    expect(result).not.toMatch(/-$/)
  })
})

import { describe, it, expect } from 'vitest'
import { generateSlug } from '@/lib/news-slug'

// The news APIs now pass EVERY slug (client-sent or title-derived) through
// generateSlug. A trusted client slug once stored the full AI draft (1,890
// chars) as the slug of "Race to €1M", which 404'd on padelnachos.com.
describe('generateSlug as the news API slug guard', () => {
  it('caps a pasted-draft slug at 80 chars on a word boundary', () => {
    const pasted =
      'titulo-seo-race-to-1m-tapia-y-coello-lideran-las-ganancias-del-padel-profesional-2024-2026-url-sugerida-' +
      'padelnachos-com-race-to-1-millon-ganancias-padel-profesional-meta-descripcion-agustin-tapia'.repeat(10)
    const slug = generateSlug(pasted)
    expect(slug.length).toBeLessThanOrEqual(80)
    expect(slug.endsWith('-')).toBe(false)
  })

  it('leaves an already-valid slug unchanged', () => {
    expect(generateSlug('race-to-1m-tapia-coello-lead-pro-padel-earnings')).toBe(
      'race-to-1m-tapia-coello-lead-pro-padel-earnings',
    )
  })

  it('makes a hand-typed slug URL-safe', () => {
    expect(generateSlug('  Race to €1M: Tapia & Coello! ')).toBe('race-to-1m-tapia-coello')
  })
})

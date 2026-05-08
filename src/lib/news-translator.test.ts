// src/lib/news-translator.test.ts
import { describe, expect, it } from 'vitest'
import { parseTranslatorResponse, buildPrompt } from './news-translator'

describe('parseTranslatorResponse', () => {
  it('parses a valid JSON response', () => {
    const raw = '{"title":"Título","body_md":"Cuerpo","slug":"titulo"}'
    expect(parseTranslatorResponse(raw)).toEqual({
      title: 'Título',
      body_md: 'Cuerpo',
      slug: 'titulo',
    })
  })

  it('strips markdown code fences', () => {
    const raw = '```json\n{"title":"X","body_md":"Y","slug":"z"}\n```'
    expect(parseTranslatorResponse(raw)).toEqual({
      title: 'X',
      body_md: 'Y',
      slug: 'z',
    })
  })

  it('throws on missing required field', () => {
    const raw = '{"title":"X","slug":"z"}'
    expect(() => parseTranslatorResponse(raw)).toThrow(/body_md/)
  })

  it('throws on TRANSLATION_FAILED sentinel', () => {
    const raw = '{"title":"TRANSLATION_FAILED","body_md":"","slug":""}'
    expect(() => parseTranslatorResponse(raw)).toThrow(/TRANSLATION_FAILED/)
  })

  it('throws on malformed JSON', () => {
    expect(() => parseTranslatorResponse('not json')).toThrow()
  })
})

describe('buildPrompt', () => {
  it('includes locale name', () => {
    const prompt = buildPrompt({ title: 'Hi', body_md: 'Body', slug: 'hi' }, 'es')
    expect(prompt).toContain('Spanish')
  })

  it('includes the source content', () => {
    const prompt = buildPrompt({ title: 'Partnership', body_md: 'Body', slug: 'partnership' }, 'fr')
    expect(prompt).toContain('Partnership')
    expect(prompt).toContain('partnership')
  })
})

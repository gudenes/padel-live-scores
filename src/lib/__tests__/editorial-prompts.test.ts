// src/lib/__tests__/editorial-prompts.test.ts

import { describe, it, expect } from 'vitest'
import {
  buildEditorialUserPrompt,
  parseEditorialResponse,
  EditorialParseError,
  countWords,
  type PreviewInput,
  type RecapInput,
} from '../editorial-prompts'

const SAMPLE_PREVIEW_INPUT: PreviewInput = {
  kind: 'preview',
  tournament: {
    id: 't1',
    name: 'Milan P1 2026',
    level: 'p1',
    country: 'Italy',
    startsAt: '2026-05-05',
    endsAt: '2026-05-11',
    prizeMoney: '$525k',
  },
  previousEdition: {
    year: 2025,
    menChampion: { p1: 'Arturo Coello', p2: 'Agustin Galan' },
    womenChampion: null,
  },
  topMenSeeds: [
    { p1: 'Arturo Coello', p2: 'Agustin Galan', category: 'men', ranking: 2 },
  ],
  topWomenSeeds: [],
  totalMatches: 64,
}

const SAMPLE_RECAP_INPUT: RecapInput = {
  kind: 'recap',
  tournament: {
    id: 't1',
    name: 'Miami P1 2026',
    level: 'p1',
    country: 'USA',
    startsAt: '2026-04-06',
    endsAt: '2026-04-12',
    prizeMoney: '$525k',
  },
  menFinal: {
    category: 'men',
    winner: { p1: 'Arturo Coello', p2: 'Agustin Galan' },
    loser: { p1: 'Agustin Tapia', p2: 'Federico Chingotto' },
    sets: ['6-3', '3-6', '7-6(4)'],
    round: 'Final',
  },
  womenFinal: null,
  notableMatches: [],
  totalMatchesPlayed: 64,
}

// ─────────────────────────────────────────────────────────────────────
// buildEditorialUserPrompt
// ─────────────────────────────────────────────────────────────────────

describe('buildEditorialUserPrompt', () => {
  it('includes the kind in the prompt text', () => {
    const prompt = buildEditorialUserPrompt(SAMPLE_PREVIEW_INPUT)
    expect(prompt).toContain('tournament preview')
  })

  it('serializes the input as valid JSON inside the prompt', () => {
    const prompt = buildEditorialUserPrompt(SAMPLE_PREVIEW_INPUT)
    const match = prompt.match(/Data:\n([\s\S]+)$/)
    expect(match).not.toBeNull()
    const parsed = JSON.parse(match![1])
    expect(parsed.tournament.name).toBe('Milan P1 2026')
  })

  it('produces a different prompt for recap vs preview', () => {
    const a = buildEditorialUserPrompt(SAMPLE_PREVIEW_INPUT)
    const b = buildEditorialUserPrompt(SAMPLE_RECAP_INPUT)
    expect(a).not.toBe(b)
    expect(b).toContain('tournament recap')
  })
})

// ─────────────────────────────────────────────────────────────────────
// parseEditorialResponse — happy path
// ─────────────────────────────────────────────────────────────────────

describe('parseEditorialResponse — happy path', () => {
  it('parses a clean JSON response', () => {
    const raw = JSON.stringify({
      headline: 'Coello & Galán defend Milan title',
      lead: 'A 50-word lead goes here.',
      body: 'A 50-word lead goes here.\n\nParagraph two.\n\nParagraph three.',
      calloutKey: 'Defending champion',
      calloutValue: 'Coello / Galán · Milan P1 2025',
    })
    const out = parseEditorialResponse(raw)
    expect(out.headline).toBe('Coello & Galán defend Milan title')
    expect(out.calloutKey).toBe('Defending champion')
  })

  it('treats empty callout strings as null', () => {
    const raw = JSON.stringify({
      headline: 'H',
      lead: 'L',
      body: 'B',
      calloutKey: '',
      calloutValue: '',
    })
    const out = parseEditorialResponse(raw)
    expect(out.calloutKey).toBeNull()
    expect(out.calloutValue).toBeNull()
  })

  it('handles explicit null callouts', () => {
    const raw = JSON.stringify({
      headline: 'H', lead: 'L', body: 'B',
      calloutKey: null, calloutValue: null,
    })
    const out = parseEditorialResponse(raw)
    expect(out.calloutKey).toBeNull()
    expect(out.calloutValue).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────
// parseEditorialResponse — tolerance for dirty input
// ─────────────────────────────────────────────────────────────────────

describe('parseEditorialResponse — input tolerance', () => {
  it('strips a ```json code fence even though the prompt forbids it', () => {
    const raw = '```json\n{"headline":"H","lead":"L","body":"B","calloutKey":null,"calloutValue":null}\n```'
    const out = parseEditorialResponse(raw)
    expect(out.headline).toBe('H')
  })

  it('strips a bare ``` code fence', () => {
    const raw = '```\n{"headline":"H","lead":"L","body":"B","calloutKey":null,"calloutValue":null}\n```'
    const out = parseEditorialResponse(raw)
    expect(out.headline).toBe('H')
  })

  it('extracts the first balanced JSON object when Claude rambles before', () => {
    const raw = `Here you go:\n\n{"headline":"H","lead":"L","body":"B","calloutKey":null,"calloutValue":null}`
    const out = parseEditorialResponse(raw)
    expect(out.headline).toBe('H')
  })

  it('handles escaped quotes in string values', () => {
    const raw = '{"headline":"She said \\"hi\\"","lead":"L","body":"B","calloutKey":null,"calloutValue":null}'
    const out = parseEditorialResponse(raw)
    expect(out.headline).toBe('She said "hi"')
  })

  it('handles nested braces in string values', () => {
    const raw = '{"headline":"{test}","lead":"L","body":"B","calloutKey":null,"calloutValue":null}'
    const out = parseEditorialResponse(raw)
    expect(out.headline).toBe('{test}')
  })
})

// ─────────────────────────────────────────────────────────────────────
// parseEditorialResponse — error cases
// ─────────────────────────────────────────────────────────────────────

describe('parseEditorialResponse — errors', () => {
  it('throws on empty input', () => {
    expect(() => parseEditorialResponse('')).toThrow(EditorialParseError)
  })

  it('throws on no JSON object', () => {
    expect(() => parseEditorialResponse('just plain text')).toThrow(EditorialParseError)
  })

  it('throws on malformed JSON', () => {
    expect(() => parseEditorialResponse('{not valid}')).toThrow(EditorialParseError)
  })

  it('throws when a required field is missing', () => {
    const raw = JSON.stringify({ headline: 'H', lead: 'L' }) // no body
    expect(() => parseEditorialResponse(raw)).toThrow(EditorialParseError)
  })

  it('throws when a required field is the wrong type', () => {
    const raw = JSON.stringify({ headline: 123, lead: 'L', body: 'B' })
    expect(() => parseEditorialResponse(raw)).toThrow(EditorialParseError)
  })

  it('throws when Claude returns the INSUFFICIENT_DATA sentinel', () => {
    const raw = JSON.stringify({
      headline: 'INSUFFICIENT_DATA',
      lead: '',
      body: '',
      calloutKey: null,
      calloutValue: null,
    })
    expect(() => parseEditorialResponse(raw)).toThrow(/INSUFFICIENT_DATA/)
  })

  it('throws when callout values are numbers', () => {
    const raw = JSON.stringify({
      headline: 'H', lead: 'L', body: 'B',
      calloutKey: 42, calloutValue: null,
    })
    expect(() => parseEditorialResponse(raw)).toThrow(EditorialParseError)
  })
})

// ─────────────────────────────────────────────────────────────────────
// countWords
// ─────────────────────────────────────────────────────────────────────

describe('countWords', () => {
  it('counts single words', () => {
    expect(countWords('hello')).toBe(1)
  })

  it('counts multiple words separated by spaces', () => {
    expect(countWords('hello world this is four')).toBe(5)
  })

  it('handles multiple whitespace types', () => {
    expect(countWords('hello\tworld\nfoo  bar')).toBe(4)
  })

  it('trims surrounding whitespace', () => {
    expect(countWords('  hello world  ')).toBe(2)
  })

  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   ')).toBe(0)
  })
})

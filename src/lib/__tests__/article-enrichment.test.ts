import { describe, expect, it } from 'vitest'
import { parseClaudeResponse, validateEnrichmentShape } from '../article-enrichment'

describe('parseClaudeResponse', () => {
  it('parses a well-formed response', () => {
    const raw = JSON.stringify({
      summary_md: '• First bullet\n• Second bullet\n• Third bullet',
      entities: [
        { type: 'player', mention: 'Tapia', confidence: 0.9 },
      ],
      topics: [
        { topic: 'result-recap', confidence: 0.85 },
      ],
    })
    const parsed = parseClaudeResponse(raw)
    expect(parsed.summary_md).toContain('First bullet')
    expect(parsed.entities).toHaveLength(1)
    expect(parsed.topics[0].topic).toBe('result-recap')
  })

  it('throws on malformed JSON', () => {
    expect(() => parseClaudeResponse('not json')).toThrow()
  })

  it('strips fenced markdown if Claude includes it', () => {
    const raw = '```json\n{"summary_md":"x","entities":[],"topics":[]}\n```'
    const parsed = parseClaudeResponse(raw)
    expect(parsed.summary_md).toBe('x')
  })
})

describe('validateEnrichmentShape', () => {
  it('accepts a valid shape', () => {
    expect(() => validateEnrichmentShape({
      summary_md: '• a\n• b\n• c',
      entities: [{ type: 'player', mention: 'x', confidence: 0.8 }],
      topics: [{ topic: 'preview', confidence: 0.7 }],
    })).not.toThrow()
  })

  it('rejects entities with invalid type', () => {
    expect(() => validateEnrichmentShape({
      summary_md: '• a',
      entities: [{ type: 'invalid-type', mention: 'x', confidence: 0.8 }],
      topics: [],
    })).toThrow(/entity type/)
  })

  it('rejects topics outside the closed vocabulary', () => {
    expect(() => validateEnrichmentShape({
      summary_md: '• a',
      entities: [],
      topics: [{ topic: 'made-up', confidence: 0.7 }],
    })).toThrow(/topic/)
  })

  it('rejects confidence out of range', () => {
    expect(() => validateEnrichmentShape({
      summary_md: '• a',
      entities: [{ type: 'player', mention: 'x', confidence: 1.5 }],
      topics: [],
    })).toThrow(/confidence/)
  })
})

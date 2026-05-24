import { describe, it, expect } from 'vitest'
import { buildDiscoveryPrompt, SYSTEM_PROMPT_DISCOVERY } from '../discovery-prompt'

describe('discovery-prompt', () => {
  it('SYSTEM_PROMPT mentions output schema + quality constraints', () => {
    expect(SYSTEM_PROMPT_DISCOVERY).toMatch(/JSON array/i)
    expect(SYSTEM_PROMPT_DISCOVERY).toMatch(/url|name|language|rationale/i)
    expect(SYSTEM_PROMPT_DISCOVERY).toMatch(/at least weekly|spam|link farm/i)
  })

  it('buildDiscoveryPrompt includes existing source list', () => {
    const p = buildDiscoveryPrompt({
      focus: 'broad',
      maxCandidates: 10,
      existing: [{ key: 'foo', name: 'Foo', url: 'https://foo.com' }],
    })
    expect(p).toContain('Foo')
    expect(p).toContain('https://foo.com')
    expect(p).toContain('10')
  })

  it('buildDiscoveryPrompt expands focus presets', () => {
    expect(buildDiscoveryPrompt({ focus: 'spanish', maxCandidates: 5, existing: [] })).toMatch(/spanish|español/i)
    expect(buildDiscoveryPrompt({ focus: 'italian', maxCandidates: 5, existing: [] })).toMatch(/italian|italiano/i)
    expect(buildDiscoveryPrompt({ focus: 'brand', maxCandidates: 5, existing: [] })).toMatch(/brand|equipment/i)
    expect(buildDiscoveryPrompt({ focus: 'press', maxCandidates: 5, existing: [] })).toMatch(/press release|official tour/i)
  })

  it('buildDiscoveryPrompt accepts custom focus', () => {
    expect(buildDiscoveryPrompt({ focus: 'custom', customQuery: 'argentinian sources', maxCandidates: 5, existing: [] }))
      .toMatch(/argentinian sources/i)
  })
})

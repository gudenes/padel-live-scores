import { describe, it, expect } from 'vitest'
import { PAGE_COMMANDS, filterPages } from '../command-palette'

describe('command-palette pages', () => {
  it('indexes the main (app) pages', () => {
    expect(PAGE_COMMANDS.length).toBeGreaterThanOrEqual(20)
    expect(PAGE_COMMANDS.map((c) => c.href)).toContain('/news-sources')
    expect(PAGE_COMMANDS.map((c) => c.href)).toContain('/partners')
  })
  it('matches by label, case-insensitive', () => {
    expect(filterPages('player').map((c) => c.href)).toContain('/players')
  })
  it('matches by group', () => {
    expect(filterPages('system').length).toBeGreaterThanOrEqual(9)
  })
  it('returns all pages for empty query', () => {
    expect(filterPages('').length).toBe(PAGE_COMMANDS.length)
  })
  it('returns nothing for gibberish', () => {
    expect(filterPages('zzzznope')).toEqual([])
  })
})

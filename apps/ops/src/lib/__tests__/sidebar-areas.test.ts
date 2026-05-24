import { describe, it, expect } from 'vitest'
import { AREAS, areaFor, type AreaId } from '@/lib/sidebar-areas'

describe('sidebar-areas', () => {
  describe('AREAS', () => {
    it('exposes 5 areas in canonical order', () => {
      expect(AREAS.map(a => a.id)).toEqual([
        'home',
        'tournament-ops',
        'catalogs',
        'content',
        'system',
      ])
    })

    it('every area has at least one page', () => {
      AREAS.forEach(a => {
        expect(a.pages.length).toBeGreaterThan(0)
      })
    })

    it('every page has a unique href', () => {
      const hrefs = AREAS.flatMap(a => a.pages.map(p => p.href))
      expect(new Set(hrefs).size).toBe(hrefs.length)
    })
  })

  describe('areaFor', () => {
    const cases: Array<[string, AreaId]> = [
      ['/today', 'home'],
      ['/tournament-explorer', 'tournament-ops'],
      ['/entry-lists', 'tournament-ops'],
      ['/needs-review', 'tournament-ops'],
      ['/needs-review?queue=players', 'tournament-ops'],
      ['/simulator', 'tournament-ops'],
      ['/players', 'catalogs'],
      ['/players/abc-123', 'catalogs'],
      ['/brands', 'catalogs'],
      ['/streams', 'catalogs'],
      ['/yt-channels', 'catalogs'],
      ['/news', 'content'],
      ['/highlights', 'content'],
      ['/system/integration-health', 'system'],
      ['/system/data-quality', 'system'],
      ['/system/architecture', 'system'],
    ]

    cases.forEach(([path, expected]) => {
      it(`maps "${path}" → "${expected}"`, () => {
        expect(areaFor(path)).toBe(expected)
      })
    })

    it('unknown path falls back to "home"', () => {
      expect(areaFor('/garbage')).toBe('home')
      expect(areaFor('/')).toBe('home')
    })
  })
})

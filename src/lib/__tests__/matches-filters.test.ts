import { describe, it, expect } from 'vitest'
import {
  computeDateWindow,
  tabForLegacyParam,
  applyFilters,
  type MatchFilters,
} from '../matches-filters'

describe('computeDateWindow', () => {
  it('returns yesterday/today/tomorrow boundaries in user tz — UTC', () => {
    const now = new Date('2026-04-19T10:30:00Z')
    const w = computeDateWindow(now, 'UTC')
    expect(w.yesterdayStart).toBe('2026-04-18T00:00:00.000Z')
    expect(w.todayStart).toBe('2026-04-19T00:00:00.000Z')
    expect(w.tomorrowStart).toBe('2026-04-20T00:00:00.000Z')
  })

  it('shifts boundaries for America/New_York (UTC-4 in April)', () => {
    // 2026-04-19 02:30 UTC = 2026-04-18 22:30 ET → "today" in ET is still Apr 18
    const now = new Date('2026-04-19T02:30:00Z')
    const w = computeDateWindow(now, 'America/New_York')
    expect(w.yesterdayStart).toBe('2026-04-17T04:00:00.000Z') // Apr 17 00:00 ET
    expect(w.todayStart).toBe('2026-04-18T04:00:00.000Z')     // Apr 18 00:00 ET
    expect(w.tomorrowStart).toBe('2026-04-19T04:00:00.000Z')  // Apr 19 00:00 ET
  })

  it('falls back to UTC for invalid timezone', () => {
    const now = new Date('2026-04-19T10:30:00Z')
    const w = computeDateWindow(now, 'Not/A_Zone')
    expect(w.todayStart).toBe('2026-04-19T00:00:00.000Z')
  })
})

describe('tabForLegacyParam', () => {
  it('maps legacy tab values to new ones', () => {
    expect(tabForLegacyParam('live')).toBe('today')
    expect(tabForLegacyParam('upcoming')).toBe('upcoming')
    expect(tabForLegacyParam('results')).toBe('yesterday')
  })
  it('passes through new values unchanged', () => {
    expect(tabForLegacyParam('today')).toBe('today')
    expect(tabForLegacyParam('yesterday')).toBe('yesterday')
  })
  it('returns null for unknown values', () => {
    expect(tabForLegacyParam('foo')).toBe(null)
    expect(tabForLegacyParam(null)).toBe(null)
  })
})

describe('applyFilters', () => {
  const baseMatch = (over: any = {}) => ({
    id: 'm1',
    status: 'scheduled',
    category: 'men',
    round: 'Round 16',
    tournament: { id: 't1', level: 'p2' },
    pair1_player1: { id: 'p1' },
    pair1_player2: { id: 'p2' },
    pair2_player1: { id: 'p3' },
    pair2_player2: { id: 'p4' },
    ...over,
  })

  const noFilters: MatchFilters = {
    circuits: new Set(['premier', 'fip']),
    genders: new Set(['men', 'women']),
    levels: new Set(),
    favouritesOnly: false,
    hideQualifiers: false,
    favourites: { matches: new Set(), players: new Set(), tournaments: new Set() },
  }

  it('returns everything when no filters applied', () => {
    const matches = [baseMatch(), baseMatch({ id: 'm2', category: 'women' })]
    expect(applyFilters(matches, noFilters).length).toBe(2)
  })

  it('ANDs across categories, ORs within a category', () => {
    const matches = [
      baseMatch({ id: 'a', category: 'men',   tournament: { level: 'p1' } }),
      baseMatch({ id: 'b', category: 'women', tournament: { level: 'p1' } }),
      baseMatch({ id: 'c', category: 'men',   tournament: { level: 'fip_gold' } }),
    ]
    const f: MatchFilters = {
      ...noFilters,
      circuits: new Set(['premier']),          // excludes c
      genders: new Set(['men', 'women']),      // keeps a, b
    }
    const out = applyFilters(matches, f).map(m => m.id).sort()
    expect(out).toEqual(['a', 'b'])
  })

  it('levels set filters by tournament.level', () => {
    const matches = [
      baseMatch({ id: 'a', tournament: { level: 'p1' } }),
      baseMatch({ id: 'b', tournament: { level: 'p2' } }),
      baseMatch({ id: 'c', tournament: { level: 'fip_gold' } }),
    ]
    const f: MatchFilters = { ...noFilters, levels: new Set(['p1', 'fip_gold']) }
    const out = applyFilters(matches, f).map(m => m.id).sort()
    expect(out).toEqual(['a', 'c'])
  })

  it('hideQualifiers drops matches whose round looks like a qualifier', () => {
    const matches = [
      baseMatch({ id: 'a', round: 'Round 16' }),
      baseMatch({ id: 'b', round: 'Qualifying' }),
      baseMatch({ id: 'c', round: 'Q1' }),
      baseMatch({ id: 'd', round: 'Q2' }),
      baseMatch({ id: 'e', round: null }),
    ]
    const out = applyFilters(matches, { ...noFilters, hideQualifiers: true }).map(m => m.id).sort()
    expect(out).toEqual(['a', 'e'])
  })

  it('favouritesOnly keeps matches whose tournament or any player is followed', () => {
    const matches = [
      baseMatch({ id: 'a', tournament: { id: 't1', level: 'p2' } }),
      baseMatch({ id: 'b', tournament: { id: 't2', level: 'p2' },
                 pair1_player1: { id: 'x' }, pair1_player2: { id: 'y' },
                 pair2_player1: { id: 'z' }, pair2_player2: { id: 'w' } }),
      baseMatch({ id: 'c', tournament: { id: 't3', level: 'p2' },
                 pair1_player1: { id: 'x' }, pair1_player2: { id: 'y' },
                 pair2_player1: { id: 'z' }, pair2_player2: { id: 'q' } }),
    ]
    const f: MatchFilters = {
      ...noFilters,
      favouritesOnly: true,
      favourites: {
        matches: new Set(),
        players: new Set(['q']),       // triggers c
        tournaments: new Set(['t1']),  // triggers a
      },
    }
    const out = applyFilters(matches, f).map(m => m.id).sort()
    expect(out).toEqual(['a', 'c'])
  })

  it('compound filters — all predicates AND together', () => {
    const matches = [
      baseMatch({ id: 'a', category: 'men',   tournament: { level: 'p1' },     round: 'R16' }),
      baseMatch({ id: 'b', category: 'women', tournament: { level: 'p1' },     round: 'R16' }),
      baseMatch({ id: 'c', category: 'men',   tournament: { level: 'p1' },     round: 'Q1'  }),
    ]
    const f: MatchFilters = {
      ...noFilters,
      genders: new Set(['men']),
      levels: new Set(['p1']),
      hideQualifiers: true,
    }
    const out = applyFilters(matches, f).map(m => m.id).sort()
    expect(out).toEqual(['a'])
  })
})

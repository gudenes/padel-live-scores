import { describe, it, expect } from 'vitest'
import {
  compareTournamentsForCarousel,
  buildMatchInfoMap,
  getLocalDayBoundaryUTC,
  hasStarted,
  type TournamentForSort,
  type MatchForAggregation,
} from '../live-tournaments-carousel'

const makeT = (overrides: Partial<TournamentForSort>): TournamentForSort => ({
  id: 't1',
  level: 'p1',
  starts_at: '2026-05-20T00:00:00Z',
  ...overrides,
})

describe('compareTournamentsForCarousel', () => {
  it('puts Premier tiers before FIP tiers', () => {
    const a = makeT({ id: 'a', level: 'p1' })
    const b = makeT({ id: 'b', level: 'fip_gold' })
    const sorted = [b, a].sort(compareTournamentsForCarousel)
    expect(sorted.map(t => t.id)).toEqual(['a', 'b'])
  })

  it('orders Premier tiers most-prestigious first: finals, major, p1, p2', () => {
    const finals = makeT({ id: 'finals', level: 'finals' })
    const major = makeT({ id: 'major', level: 'major' })
    const p2 = makeT({ id: 'p2', level: 'p2' })
    const p1 = makeT({ id: 'p1', level: 'p1' })
    const sorted = [p2, p1, major, finals].sort(compareTournamentsForCarousel)
    expect(sorted.map(t => t.id)).toEqual(['finals', 'major', 'p1', 'p2'])
  })

  it('orders FIP tiers by canonical levelTierWeight: platinum, gold, silver, bronze, rise', () => {
    const rise = makeT({ id: 'rise', level: 'fip_rise' })
    const bronze = makeT({ id: 'bronze', level: 'fip_bronze' })
    const silver = makeT({ id: 'silver', level: 'fip_silver' })
    const gold = makeT({ id: 'gold', level: 'fip_gold' })
    const platinum = makeT({ id: 'platinum', level: 'fip_platinum' })
    const sorted = [rise, bronze, silver, gold, platinum].sort(compareTournamentsForCarousel)
    expect(sorted.map(t => t.id)).toEqual(['platinum', 'gold', 'silver', 'bronze', 'rise'])
  })

  it('breaks ties within the same tier by starts_at ascending', () => {
    const later = makeT({ id: 'later', level: 'p1', starts_at: '2026-06-01T00:00:00Z' })
    const earlier = makeT({ id: 'earlier', level: 'p1', starts_at: '2026-05-15T00:00:00Z' })
    const sorted = [later, earlier].sort(compareTournamentsForCarousel)
    expect(sorted.map(t => t.id)).toEqual(['earlier', 'later'])
  })

  it('sends unknown tier values to a low priority slot', () => {
    const known = makeT({ id: 'known', level: 'fip_bronze' })
    const unknown = makeT({ id: 'unknown', level: 'mystery_tier' })
    const sorted = [unknown, known].sort(compareTournamentsForCarousel)
    expect(sorted.map(t => t.id)).toEqual(['known', 'unknown'])
  })

  it('sends null level to the end', () => {
    const known = makeT({ id: 'known', level: 'p1' })
    const nullLvl = makeT({ id: 'null', level: null })
    const sorted = [nullLvl, known].sort(compareTournamentsForCarousel)
    expect(sorted.map(t => t.id)).toEqual(['known', 'null'])
  })

  it('sorts a realistic mixed Premier+FIP input end-to-end', () => {
    const rows = [
      makeT({ id: 'fip-gold',   level: 'fip_gold',   starts_at: '2026-05-10T00:00:00Z' }),
      makeT({ id: 'p1-late',    level: 'p1',         starts_at: '2026-06-01T00:00:00Z' }),
      makeT({ id: 'p1-early',   level: 'p1',         starts_at: '2026-05-15T00:00:00Z' }),
      makeT({ id: 'fip-bronze', level: 'fip_bronze', starts_at: '2026-05-09T00:00:00Z' }),
      makeT({ id: 'finals',     level: 'finals',     starts_at: '2026-05-20T00:00:00Z' }),
    ]
    expect(rows.sort(compareTournamentsForCarousel).map(t => t.id))
      .toEqual(['finals', 'p1-early', 'p1-late', 'fip-gold', 'fip-bronze'])
  })
})

describe('buildMatchInfoMap', () => {
  it('returns empty Map for empty input', () => {
    const m = buildMatchInfoMap([])
    expect(m.size).toBe(0)
  })

  it('counts matches per tournament_id', () => {
    const rows: MatchForAggregation[] = [
      { tournament_id: 'A' },
      { tournament_id: 'A' },
      { tournament_id: 'B' },
    ]
    const m = buildMatchInfoMap(rows)
    expect(m.get('A')?.matchesToday).toBe(2)
    expect(m.get('B')?.matchesToday).toBe(1)
  })
})

describe('getLocalDayBoundaryUTC', () => {
  it('returns ISO strings for start and end of the given local day', () => {
    const now = new Date('2026-05-20T15:30:00')
    const { startUTC, endUTC } = getLocalDayBoundaryUTC(now)
    expect(startUTC).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(endUTC).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    const ms = new Date(endUTC).getTime() - new Date(startUTC).getTime()
    // Span is normally ~24h, ~23h on DST spring-forward days, ~25h on fall-back days.
    expect(ms).toBeGreaterThan(22.5 * 3_600_000)
    expect(ms).toBeLessThan(25.5 * 3_600_000)
  })

  it('produces a start <= now <= end window', () => {
    const now = new Date('2026-05-20T15:30:00')
    const { startUTC, endUTC } = getLocalDayBoundaryUTC(now)
    expect(new Date(startUTC).getTime()).toBeLessThanOrEqual(now.getTime())
    expect(new Date(endUTC).getTime()).toBeGreaterThanOrEqual(now.getTime())
  })
})

describe('hasStarted', () => {
  it('returns true when starts_at is in the past', () => {
    const now = new Date('2026-05-26T12:00:00Z')
    const startsAt = new Date(now.getTime() - 1).toISOString()
    expect(hasStarted(startsAt, now)).toBe(true)
  })

  it('returns true when starts_at equals now', () => {
    const now = new Date('2026-05-26T12:00:00Z')
    expect(hasStarted(now.toISOString(), now)).toBe(true)
  })

  it('returns false when starts_at is in the future', () => {
    const now = new Date('2026-05-26T12:00:00Z')
    const startsAt = new Date(now.getTime() + 1).toISOString()
    expect(hasStarted(startsAt, now)).toBe(false)
  })

  it('returns false for a tournament starting 7 days from now', () => {
    const now = new Date('2026-05-26T12:00:00Z')
    const startsAt = new Date(now.getTime() + 7 * 86_400_000).toISOString()
    expect(hasStarted(startsAt, now)).toBe(false)
  })
})

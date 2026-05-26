import { describe, it, expect } from 'vitest'
import {
  compareTournamentsForCarousel,
  buildMatchInfoMap,
  getLocalDayBoundaryUTC,
  hasStarted,
  daysUntilStart,
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
    expect(hasStarted('2026-05-20T00:00:00Z', new Date('2026-05-21T00:00:00Z'))).toBe(true)
  })
  it('returns false when starts_at is in the future', () => {
    expect(hasStarted('2026-05-22T00:00:00Z', new Date('2026-05-21T00:00:00Z'))).toBe(false)
  })
  it('returns true at the exact starts_at instant', () => {
    expect(hasStarted('2026-05-21T12:00:00Z', new Date('2026-05-21T12:00:00Z'))).toBe(true)
  })
})

describe('daysUntilStart', () => {
  it('returns 0 for a tournament starting today', () => {
    expect(daysUntilStart('2026-05-21T08:00:00', new Date('2026-05-21T15:00:00'))).toBe(0)
  })
  it('returns 1 for tomorrow', () => {
    expect(daysUntilStart('2026-05-22T08:00:00', new Date('2026-05-21T15:00:00'))).toBe(1)
  })
  it('returns the calendar-day diff for 5 days out', () => {
    expect(daysUntilStart('2026-05-26T08:00:00', new Date('2026-05-21T15:00:00'))).toBe(5)
  })
  it('survives DST spring-forward (47h gap maps to 2 calendar days)', () => {
    // 2026 US DST starts 2026-03-08. Sun 2am skips to 3am; days 2026-03-08 to 2026-03-10 are 47h apart.
    expect(daysUntilStart('2026-03-10T08:00:00', new Date('2026-03-08T08:00:00'))).toBe(2)
  })
})

describe('compareTournamentsForCarousel: mixed live/upcoming window', () => {
  // Regression guard: Premier-first must hold even when ranking a Premier
  // event starting in 5 days against a FIP event running right now.
  it('Premier Major starting in 5d still beats FIP Silver running today', () => {
    const liveSilver = makeT({ id: 'silver-live', level: 'fip_silver', starts_at: '2026-05-20T00:00:00Z' })
    const futureMajor = makeT({ id: 'major-future', level: 'major', starts_at: '2026-05-26T00:00:00Z' })
    const sorted = [liveSilver, futureMajor].sort(compareTournamentsForCarousel)
    expect(sorted.map(t => t.id)).toEqual(['major-future', 'silver-live'])
  })
  it('within Premier tier, earlier starts_at wins regardless of live/upcoming', () => {
    const upcomingP1 = makeT({ id: 'p1-upcoming', level: 'p1', starts_at: '2026-05-22T00:00:00Z' })
    const liveP1 = makeT({ id: 'p1-live', level: 'p1', starts_at: '2026-05-21T00:00:00Z' })
    const sorted = [upcomingP1, liveP1].sort(compareTournamentsForCarousel)
    expect(sorted.map(t => t.id)).toEqual(['p1-live', 'p1-upcoming'])
  })
})

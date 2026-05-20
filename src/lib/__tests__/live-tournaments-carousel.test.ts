import { describe, it, expect } from 'vitest'
import {
  compareTournamentsForCarousel,
  buildMatchInfoMap,
  getLocalDayBoundaryUTC,
  TIER_RANK,
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
  it('puts Premier tiers (p1/p2/major/finals) before FIP tiers', () => {
    const a = makeT({ id: 'a', level: 'p1' })
    const b = makeT({ id: 'b', level: 'gold' })
    const sorted = [b, a].sort(compareTournamentsForCarousel)
    expect(sorted.map(t => t.id)).toEqual(['a', 'b'])
  })

  it('orders Premier tiers by static rank: p1, p2, major, finals', () => {
    const finals = makeT({ id: 'finals', level: 'finals' })
    const major = makeT({ id: 'major', level: 'major' })
    const p2 = makeT({ id: 'p2', level: 'p2' })
    const p1 = makeT({ id: 'p1', level: 'p1' })
    const sorted = [finals, major, p2, p1].sort(compareTournamentsForCarousel)
    expect(sorted.map(t => t.id)).toEqual(['p1', 'p2', 'major', 'finals'])
  })

  it('orders FIP tiers by static rank: gold, bronze, rise, future', () => {
    const future = makeT({ id: 'future', level: 'future' })
    const rise = makeT({ id: 'rise', level: 'rise' })
    const bronze = makeT({ id: 'bronze', level: 'bronze' })
    const gold = makeT({ id: 'gold', level: 'gold' })
    const sorted = [future, rise, bronze, gold].sort(compareTournamentsForCarousel)
    expect(sorted.map(t => t.id)).toEqual(['gold', 'bronze', 'rise', 'future'])
  })

  it('breaks ties within the same tier by starts_at ascending', () => {
    const later = makeT({ id: 'later', level: 'p1', starts_at: '2026-06-01T00:00:00Z' })
    const earlier = makeT({ id: 'earlier', level: 'p1', starts_at: '2026-05-15T00:00:00Z' })
    const sorted = [later, earlier].sort(compareTournamentsForCarousel)
    expect(sorted.map(t => t.id)).toEqual(['earlier', 'later'])
  })

  it('sends unknown tier values to the end', () => {
    const known = makeT({ id: 'known', level: 'bronze' })
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

  it('exports TIER_RANK with all expected keys', () => {
    expect(Object.keys(TIER_RANK).sort()).toEqual(
      ['bronze', 'finals', 'future', 'gold', 'major', 'p1', 'p2', 'rise'].sort()
    )
  })
})

describe('buildMatchInfoMap', () => {
  it('returns empty Map for empty input', () => {
    const m = buildMatchInfoMap([])
    expect(m.size).toBe(0)
  })

  it('counts matches per tournament_id', () => {
    const rows: MatchForAggregation[] = [
      { tournament_id: 'A', status: 'scheduled' },
      { tournament_id: 'A', status: 'finished' },
      { tournament_id: 'B', status: 'scheduled' },
    ]
    const m = buildMatchInfoMap(rows)
    expect(m.get('A')?.matchesToday).toBe(2)
    expect(m.get('B')?.matchesToday).toBe(1)
  })

  it('flags hasLiveMatch when at least one match has status live', () => {
    const rows: MatchForAggregation[] = [
      { tournament_id: 'A', status: 'scheduled' },
      { tournament_id: 'A', status: 'live' },
    ]
    expect(buildMatchInfoMap(rows).get('A')?.hasLiveMatch).toBe(true)
  })

  it('flags hasLiveMatch when status is on_court (warmup)', () => {
    const rows: MatchForAggregation[] = [
      { tournament_id: 'A', status: 'on_court' },
    ]
    expect(buildMatchInfoMap(rows).get('A')?.hasLiveMatch).toBe(true)
  })

  it('hasLiveMatch is false when no live/on_court matches', () => {
    const rows: MatchForAggregation[] = [
      { tournament_id: 'A', status: 'scheduled' },
      { tournament_id: 'A', status: 'finished' },
    ]
    expect(buildMatchInfoMap(rows).get('A')?.hasLiveMatch).toBe(false)
  })
})

describe('getLocalDayBoundaryUTC', () => {
  it('returns ISO strings for start and end of the given local day', () => {
    const now = new Date('2026-05-20T15:30:00')
    const { startUTC, endUTC } = getLocalDayBoundaryUTC(now)
    expect(startUTC).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(endUTC).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    const ms = new Date(endUTC).getTime() - new Date(startUTC).getTime()
    expect(ms).toBeGreaterThan(23 * 3_600_000)
    expect(ms).toBeLessThan(25 * 3_600_000)
  })

  it('produces a start <= now <= end window', () => {
    const now = new Date('2026-05-20T15:30:00')
    const { startUTC, endUTC } = getLocalDayBoundaryUTC(now)
    expect(new Date(startUTC).getTime()).toBeLessThanOrEqual(now.getTime())
    expect(new Date(endUTC).getTime()).toBeGreaterThanOrEqual(now.getTime())
  })
})

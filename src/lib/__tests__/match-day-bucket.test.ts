import { describe, expect, it } from 'vitest'
import { bucketDayMatches, bucketStatus, type DayMatch } from '../match-day-bucket'

function m(overrides: Partial<DayMatch> = {}): DayMatch {
  return {
    id: 'm1',
    status: 'scheduled',
    scheduled_at: null,
    finished_at: null,
    court: null,
    court_order: null,
    ...overrides,
  }
}

describe('bucketStatus', () => {
  it('maps scheduled/warming_up to upcoming', () => {
    expect(bucketStatus('scheduled')).toBe('upcoming')
    expect(bucketStatus('warming_up')).toBe('upcoming')
  })

  it('maps live/on_court/ended to live', () => {
    expect(bucketStatus('live')).toBe('live')
    expect(bucketStatus('on_court')).toBe('live')
    expect(bucketStatus('ended')).toBe('live')
  })

  it('maps finished/retired/walkover to finished', () => {
    expect(bucketStatus('finished')).toBe('finished')
    expect(bucketStatus('retired')).toBe('finished')
    expect(bucketStatus('walkover')).toBe('finished')
  })

  it('returns null for unknown statuses', () => {
    expect(bucketStatus('postponed')).toBeNull()
    expect(bucketStatus('')).toBeNull()
  })
})

describe('bucketDayMatches', () => {
  it('returns empty arrays when input is empty', () => {
    const out = bucketDayMatches([])
    expect(out.active).toEqual([])
    expect(out.finished).toEqual([])
  })

  it('partitions live + upcoming into active, finished into finished', () => {
    const matches = [
      m({ id: 'a', status: 'finished',  finished_at: '2026-05-14T12:00:00Z' }),
      m({ id: 'b', status: 'live',      scheduled_at: '2026-05-14T15:00:00Z' }),
      m({ id: 'c', status: 'scheduled', scheduled_at: '2026-05-14T17:00:00Z' }),
      m({ id: 'd', status: 'walkover',  finished_at: '2026-05-14T11:00:00Z' }),
      m({ id: 'e', status: 'warming_up',scheduled_at: '2026-05-14T16:00:00Z' }),
    ]
    const out = bucketDayMatches(matches)
    expect(out.active.map(x => x.id)).toEqual(['b', 'e', 'c'])  // 15 → 16 → 17
    expect(out.finished.map(x => x.id)).toEqual(['a', 'd'])     // 12 → 11 desc
  })

  it('sorts active by scheduled_at ascending; nulls last', () => {
    const matches = [
      m({ id: 'late',   scheduled_at: '2026-05-14T18:00:00Z' }),
      m({ id: 'null',   scheduled_at: null }),
      m({ id: 'early',  scheduled_at: '2026-05-14T11:00:00Z' }),
      m({ id: 'mid',    scheduled_at: '2026-05-14T15:00:00Z' }),
    ]
    const out = bucketDayMatches(matches)
    expect(out.active.map(x => x.id)).toEqual(['early', 'mid', 'late', 'null'])
  })

  it('tiebreaks active by court_order then court name when scheduled_at ties', () => {
    const t = '2026-05-14T16:00:00Z'
    const matches = [
      m({ id: 'c2', scheduled_at: t, court: 'Court 2',  court_order: 2 }),
      m({ id: 'c1', scheduled_at: t, court: 'Center',   court_order: 1 }),
      m({ id: 'c3', scheduled_at: t, court: 'Annexe',   court_order: null }),
      m({ id: 'c4', scheduled_at: t, court: 'Beta',     court_order: null }),
    ]
    const out = bucketDayMatches(matches)
    // court_order present wins over null; within same group, alphabetical
    expect(out.active.map(x => x.id)).toEqual(['c1', 'c2', 'c3', 'c4'])
  })

  it('sorts finished by finished_at descending; nulls last; tiebreak by id', () => {
    const matches = [
      m({ id: 'old',  status: 'finished', finished_at: '2026-05-14T10:00:00Z' }),
      m({ id: 'new',  status: 'finished', finished_at: '2026-05-14T14:00:00Z' }),
      m({ id: 'null', status: 'finished', finished_at: null }),
      m({ id: 'mid',  status: 'finished', finished_at: '2026-05-14T12:00:00Z' }),
    ]
    const out = bucketDayMatches(matches)
    expect(out.finished.map(x => x.id)).toEqual(['new', 'mid', 'old', 'null'])
  })

  it('drops matches with unknown statuses (does not crash)', () => {
    const matches = [
      m({ id: 'ok',  status: 'live',      scheduled_at: '2026-05-14T15:00:00Z' }),
      m({ id: 'bad', status: 'postponed', scheduled_at: '2026-05-14T16:00:00Z' }),
    ]
    const out = bucketDayMatches(matches)
    expect(out.active.map(x => x.id)).toEqual(['ok'])
    expect(out.finished).toEqual([])
  })
})

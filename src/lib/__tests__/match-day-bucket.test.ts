import { describe, expect, it } from 'vitest'
import { bucketDayMatches, bucketStatus, courtRank, type DayMatch } from '../match-day-bucket'

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

describe('courtRank', () => {
  it('returns 0 for center-court keywords (multilingual)', () => {
    expect(courtRank('COURT CENTRAL')).toBe(0)
    expect(courtRank('Court Central')).toBe(0)
    expect(courtRank('Center Court')).toBe(0)
    expect(courtRank('Centre Court')).toBe(0)
    expect(courtRank('PISTA CENTRAL')).toBe(0)
    expect(courtRank('Centro')).toBe(0)
    expect(courtRank('Campo Centrale')).toBe(0)
    expect(courtRank('Stadium Court')).toBe(0)
    expect(courtRank('Main Court')).toBe(0)
  })

  it('returns the integer for numbered courts', () => {
    expect(courtRank('Court 1')).toBe(1)
    expect(courtRank('COURT 2')).toBe(2)
    expect(courtRank('Pista 3')).toBe(3)
    expect(courtRank('Cancha 4')).toBe(4)
    expect(courtRank('Court 10')).toBe(10)
  })

  it('returns +Infinity for unrecognised names and null/empty input', () => {
    expect(courtRank(null)).toBe(Number.POSITIVE_INFINITY)
    expect(courtRank('')).toBe(Number.POSITIVE_INFINITY)
    expect(courtRank('Annexe Court')).toBe(Number.POSITIVE_INFINITY)
    expect(courtRank('Practice')).toBe(Number.POSITIVE_INFINITY)
  })

  it('prefers center keyword over a number when both appear', () => {
    expect(courtRank('Court Central 1')).toBe(0)
    expect(courtRank('Center Court 2')).toBe(0)
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

  it('prioritises Center over numbered courts when scheduled_at + court_order both tie (Buenos Aires P1 case)', () => {
    // Real-world data: padelgod populates court_order as a per-court time-slot
    // index (1st match on Court X = 1, 2nd on Court X = 2). All matches at
    // the same time slot share the same court_order, so the courtRank
    // tiebreak is what actually puts Center first.
    const t = '2026-05-14T16:00:00Z'
    const matches = [
      m({ id: 'c2',  scheduled_at: t, court: 'COURT 2',       court_order: 3 }),
      m({ id: 'cc',  scheduled_at: t, court: 'COURT CENTRAL', court_order: 3 }),
      m({ id: 'c3',  scheduled_at: t, court: 'COURT 3',       court_order: 3 }),
    ]
    const out = bucketDayMatches(matches)
    expect(out.active.map(x => x.id)).toEqual(['cc', 'c2', 'c3'])
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

  it('uses id ascending as final tiebreak when both finished_at and scheduled_at are null', () => {
    const matches = [
      m({ id: 'b', status: 'finished', finished_at: null, scheduled_at: null }),
      m({ id: 'a', status: 'finished', finished_at: null, scheduled_at: null }),
      m({ id: 'c', status: 'finished', finished_at: null, scheduled_at: null }),
    ]
    const out = bucketDayMatches(matches)
    expect(out.finished.map(x => x.id)).toEqual(['a', 'b', 'c'])
  })

  it('preserves insertion order for active when one match has a court name and the other does not', () => {
    // Documents current behavior: court name tiebreak only fires when both
    // courts are non-empty. With one null court, the comparator returns 0
    // and the sort engine keeps insertion order.
    const t = '2026-05-14T16:00:00Z'
    const matches = [
      m({ id: 'named', scheduled_at: t, court: 'Center', court_order: null }),
      m({ id: 'null',  scheduled_at: t, court: null,     court_order: null }),
    ]
    const out = bucketDayMatches(matches)
    expect(out.active.map(x => x.id)).toEqual(['named', 'null'])
  })
})

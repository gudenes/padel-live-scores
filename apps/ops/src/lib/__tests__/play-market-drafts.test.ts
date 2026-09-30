import { describe, it, expect } from 'vitest'
import { initialDrafts, validateDraft, draftBlockers, matchReady, type MatchCandidate } from '../play-market-drafts'
const now = Date.parse('2026-09-27T12:00:00Z')
const match: MatchCandidate = { id: 'match', title: 'A/B vs C/D', category: 'men', round: 'R32', scheduledAt: '2026-09-29T10:00:00Z', probability: .6, completePair: true, status: 'scheduled' }
describe('editorial market preparation', () => {
  it('uses the requested tournament and December 8 in Madrid, with no invented odds', () => {
    const drafts = initialDrafts()
    expect(drafts.filter(d=>d.kind==='tournament-bagel').map(d=>d.category)).toEqual(['men','women'])
    expect(drafts.filter(d=>d.kind==='tournament-bagel').every(d=>d.matchId===null)).toBe(true)
    expect(()=>validateDraft({...drafts[0],category:'both'})).toThrow()
    expect(drafts.find(d=>d.kind==='partnership')!.closesAt).toBe('2026-12-08T22:59:59.000Z')
    expect(drafts.every(d => d.openingProbability === null)).toBe(true)
  })
  it('excludes qualifying, started, unscheduled and unknown-player daily picks', () => {
    expect(matchReady(match, now)).toBe(true)
    for (const patch of [{ round: 'Q1' }, { scheduledAt: null }, { status: 'live' }, { completePair: false }, { scheduledAt: '2026-09-26T10:00:00Z' }]) expect(matchReady({ ...match, ...patch }, now)).toBe(false)
  })
  it('rejects invalid probabilities and estimates without a source', () => {
    for (const probability of [NaN, Infinity, 0, 1, '0.5']) expect(() => validateDraft({ ...initialDrafts()[0], openingProbability: probability })).toThrow()
    expect(() => validateDraft({ ...initialDrafts()[0], openingProbability: .5 })).toThrow('source')
  })
  it('does not allow changing the draft identity or injecting arbitrary storage paths', () => {
    expect(() => validateDraft({ ...initialDrafts()[0], id: '../secrets' })).toThrow()
    expect(() => validateDraft({ ...initialDrafts()[0], tournamentId: 'other' })).toThrow()
  })
  it('preserves unsupported-market blockers even after all editorial fields are filled', () => {
    for (const i of [0,1,3]) {
      const draft = validateDraft({ ...initialDrafts()[i], openingProbability: .5, probabilitySource: 'Editorial estimate, not a calibrated model.' })
      expect(draftBlockers(draft, [], now).some(b => b.includes('must be connected'))).toBe(true)
    }
  })
})

describe('daily pick main draw', () => {
  it.each(['R128','R64','R32','R16','QF','SF','F'])('offers %s when scheduled and complete', round => {
    expect(matchReady({ ...match, round }, now)).toBe(true)
  })
  it.each(['Q1','Q2','Q3','Q',''])('excludes %s', round => {
    expect(matchReady({ ...match, round }, now)).toBe(false)
  })
})

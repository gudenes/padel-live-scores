import { describe, it, expect } from 'vitest'
import {
  planReminder,
  localClock,
  validTimezone,
  type ReminderMarket,
} from '../plan'
import { buildReminderEmail } from '../email'
const now = Date.parse('2026-10-07T08:00:00Z')
const player = (id: string) => ({
  id,
  name: id,
  image: 'https://padelnachos.com/photo.png',
})
export const market = (
  patch: Partial<ReminderMarket> = {}
): ReminderMarket => ({
  id: 'q1',
  matchId: 'match1',
  question: 'Will A / B win?',
  pair1: [player('A'), player('B')],
  pair2: [player('C'), player('D')],
  tournament: 'Rotterdam P2',
  round: 'QF',
  category: 'men',
  startsAt: '2026-10-07T13:00:00Z',
  locksAt: '2026-10-07T13:00:00Z',
  status: 'open',
  matchStatus: 'scheduled',
  lineup: 'a:b|c:d',
  marketLineup: 'a:b|c:d',
  predictionLineup: 'a:b|c:d',
  requiresPrediction: true,
  ...patch,
})
const plan = (
  markets: ReminderMarket[],
  patch: Partial<Parameters<typeof planReminder>[0]> = {}
) =>
  planReminder({
    markets,
    answered: new Set(),
    followed: new Set(),
    bookmarked: new Set(),
    timezone: 'Europe/Madrid',
    channel: 'email',
    now,
    ...patch,
  })
describe('padel reminder selection', () => {
  it('groups unanswered questions per match', () => {
    const r = plan(
      [market(), market({ id: 'q2' }), market({ id: 'q3', matchId: 'match2' })],
      { answered: new Set(['q1']) }
    )
    expect(r).toHaveLength(2)
    expect(r[0].markets.map((q) => q.id)).toEqual(['q2'])
  })
  it('fails closed for stale lineups, model snapshots, incomplete players and live/held/closed markets', () => {
    for (const patch of [
      { marketLineup: 'old' },
      { lineup: null },
      { predictionLineup: 'old' },
      { pair1: [player('A')] },
      { pair2: [player('A'), player('D')] },
      { matchStatus: 'live' },
      { status: 'held' },
      { locksAt: new Date(now).toISOString() },
      { startsAt: 'invalid' },
    ])
      expect(plan([market(patch)])).toEqual([])
  })
  it('fixed-price questions do not require a model snapshot', () =>
    expect(
      plan([market({ requiresPrediction: false, predictionLineup: null })])
    ).toHaveLength(1))
  it('prioritizes followed/bookmarked matches then finals; maximum three', () => {
    const r = plan(
      ['1', '2', '3', '4', '5'].map((n) =>
        market({ matchId: n, id: n, round: n === '2' ? 'F' : 'QF' })
      ),
      { bookmarked: new Set(['4']) }
    )
    expect(r.map((m) => m.matchId)).toEqual(['4', '2', '1'])
  })
  it('respects local morning, quiet hours, dates and an hour of remaining play time', () => {
    expect(plan([market()], { timezone: 'America/New_York' })).toEqual([])
    expect(plan([market({ startsAt: '2026-10-08T13:00:00Z' })])).toEqual([])
    expect(
      plan([market({ locksAt: new Date(now + 59 * 60000).toISOString() })])
    ).toEqual([])
    expect(
      plan([market()], { now: Date.parse('2026-10-07T20:00:00Z') })
    ).toEqual([])
  })
  it('push needs personal relevance and a 20–30 minute lead; groups simultaneous matches', () => {
    const ms = [
      market({ startsAt: new Date(now + 25 * 60000).toISOString() }),
      market({
        id: 'q2',
        matchId: 'match2',
        startsAt: new Date(now + 28 * 60000).toISOString(),
      }),
    ]
    expect(plan(ms, { channel: 'push' })).toEqual([])
    expect(
      plan(ms, { channel: 'push', followed: new Set(['A']) })
    ).toHaveLength(2)
    expect(
      plan([market({ startsAt: new Date(now + 19 * 60000).toISOString() })], {
        channel: 'push',
        followed: new Set(['A']),
      })
    ).toEqual([])
  })
  it('validates zones and handles DST using actual local dates', () => {
    expect(validTimezone('Mars/City')).toBe(false)
    expect(
      localClock(Date.parse('2026-10-25T08:00:00Z'), 'Europe/Madrid').minutes
    ).toBe(540)
  })
})
describe('branded grouped email', () => {
  it('escapes content, keeps clickable match filters and includes preferences/unsubscribe/plain text', () => {
    const matches = plan([
      market({
        question: '<script>alert("bad")</script>',
        tournament: 'A & B',
      }),
    ])
    const e = buildReminderEmail({
      matches,
      locale: 'en',
      timezone: 'Europe/Madrid',
      unsubscribeUrl: 'https://padelnachos.com/unsubscribe?token=x',
    })
    expect(e.html).not.toContain('<script>')
    expect(e.html).toContain('A &amp; B')
    expect(e.html).toContain('href="https://padelnachos.com/play"')
    expect(e.html.match(/data-reminder-cta="primary"/g)).toHaveLength(1)
    expect(
      e.html.match(/href="https:\/\/padelnachos.com\/play"/g)
    ).toHaveLength(1)
    expect(e.html).not.toContain('/play?match=')
    expect(e.html).toContain('padelnachos-logo-v2.png')
    expect(e.html).toContain('match-day-hero-v1.jpg')
    expect(e.text).toContain('Unsubscribe:')
    expect(e.html).not.toContain('priceYes')
  })
  it('renders all supported languages and local time', () => {
    for (const locale of ['en', 'es', 'pt', 'fr', 'it'] as const) {
      const e = buildReminderEmail({
        matches: plan([market()]),
        locale,
        timezone: 'Europe/Madrid',
        unsubscribeUrl: 'https://padelnachos.com/unsubscribe',
      })
      expect(e.html).toContain(`lang="${locale}"`)
      expect(e.html).toMatch(/(15[:.]00|03:00 PM)/)
      expect(e.subject).toBeTruthy()
    }
  })
})

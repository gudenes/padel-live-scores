import { describe, it, expect } from 'vitest'
import { isApproximateLabel, formatDigestBody, groupRecipients, type DigestMatch } from '@/lib/matchday-digest'

describe('isApproximateLabel', () => {
  it('flags Not before / Followed by as approximate', () => {
    expect(isApproximateLabel('Not before 18:00')).toBe(true)
    expect(isApproximateLabel('Followed by')).toBe(true)
    expect(isApproximateLabel('Starting at 18:00')).toBe(false)
    expect(isApproximateLabel(null)).toBe(false)
  })
})

describe('formatDigestBody', () => {
  it('lists entries, marks approximate, caps at 4 with +N more', () => {
    const items = [
      { label: 'Tapia', time: '16:00', approximate: false },
      { label: 'Galán', time: '17:30', approximate: true },
      { label: 'Coello', time: '18:00', approximate: false },
      { label: 'Lebrón', time: '19:00', approximate: false },
      { label: 'Stupa', time: '20:00', approximate: false },
    ]
    expect(formatDigestBody(items)).toBe('Tapia 16:00 · Galán 17:30* · Coello 18:00 · Lebrón 19:00 · +1 more')
  })
})

describe('groupRecipients', () => {
  it('maps each user to the matches they follow (player) or bookmarked', () => {
    const matches: DigestMatch[] = [
      { matchId: 'm1', players: ['p1', 'p2'] },
      { matchId: 'm2', players: ['p3', 'p4'] },
    ]
    const playerFollows = [{ user_id: 'u1', target_id: 'p1' }, { user_id: 'u2', target_id: 'p3' }]
    const matchBookmarks = [{ user_id: 'u1', target_id: 'm2' }]
    const g = groupRecipients(matches, playerFollows, matchBookmarks)
    expect(g.get('u1')!.sort()).toEqual(['m1', 'm2'])
    expect(g.get('u2')).toEqual(['m2'])
  })
})

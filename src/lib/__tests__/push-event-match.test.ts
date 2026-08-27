import { describe, expect, it } from 'vitest'
import { matchIdFromEvent } from '@/lib/push-event-match'

describe('matchIdFromEvent', () => {
  it('uses entityId when the entity is a match', () => {
    expect(matchIdFromEvent({ entityType: 'match', entityId: 'abc', url: '/', metadata: {} })).toBe('abc')
  })
  it('reads metadata.match_id for player-scoped events', () => {
    expect(matchIdFromEvent({
      entityType: 'player',
      entityId: 'p1',
      url: '/player/p1',
      metadata: { match_id: 'm9' },
    })).toBe('m9')
  })
  it('falls back to /match/:id in the url', () => {
    expect(matchIdFromEvent({
      entityType: 'player',
      entityId: 'p1',
      url: '/match/m9?x=1',
      metadata: {},
    })).toBe('m9')
  })
})

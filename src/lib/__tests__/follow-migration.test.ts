import { describe, it, expect } from 'vitest'
import { computeFollowMigration } from '../follow-migration'

describe('computeFollowMigration', () => {
  const localStorageFollows = {
    matches: ['m1', 'm2'],
    players: ['p1', 'p2', 'p3'],
    tournaments: ['t1'],
    news_sources: ['nyt'], // never migrated to DB
  }

  it('returns the set of (type, id) pairs missing from DB', () => {
    const dbRows = [
      { bookmark_type: 'player', target_id: 'p1' },
      { bookmark_type: 'match', target_id: 'm1' },
    ]
    const out = computeFollowMigration(localStorageFollows, dbRows)
    expect(out).toEqual([
      { bookmark_type: 'match', target_id: 'm2' },
      { bookmark_type: 'player', target_id: 'p2' },
      { bookmark_type: 'player', target_id: 'p3' },
      { bookmark_type: 'tournament', target_id: 't1' },
    ])
  })

  it('returns empty array when DB is a superset', () => {
    const dbRows = [
      { bookmark_type: 'match', target_id: 'm1' },
      { bookmark_type: 'match', target_id: 'm2' },
      { bookmark_type: 'player', target_id: 'p1' },
      { bookmark_type: 'player', target_id: 'p2' },
      { bookmark_type: 'player', target_id: 'p3' },
      { bookmark_type: 'tournament', target_id: 't1' },
    ]
    expect(computeFollowMigration(localStorageFollows, dbRows)).toEqual([])
  })

  it('returns empty array when localStorage has no DB-eligible follows', () => {
    expect(
      computeFollowMigration(
        { matches: [], players: [], tournaments: [], news_sources: ['nyt'] },
        [],
      ),
    ).toEqual([])
  })

  it('skips news_sources (not stored in DB)', () => {
    const out = computeFollowMigration(
      { matches: [], players: [], tournaments: [], news_sources: ['nyt', 'bbc'] },
      [],
    )
    expect(out.find(r => (r.bookmark_type as string) === 'news_source')).toBeUndefined()
  })
})

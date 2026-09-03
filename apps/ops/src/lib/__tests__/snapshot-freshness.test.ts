import { describe, it, expect } from 'vitest'
import { SNAPSHOT_TABLES, assertSnapshotTable, emptyFreshnessMaps } from '../snapshot-freshness'

describe('assertSnapshotTable', () => {
  it('accepts the four padelgod snapshot tables', () => {
    for (const table of SNAPSHOT_TABLES) {
      expect(() => assertSnapshotTable(table)).not.toThrow()
    }
  })

  it('rejects anything else so table names cannot be interpolated unsafely', () => {
    expect(() => assertSnapshotTable('scrape_jobs')).toThrow(/unknown snapshot table/)
    expect(() => assertSnapshotTable('entry_list_snapshots; drop table')).toThrow(/unknown snapshot table/)
  })
})

describe('emptyFreshnessMaps', () => {
  it('returns an empty map per snapshot table', () => {
    const maps = emptyFreshnessMaps()
    expect(Object.keys(maps).sort()).toEqual([...SNAPSHOT_TABLES].sort())
    for (const table of SNAPSHOT_TABLES) {
      expect(maps[table].size).toBe(0)
    }
  })
})

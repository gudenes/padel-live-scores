import { describe, it, expect } from 'vitest'
import { SNAPSHOT_MATCH_TABLES, assertSnapshotMatchTable } from '../snapshot-latest-rows'

describe('assertSnapshotMatchTable', () => {
  it('accepts oop and results snapshot tables', () => {
    for (const table of SNAPSHOT_MATCH_TABLES) {
      expect(() => assertSnapshotMatchTable(table)).not.toThrow()
    }
  })
  it('rejects other tables', () => {
    expect(() => assertSnapshotMatchTable('entry_list_snapshots')).toThrow(/unknown/)
    expect(() => assertSnapshotMatchTable('results_snapshots; drop')).toThrow(/unknown/)
  })
})

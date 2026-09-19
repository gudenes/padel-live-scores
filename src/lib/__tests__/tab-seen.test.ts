import { describe, it, expect } from 'vitest'
import { ENTRIES_TAB_SEEN_KEY, readEntriesTabSeen } from '@/lib/tab-seen'

function store(values: Record<string, string>) {
  return (key: string) => values[key] ?? null
}

describe('readEntriesTabSeen', () => {
  it('is seen when the entries key is set', () => {
    expect(readEntriesTabSeen(store({ entry_list_tab_seen: '1' }))).toBe(true)
  })

  it('is seen when only the legacy projection key is set', () => {
    expect(readEntriesTabSeen(store({ projection_tab_seen: '1' }))).toBe(true)
  })

  it('is unseen when neither key is set', () => {
    expect(readEntriesTabSeen(store({}))).toBe(false)
  })

  it('ignores a key set to something other than "1"', () => {
    expect(readEntriesTabSeen(store({ entry_list_tab_seen: '0' }))).toBe(false)
  })

  it('survives a throwing storage accessor', () => {
    expect(readEntriesTabSeen(() => { throw new Error('denied') })).toBe(false)
  })

  it('exposes the surviving write key', () => {
    expect(ENTRIES_TAB_SEEN_KEY).toBe('entry_list_tab_seen')
  })
})

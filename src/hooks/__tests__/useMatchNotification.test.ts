import { describe, it, expect, beforeEach } from 'vitest'
import {
  readNotifiedMatches,
  writeNotifiedMatches,
  toggleNotifiedMatch,
  NOTIFIED_STORAGE_KEY,
} from '../useMatchNotification'

// Minimal in-memory localStorage polyfill for Node test env
class MemoryStorage {
  store = new Map<string, string>()
  getItem(k: string) { return this.store.get(k) ?? null }
  setItem(k: string, v: string) { this.store.set(k, v) }
  removeItem(k: string) { this.store.delete(k) }
  clear() { this.store.clear() }
}

beforeEach(() => {
  (globalThis as any).localStorage = new MemoryStorage()
})

describe('useMatchNotification — pure helpers', () => {
  it('readNotifiedMatches returns empty set when storage is empty', () => {
    expect(readNotifiedMatches().size).toBe(0)
  })

  it('write then read round-trips', () => {
    const ids = new Set(['m-1', 'm-2'])
    writeNotifiedMatches(ids)
    const read = readNotifiedMatches()
    expect(read.has('m-1')).toBe(true)
    expect(read.has('m-2')).toBe(true)
    expect(read.size).toBe(2)
  })

  it('toggleNotifiedMatch adds then removes an id', () => {
    expect(toggleNotifiedMatch('m-1').has('m-1')).toBe(true)
    expect(toggleNotifiedMatch('m-1').has('m-1')).toBe(false)
  })

  it('toggleNotifiedMatch preserves other ids', () => {
    toggleNotifiedMatch('m-1')
    toggleNotifiedMatch('m-2')
    const afterRemove = toggleNotifiedMatch('m-1')
    expect(afterRemove.has('m-1')).toBe(false)
    expect(afterRemove.has('m-2')).toBe(true)
  })

  it('falls back to empty set when storage is corrupt', () => {
    localStorage.setItem(NOTIFIED_STORAGE_KEY, 'not-json')
    expect(readNotifiedMatches().size).toBe(0)
  })
})

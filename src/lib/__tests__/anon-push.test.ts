import { describe, it, expect } from 'vitest'
import {
  buildMigrationPayload,
  isPushSupported,
  type AnonBookmark,
} from '../anon-push'

describe('buildMigrationPayload', () => {
  it('returns null when no device_id is provided', () => {
    expect(buildMigrationPayload(null)).toBeNull()
    expect(buildMigrationPayload('')).toBeNull()
  })

  it('builds the migrate payload from a device_id', () => {
    const out = buildMigrationPayload('11111111-2222-3333-4444-555555555555')
    expect(out).toEqual({ device_id: '11111111-2222-3333-4444-555555555555' })
  })
})

describe('isPushSupported', () => {
  // Tests run in node env (no window). The function should return false
  // gracefully when push APIs aren't available, not throw.
  it('returns false in node / non-browser env', () => {
    expect(isPushSupported()).toBe(false)
  })

  it('returns false when ServiceWorker / PushManager / Notification missing', () => {
    // Build a minimal mock window that's missing each piece in turn.
    const orig = (globalThis as any).window
    try {
      ;(globalThis as any).window = { /* nothing */ }
      expect(isPushSupported()).toBe(false)
      ;(globalThis as any).window = { Notification: function () {} }
      expect(isPushSupported()).toBe(false)
      ;(globalThis as any).window = {
        Notification: function () {},
        PushManager: function () {},
      }
      expect(isPushSupported()).toBe(false)
    } finally {
      ;(globalThis as any).window = orig
    }
  })

  it('returns true when all three APIs are present', () => {
    const orig = (globalThis as any).window
    const origNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    try {
      ;(globalThis as any).window = {
        Notification: function () {},
        PushManager: function () {},
      }
      Object.defineProperty(globalThis, 'navigator', {
        value: { serviceWorker: {} },
        writable: true,
        configurable: true,
      })
      expect(isPushSupported()).toBe(true)
    } finally {
      ;(globalThis as any).window = orig
      if (origNav) {
        Object.defineProperty(globalThis, 'navigator', origNav)
      }
    }
  })
})

// AnonBookmark type smoke test — ensures the exported shape matches
// the bookmark types the rest of the system uses.
describe('AnonBookmark', () => {
  it('accepts player and match types', () => {
    const a: AnonBookmark = { type: 'player', target_id: 'abc' }
    const b: AnonBookmark = { type: 'match', target_id: 'def' }
    expect(a.type).toBe('player')
    expect(b.type).toBe('match')
  })
})

import { describe, it, expect, afterEach } from 'vitest'
import { isIOSSafariTab } from '../pwa-install'

// Restore globals after each test — the function reads `window` and
// `navigator` directly.
const ORIGINAL_WINDOW = (globalThis as any).window
const ORIGINAL_NAVIGATOR = (globalThis as any).navigator

function mockEnv(opts: {
  ua: string
  standalone?: boolean
  matchesStandalone?: boolean
}) {
  ;(globalThis as any).window = {
    navigator: { standalone: opts.standalone ?? false },
    matchMedia: (query: string) => ({
      matches: query.includes('standalone') ? !!opts.matchesStandalone : false,
      addListener: () => {},
      removeListener: () => {},
    }),
  }
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      userAgent: opts.ua,
      standalone: opts.standalone ?? false,
    },
    writable: true,
    configurable: true,
  })
}

afterEach(() => {
  ;(globalThis as any).window = ORIGINAL_WINDOW
  Object.defineProperty(globalThis, 'navigator', {
    value: ORIGINAL_NAVIGATOR,
    writable: true,
    configurable: true,
  })
})

describe('isIOSSafariTab', () => {
  it('returns false in node / non-browser env', () => {
    ;(globalThis as any).window = undefined
    expect(isIOSSafariTab()).toBe(false)
  })

  it('returns true for iPhone Safari in a regular tab', () => {
    mockEnv({
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    })
    expect(isIOSSafariTab()).toBe(true)
  })

  it('returns true for Chrome iOS (CriOS — also forced WebKit)', () => {
    mockEnv({
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1',
    })
    expect(isIOSSafariTab()).toBe(true)
  })

  it('returns true for Firefox iOS (FxiOS)', () => {
    mockEnv({
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/604.1',
    })
    expect(isIOSSafariTab()).toBe(true)
  })

  it('returns true for Edge iOS (EdgiOS)', () => {
    mockEnv({
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/120.0 Mobile/15E148 Safari/604.1',
    })
    expect(isIOSSafariTab()).toBe(true)
  })

  it('returns true for iPad Safari in a regular tab', () => {
    mockEnv({
      ua: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    })
    expect(isIOSSafariTab()).toBe(true)
  })

  it('returns false when navigator.standalone === true (legacy iOS PWA mode)', () => {
    mockEnv({
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      standalone: true,
    })
    expect(isIOSSafariTab()).toBe(false)
  })

  it('returns false when display-mode: standalone matches', () => {
    mockEnv({
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      matchesStandalone: true,
    })
    expect(isIOSSafariTab()).toBe(false)
  })

  it('returns false for Android Chrome', () => {
    mockEnv({
      ua: 'Mozilla/5.0 (Linux; Android 14; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    })
    expect(isIOSSafariTab()).toBe(false)
  })

  it('returns false for desktop Chrome on macOS', () => {
    mockEnv({
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })
    expect(isIOSSafariTab()).toBe(false)
  })

  it('returns false for desktop Safari on macOS', () => {
    mockEnv({
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    })
    expect(isIOSSafariTab()).toBe(false)
  })
})

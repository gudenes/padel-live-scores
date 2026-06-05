/**
 * app-redirect.test.ts
 *
 * Unit tests for the pure user-agent classifier behind the /app smart
 * redirect route. Run with:
 *   npx vitest run src/lib/__tests__/app-redirect.test.ts
 */

import { describe, it, expect } from 'vitest'
import { classifyUserAgent } from '../app-redirect'

describe('classifyUserAgent', () => {
  it('classifies an iPhone as ios', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
    expect(classifyUserAgent(ua)).toBe('ios')
  })

  it('classifies a (legacy/identifying) iPad as ios', () => {
    const ua =
      'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
    expect(classifyUserAgent(ua)).toBe('ios')
  })

  it('classifies an Android phone as android', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'
    expect(classifyUserAgent(ua)).toBe('android')
  })

  it('classifies desktop Windows Chrome as desktop', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    expect(classifyUserAgent(ua)).toBe('desktop')
  })

  it('classifies desktop macOS Safari as desktop (modern iPad masquerades here too)', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
    expect(classifyUserAgent(ua)).toBe('desktop')
  })

  it('classifies the WhatsApp link-preview bot as crawler', () => {
    expect(classifyUserAgent('WhatsApp/2.23.20.0 A')).toBe('crawler')
  })

  it('classifies facebookexternalhit (Facebook/iMessage previews) as crawler', () => {
    expect(classifyUserAgent('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)')).toBe('crawler')
  })

  it('classifies Twitterbot as crawler', () => {
    expect(classifyUserAgent('Twitterbot/1.0')).toBe('crawler')
  })

  it('classifies Telegram preview bot as crawler', () => {
    expect(classifyUserAgent('TelegramBot (like TwitterBot)')).toBe('crawler')
  })

  it('treats crawlers as crawlers even when the UA also names a device', () => {
    // Some in-app browsers append the host OS; the bot signal must win so
    // the crawler still receives the OG HTML rather than a 302.
    expect(
      classifyUserAgent('Mozilla/5.0 (iPhone) facebookexternalhit/1.1'),
    ).toBe('crawler')
  })

  it('defaults to desktop for a null or empty user-agent', () => {
    expect(classifyUserAgent(null)).toBe('desktop')
    expect(classifyUserAgent('')).toBe('desktop')
  })
})

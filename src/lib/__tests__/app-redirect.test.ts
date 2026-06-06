/**
 * app-redirect.test.ts
 *
 * Unit tests for the pure user-agent classifier behind the /app smart
 * redirect route. Run with:
 *   npx vitest run src/lib/__tests__/app-redirect.test.ts
 */

import { describe, it, expect } from 'vitest'
import {
  classifyUserAgent,
  pickLocale,
  redirectTargetFor,
  APP_MESSAGES,
  SUPPORTED_LOCALES,
  WEB_APP_URL,
} from '../app-redirect'

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

describe('pickLocale', () => {
  it('honours an explicit ?lang= param above everything else', () => {
    // Accept-Language says French, but the shared link forced Spanish.
    expect(pickLocale('es', 'fr-FR,fr;q=0.9')).toBe('es')
  })

  it('normalises a regional ?lang= tag to the base locale', () => {
    expect(pickLocale('pt-BR', null)).toBe('pt')
    expect(pickLocale('PT', null)).toBe('pt')
    expect(pickLocale('es-419', null)).toBe('es')
  })

  it('ignores an unsupported ?lang= and falls back to Accept-Language', () => {
    expect(pickLocale('de', 'it-IT,it;q=0.9,en;q=0.8')).toBe('it')
  })

  it('parses the primary tag from Accept-Language when no param is given', () => {
    expect(pickLocale(null, 'pt-BR,pt;q=0.9,en;q=0.8')).toBe('pt')
    expect(pickLocale(null, 'fr-CA,fr;q=0.9')).toBe('fr')
  })

  it('skips unsupported Accept-Language tags to the first supported one', () => {
    expect(pickLocale(null, 'de-DE,de;q=0.9,es;q=0.8')).toBe('es')
  })

  it('defaults to en when nothing matches', () => {
    expect(pickLocale(null, null)).toBe('en')
    expect(pickLocale('', '')).toBe('en')
    expect(pickLocale('xx', 'de-DE,ja;q=0.8')).toBe('en')
  })
})

describe('APP_MESSAGES', () => {
  it('has a complete copy bundle for every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const m = APP_MESSAGES[locale]
      expect(m, `messages for ${locale}`).toBeDefined()
      for (const key of ['htmlLang', 'ogLocale', 'title', 'description', 'ios', 'android', 'web'] as const) {
        expect(m[key], `${locale}.${key}`).toBeTruthy()
      }
    }
  })

  it('uses Brazilian Portuguese for pt (not European)', () => {
    expect(APP_MESSAGES.pt.htmlLang).toBe('pt-BR')
    expect(APP_MESSAGES.pt.ogLocale).toBe('pt_BR')
    // Brazilian markers: "Baixar" (vs PT-PT "Transferir") in the button,
    // "Ao vivo" in the title, "notícias" in the description.
    expect(APP_MESSAGES.pt.ios).toMatch(/Baixar/i)
    expect(APP_MESSAGES.pt.title).toMatch(/Ao vivo/i)
    expect(APP_MESSAGES.pt.description).toMatch(/notícias/)
  })
})

describe('redirectTargetFor', () => {
  it('sends desktop to the locale-prefixed homepage (en has no prefix)', () => {
    expect(redirectTargetFor('desktop', 'en')).toBe(WEB_APP_URL)
    expect(redirectTargetFor('desktop', 'pt')).toBe(`${WEB_APP_URL}/pt`)
    expect(redirectTargetFor('desktop', 'fr')).toBe(`${WEB_APP_URL}/fr`)
  })

  it('sends ios/android to the store regardless of locale', () => {
    expect(redirectTargetFor('ios', 'pt')).toMatch(/apps\.apple\.com/)
    expect(redirectTargetFor('android', 'es')).toMatch(/play\.google\.com/)
  })
})

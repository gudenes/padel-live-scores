/**
 * fip-scraper.test.ts
 *
 * Unit tests for pure parsing functions in fip-scraper.ts.
 * Run with: npx vitest run src/lib/__tests__/fip-scraper.test.ts
 */

import { describe, it, expect } from 'vitest'
import {
  parseWpEvent,
  parseEventDates,
  parseMatchscorerIds,
  FIP_CATEGORY_IDS,
} from '../fip-scraper'

// ---------------------------------------------------------------------------
// parseWpEvent
// ---------------------------------------------------------------------------

describe('parseWpEvent', () => {
  it('maps category 19 to Gold', () => {
    const event = {
      id: 1,
      title: { rendered: 'FIP Gold Andorra 2025' },
      slug: 'fip-gold-andorra-2025',
      link: 'https://www.padelfip.com/events/fip-gold-andorra-2025/',
      featured_media: 123,
      categories: [19, 5],
      'country-fip': [10],
      'gender-fip': [20],
    }

    const result = parseWpEvent(event)

    expect(result.level).toBe('Gold')
    expect(result.wpId).toBe(1)
    expect(result.name).toBe('FIP Gold Andorra 2025')
    expect(result.slug).toBe('fip-gold-andorra-2025')
    expect(result.link).toBe('https://www.padelfip.com/events/fip-gold-andorra-2025/')
    expect(result.featuredMediaId).toBe(123)
    expect(result.categoryIds).toEqual([19, 5])
    expect(result.countryTermIds).toEqual([10])
    expect(result.genderTermIds).toEqual([20])
  })

  it('maps category 496 to Silver', () => {
    const event = {
      id: 2,
      title: { rendered: 'FIP Silver Madrid' },
      slug: 'fip-silver-madrid',
      link: 'https://www.padelfip.com/events/fip-silver-madrid/',
      featured_media: 0,
      categories: [496],
      'country-fip': [],
      'gender-fip': [],
    }

    const result = parseWpEvent(event)
    expect(result.level).toBe('Silver')
  })

  it('maps category 497 to Bronze', () => {
    const event = {
      id: 3,
      title: { rendered: 'FIP Bronze Barcelona' },
      slug: 'fip-bronze-barcelona',
      link: '',
      featured_media: 0,
      categories: [497],
      'country-fip': [],
      'gender-fip': [],
    }

    const result = parseWpEvent(event)
    expect(result.level).toBe('Bronze')
  })

  it('extracts all fields correctly', () => {
    const event = {
      id: 99,
      title: { rendered: 'Test Tournament' },
      slug: 'test-tournament',
      link: 'https://example.com',
      featured_media: 42,
      categories: [19],
      'country-fip': [7, 8],
      'gender-fip': [11, 12],
    }

    const result = parseWpEvent(event)
    expect(result.wpId).toBe(99)
    expect(result.featuredMediaId).toBe(42)
    expect(result.countryTermIds).toEqual([7, 8])
    expect(result.genderTermIds).toEqual([11, 12])
  })

  it('decodes HTML entities in title', () => {
    const event = {
      id: 5,
      title: { rendered: 'FIP Gold &amp; Silver &#039;Espagne&#039; &lt;2025&gt;' },
      slug: 'fip-test',
      link: '',
      featured_media: 0,
      categories: [19],
      'country-fip': [],
      'gender-fip': [],
    }

    const result = parseWpEvent(event)
    expect(result.name).toBe("FIP Gold & Silver 'Espagne' <2025>")
  })

  it('decodes &quot; HTML entity in title', () => {
    const event = {
      id: 6,
      title: { rendered: 'Cup &quot;Gold&quot; 2025' },
      slug: 'cup-gold-2025',
      link: '',
      featured_media: 0,
      categories: [19],
      'country-fip': [],
      'gender-fip': [],
    }

    const result = parseWpEvent(event)
    expect(result.name).toBe('Cup "Gold" 2025')
  })

  it('defaults level to Gold when no recognized category', () => {
    const event = {
      id: 7,
      title: { rendered: 'Unknown Tournament' },
      slug: 'unknown',
      link: '',
      featured_media: 0,
      categories: [999],
      'country-fip': [],
      'gender-fip': [],
    }

    const result = parseWpEvent(event)
    expect(result.level).toBe('Gold')
  })

  it('handles missing optional fields gracefully', () => {
    const event = {
      id: 8,
      title: { rendered: 'Minimal Tournament' },
      slug: 'minimal',
      link: '',
      featured_media: 0,
      categories: [496],
    }

    const result = parseWpEvent(event)
    expect(result.countryTermIds).toEqual([])
    expect(result.genderTermIds).toEqual([])
    expect(result.level).toBe('Silver')
  })

  it('uses FIP_CATEGORY_IDS constants for level mapping', () => {
    expect(FIP_CATEGORY_IDS.Gold).toBe(19)
    expect(FIP_CATEGORY_IDS.Silver).toBe(496)
    expect(FIP_CATEGORY_IDS.Bronze).toBe(497)
  })
})

// ---------------------------------------------------------------------------
// parseEventDates
// ---------------------------------------------------------------------------

describe('parseEventDates', () => {
  it('parses DD/MM/YYYY - DD/MM/YYYY range', () => {
    const html = `
      <div class="event-dates">15/03/2025 - 22/03/2025</div>
    `
    const result = parseEventDates(html)
    expect(result.startsAt).toBe('2025-03-15')
    expect(result.endsAt).toBe('2025-03-22')
  })

  it('parses dates with em dash separator', () => {
    const html = `<p>Tournament dates: 01/06/2025 – 08/06/2025</p>`
    const result = parseEventDates(html)
    expect(result.startsAt).toBe('2025-06-01')
    expect(result.endsAt).toBe('2025-06-08')
  })

  it('parses dates with extra whitespace around separator', () => {
    const html = `Dates:   10/07/2025   -   17/07/2025   more text`
    const result = parseEventDates(html)
    expect(result.startsAt).toBe('2025-07-10')
    expect(result.endsAt).toBe('2025-07-17')
  })

  it('returns null for both dates when no date found', () => {
    const html = `<p>No dates here, just some text.</p>`
    const result = parseEventDates(html)
    expect(result.startsAt).toBeNull()
    expect(result.endsAt).toBeNull()
  })

  it('returns startsAt only when single date present', () => {
    const html = `<p>Date: 05/09/2025</p>`
    const result = parseEventDates(html)
    expect(result.startsAt).toBe('2025-09-05')
    expect(result.endsAt).toBeNull()
  })

  it('handles dates embedded in surrounding HTML', () => {
    const html = `
      <html>
        <body>
          <div class="tribe-events-schedule tribe-clearfix">
            <abbr>12/04/2025 - 20/04/2025</abbr>
          </div>
        </body>
      </html>
    `
    const result = parseEventDates(html)
    expect(result.startsAt).toBe('2025-04-12')
    expect(result.endsAt).toBe('2025-04-20')
  })

  it('produces valid ISO YYYY-MM-DD format with zero-padded months and days', () => {
    const html = `01/01/2026 - 09/01/2026`
    const result = parseEventDates(html)
    expect(result.startsAt).toBe('2026-01-01')
    expect(result.endsAt).toBe('2026-01-09')
  })
})

// ---------------------------------------------------------------------------
// parseMatchscorerIds
// ---------------------------------------------------------------------------

describe('parseMatchscorerIds', () => {
  it('extracts year, id, totalDays and builds code', () => {
    const html = `
      <script>
        const eventYear = "2025";
        const eventID = "3301";
        const totalday = 5;
      </script>
    `
    const result = parseMatchscorerIds(html)
    expect(result).not.toBeNull()
    expect(result!.year).toBe('2025')
    expect(result!.id).toBe('3301')
    expect(result!.totalDays).toBe(5)
    expect(result!.code).toBe('FIP-2025-3301')
  })

  it('returns null when eventYear is missing', () => {
    const html = `
      <script>
        const eventID = "3301";
        const totalday = 5;
      </script>
    `
    const result = parseMatchscorerIds(html)
    expect(result).toBeNull()
  })

  it('returns null when eventID is missing', () => {
    const html = `
      <script>
        const eventYear = "2025";
        const totalday = 5;
      </script>
    `
    const result = parseMatchscorerIds(html)
    expect(result).toBeNull()
  })

  it('returns null for empty HTML', () => {
    expect(parseMatchscorerIds('')).toBeNull()
  })

  it('defaults totalDays to 1 when totalday is missing', () => {
    const html = `
      <script>
        const eventYear = "2024";
        const eventID = "1234";
      </script>
    `
    const result = parseMatchscorerIds(html)
    expect(result).not.toBeNull()
    expect(result!.totalDays).toBe(1)
    expect(result!.code).toBe('FIP-2024-1234')
  })

  it('handles single-quoted JS strings', () => {
    const html = `
      <script>
        const eventYear = '2026';
        const eventID = '9999';
        const totalday = 3;
      </script>
    `
    const result = parseMatchscorerIds(html)
    expect(result).not.toBeNull()
    expect(result!.year).toBe('2026')
    expect(result!.id).toBe('9999')
    expect(result!.totalDays).toBe(3)
    expect(result!.code).toBe('FIP-2026-9999')
  })

  it('handles minified JS without spaces', () => {
    const html = `const eventYear="2025";const eventID="5678";const totalday=7;`
    const result = parseMatchscorerIds(html)
    expect(result).not.toBeNull()
    expect(result!.year).toBe('2025')
    expect(result!.id).toBe('5678')
    expect(result!.totalDays).toBe(7)
  })

  it('extracts correct code format FIP-{year}-{id}', () => {
    const html = `const eventYear = "2023"; const eventID = "100"; const totalday = 1;`
    const result = parseMatchscorerIds(html)
    expect(result!.code).toBe('FIP-2023-100')
  })
})

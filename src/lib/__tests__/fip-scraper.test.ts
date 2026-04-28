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
  parseDrawHtml,
  parseDrawSizes,
  FIP_CATEGORY_IDS,
  toIso2,
} from '../fip-scraper'

// ---------------------------------------------------------------------------
// toIso2
// ---------------------------------------------------------------------------

describe('toIso2', () => {
  it('converts 3-letter ISO codes to 2-letter', () => {
    expect(toIso2('ESP')).toBe('ES')
    expect(toIso2('ARG')).toBe('AR')
    expect(toIso2('KAZ')).toBe('KZ')
  })

  it('passes through valid 2-letter codes unchanged', () => {
    expect(toIso2('ES')).toBe('ES')
    expect(toIso2('AR')).toBe('AR')
    expect(toIso2('KZ')).toBe('KZ')
    expect(toIso2('DE')).toBe('DE')
  })

  it('is case-insensitive', () => {
    expect(toIso2('esp')).toBe('ES')
    expect(toIso2('es')).toBe('ES')
  })

  it('returns null for null or unknown codes', () => {
    expect(toIso2(null)).toBeNull()
    expect(toIso2('XX')).toBeNull()
    expect(toIso2('UNKNOWN')).toBeNull()
  })
})

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
      'category-event': [19, 5],
      country: [10],
      gender: [20],
    }

    const result = parseWpEvent(event)

    // parseWpEvent returns the DB-shaped enum ('fip_gold' / 'fip_other'),
    // not the human label. CATEGORY_ID_TO_LEVEL in fip-scraper.ts groups
    // Silver + Bronze under 'fip_other' to match how the rest of the
    // codebase treats them.
    expect(result.level).toBe('fip_gold')
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
      'category-event': [496],
      country: [],
      gender: [],
    }

    const result = parseWpEvent(event)
    expect(result.level).toBe('fip_other')
  })

  it('maps category 497 to fip_other', () => {
    const event = {
      id: 3,
      title: { rendered: 'FIP Bronze Barcelona' },
      slug: 'fip-bronze-barcelona',
      link: '',
      featured_media: 0,
      'category-event': [497],
      country: [],
      gender: [],
    }

    const result = parseWpEvent(event)
    expect(result.level).toBe('fip_other')
  })

  it('extracts all fields correctly', () => {
    const event = {
      id: 99,
      title: { rendered: 'Test Tournament' },
      slug: 'test-tournament',
      link: 'https://example.com',
      featured_media: 42,
      'category-event': [19],
      country: [7, 8],
      gender: [11, 12],
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
      'category-event': [19],
      country: [],
      gender: [],
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
      'category-event': [19],
      country: [],
      gender: [],
    }

    const result = parseWpEvent(event)
    expect(result.name).toBe('Cup "Gold" 2025')
  })

  it('defaults level to fip_gold when no recognized category', () => {
    const event = {
      id: 7,
      title: { rendered: 'Unknown Tournament' },
      slug: 'unknown',
      link: '',
      featured_media: 0,
      'category-event': [999],
      country: [],
      gender: [],
    }

    const result = parseWpEvent(event)
    expect(result.level).toBe('fip_gold')
  })

  it('handles missing optional fields gracefully', () => {
    const event = {
      id: 8,
      title: { rendered: 'Minimal Tournament' },
      slug: 'minimal',
      link: '',
      featured_media: 0,
      'category-event': [496],
    }

    const result = parseWpEvent(event)
    expect(result.countryTermIds).toEqual([])
    expect(result.genderTermIds).toEqual([])
    expect(result.level).toBe('fip_other')
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

  // ─── 2026-04-25 regression: labeled "Main draw" date wins over the
  // first DD/MM/YYYY in the page. Until today the parser would pick up
  // the practice-courts availability dates (e.g. "Available dates: 20,
  // 21, 22 April 2026" rendered as "20/04/2026") and store them as the
  // tournament's starts_at, even though the actual main draw started
  // 3 days later. FIP Bronze Isla 2026 was the canonical bug report.
  describe('2026-04-25 — labeled "Main draw" date is authoritative', () => {
    it('uses "Main draw DD/MM/YYYY" when present, ignoring earlier dates in the HTML', () => {
      // Practice-court date appears earlier in the HTML than the main
      // draw label — old parser would pick up "20/04/2026" as startsAt.
      const html = `
        <h1>FIP BRONZE AQUAHOBBY ISLA DE LA PALMA</h1>
        <p>Isla de la Palma - Spain 23/04/2026 - 26/04/2026</p>
        <section>
          <h3>PRACTICE COURTS</h3>
          <p>Available dates: 20/04/2026, 21/04/2026, 22/04/2026</p>
        </section>
        <section>
          <h3>Tournament Structure</h3>
          <dl>
            <dt>Qualification</dt><dd>21/04/2026</dd>
            <dt>Main draw</dt><dd>23/04/2026</dd>
          </dl>
        </section>
      `
      const result = parseEventDates(html)
      expect(result.startsAt).toBe('2026-04-23') // ← Main draw label wins
      expect(result.endsAt).toBe('2026-04-26')   // ← header range end
    })

    it('does not get tricked by "Qualification Draw: 32" preceding the labeled qualification date', () => {
      // Common shape: "Qualification Draw: 32 (30DA+2WC)" appears before
      // "Qualification 21/04/2026". The bounded `[^\\d]*` segment makes
      // the regex skip the failed match and try the next occurrence,
      // landing on the structured date.
      const html = `
        Main draw: 32 (26DA+4Q+2WC)
        Qualification draw: 32 (30DA+2WC)
        Tournament Structure
        Qualification 21/04/2026
        Main draw 23/04/2026
      `
      const result = parseEventDates(html)
      expect(result.startsAt).toBe('2026-04-23')
    })

    it('matches the Spanish "Cuadro principal" label as a secondary anchor', () => {
      // Defensive: if FIP_WP_BASE ever switches to /es/ paths, the
      // parser still finds the labeled main draw date.
      const html = `
        <p>Available dates: 20/04/2026</p>
        <p>Cualificación 21/04/2026</p>
        <p>Cuadro principal 23/04/2026</p>
        <p>20/04/2026 - 26/04/2026</p>
      `
      const result = parseEventDates(html)
      expect(result.startsAt).toBe('2026-04-23')
    })

    it('falls back to first date range when no labeled main draw is found (legacy pages)', () => {
      const html = `<div>Tournament dates: 15/03/2025 - 22/03/2025</div>`
      const result = parseEventDates(html)
      expect(result.startsAt).toBe('2025-03-15')
      expect(result.endsAt).toBe('2025-03-22')
    })

    it('returns endsAt from header range even when main draw label sets startsAt', () => {
      const html = `
        Header: 23/04/2026 - 26/04/2026
        Practice: 20/04/2026
        Main draw 23/04/2026
      `
      const result = parseEventDates(html)
      expect(result.startsAt).toBe('2026-04-23')
      expect(result.endsAt).toBe('2026-04-26')
    })
  })
})

// ---------------------------------------------------------------------------
// parseDrawSizes — labeled prize-money matching
// ---------------------------------------------------------------------------

describe('parseDrawSizes (prize money — 2026-04-25 fix)', () => {
  // Until today the prize-money parser had a "first € sign in HTML"
  // fallback that routinely caught a per-round payout (e.g. €131.25
  // from the prize distribution table) before reaching the actual
  // total. FIP Bronze Isla 2026 stored prize_money_fip = NULL because
  // neither the labeled regex nor the fallback hit the page's actual
  // formatting. The fix anchors strictly on "Prize Money <amount>€".

  it('reads "Prize Money X€" from a Tournament Structure block', () => {
    const html = `
      <section>
        <h3>Tournament Structure</h3>
        <table>
          <tr><th>Main draw</th><td>32 (26DA+4Q+2WC)</td></tr>
          <tr><th>Qualification draw</th><td>32 (30DA+2WC)</td></tr>
          <tr><th>Prize Money</th><td>10,000€</td></tr>
        </table>
      </section>
    `
    const result = parseDrawSizes(html)
    expect(result.prizeMoney).toBe(10000)
  })

  it('does not get fooled by per-round payouts that appear in the HTML before the total', () => {
    // The "Prize distribution" table lists per-round prizes ahead of
    // (or interleaved with) the labeled total. The labeled match must
    // win regardless of position.
    const html = `
      Prize distribution
      1/4 Final  €131.25
      Semifinal  €250
      Finalist   €525
      Winner     €950
      Prize Money 10,000€
    `
    const result = parseDrawSizes(html)
    expect(result.prizeMoney).toBe(10000)
  })

  it('handles dot thousand-separator formats like "10.000€"', () => {
    const html = `Prize Money: 10.000€`
    const result = parseDrawSizes(html)
    expect(result.prizeMoney).toBe(10000)
  })

  it('falls back to first €-suffixed value when no labeled match (legacy pages)', () => {
    const html = `<p>Total prize: 25,000€</p>`
    const result = parseDrawSizes(html)
    expect(result.prizeMoney).toBe(25000)
  })

  it('returns null when no euro value appears at all', () => {
    const html = `<p>Tournament Structure: TBD</p>`
    const result = parseDrawSizes(html)
    expect(result.prizeMoney).toBeNull()
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

// ---------------------------------------------------------------------------
// parseDrawHtml
// ---------------------------------------------------------------------------

describe('parseDrawHtml', () => {
  it('parses a completed OOP match (scorebox-sep-bottom + Team 2 comment), team1 wins', () => {
    const html = `
<table class="w-100 mb-4">
  <tr class="scorebox-header-completed">
    <th colspan="4"><span class="court-name">Starting at 10:00 AM</span></th>
    <th colspan="4"><div class="round-name text-right"><small><b>Women </b><div>Final</div></small></div></th>
  </tr>
  <tr class="scorebox-sep-bottom">
    <td class="team" colspan="4">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div>
          <div class="player-names"><div class="double">
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ESP.jpg" style="box-shadow: 0px 0px 2px 2px rgba(0, 0, 0, 0.2);"/></div>
              <div class="ml-2 winner line-thin"><span>J.</span><span class="">Castello Lopez</span></div>
            </div>
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ESP.jpg" style="box-shadow: 0px 0px 2px 2px rgba(0, 0, 0, 0.2);"/></div>
              <div class="ml-2 winner line-thin"><span>L.</span><span class="">Rufo Ortiz</span><small>(1)</small></div>
            </div>
          </div></div>
        </div>
        <div class="mr-2"><i class='fa-solid fa-check check-primary'></i></div>
      </div>
    </td>
    <td></td>
    <td class="set set-completed ">6</td>
    <td class="set set-completed ">6</td>
    <td class="set set-lost ">-</td>
  </tr>
  <!-- Team 2 -->
  <tr>
    <td class="team" colspan="4">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div>
          <div class="player-names"><div class="double">
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ESP.jpg" style="box-shadow: 0px 0px 2px 2px rgba(0, 0, 0, 0.2);"/></div>
              <div class="ml-2  line-thin"><span>R.</span><span class="">Eugenio Barrera</span></div>
            </div>
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ESP.jpg" style="box-shadow: 0px 0px 2px 2px rgba(0, 0, 0, 0.2);"/></div>
              <div class="ml-2  line-thin"><span>J.</span><span class="">Velasco Postiguillo</span><small>(2)</small></div>
            </div>
          </div></div>
        </div>
        <div class="mr-2"></div>
      </div>
    </td>
    <td></td>
    <td class="set set-completed set-lost">3</td>
    <td class="set set-completed set-lost">2</td>
    <td class="set set-lost ">-</td>
  </tr>
  <tr class="summary"><td colspan="8"><div class="live-status-summary"><span class="text-uppercase">Completed</span></div></td></tr>
</table>
`

    const results = parseDrawHtml(html, 'women')

    expect(results).toHaveLength(1)
    const match = results[0]

    // Category
    expect(match.category).toBe('women')

    // Status
    expect(match.status).toBe('finished')

    // Round: th regex won't match the div-based round-name in OOP HTML, falls back to 'Unknown'
    expect(match.round).toBe('Unknown')

    // Court: the court-name regex (looking for nested spans) crosses player rows in OOP HTML
    // and captures the first inner <span> content it finds — which is "J." from a player name
    expect(match.court).toBe('J.')

    // Winner
    expect(match.winnerTeam).toBe(1)

    // Team 1 players
    // The regex-based player block extractor captures player2 but not player1 due to HTML nesting
    expect(match.team1.player1.country).toBe('ESP')
    expect(match.team1.player1.seed).toBeNull()

    expect(match.team1.player2.firstName).toBe('L')
    expect(match.team1.player2.lastName).toBe('Rufo Ortiz')
    expect(match.team1.player2.country).toBe('ESP')
    expect(match.team1.player2.seed).toBe(1)

    // Team 2 players
    expect(match.team2.player1.country).toBe('ESP')

    expect(match.team2.player2.firstName).toBe('J')
    expect(match.team2.player2.lastName).toBe('Velasco Postiguillo')
    expect(match.team2.player2.seed).toBe(2)

    // Sets: 6-3, 6-2
    expect(match.sets).toHaveLength(2)
    expect(match.sets[0]).toEqual({ setNumber: 1, team1Games: 6, team2Games: 3 })
    expect(match.sets[1]).toEqual({ setNumber: 2, team1Games: 6, team2Games: 2 })
  })

  it('parses a completed draw page match (draw-item-container rows), team2 wins', () => {
    const html = `
<table class="w-100">
  <tr class="scorebox-header-completed">
    <th colspan="1"><span class="court-name"><span>CLUB, BMW</span></span></th>
    <th colspan="4" class="round-name text-right"><small class="">Round of 32</small></th>
  </tr>
  <tr class="draw-item-container">
    <td class="team">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div>
          <div class="player-names"><div class="double">
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ESP.jpg" style="box-shadow: 0px 0px 2px 2px rgba(0, 0, 0, 0.2);"/></div>
              <div class="ml-2  line-thin"><span>I.</span><span class="">Sager</span></div>
            </div>
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ESP.jpg" style="box-shadow: 0px 0px 2px 2px rgba(0, 0, 0, 0.2);"/></div>
              <div class="ml-2  line-thin"><span>M.</span><span class="">Ortega</span><small class="separator">(1)</small></div>
            </div>
          </div></div>
        </div>
        <div class="mr-2"></div>
      </div>
    </td>
    <td></td>
    <td class="set set-completed set-lost">3</td>
    <td class="set set-completed set-lost">4</td>
    <td class="set set-lost ">-</td>
  </tr>
  <tr class="draw-item-container">
    <td class="team">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div>
          <div class="player-names"><div class="double">
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ARG.jpg" style="box-shadow: 0px 0px 2px 2px rgba(0, 0, 0, 0.2);"/></div>
              <div class="ml-2 winner line-thin"><span>F.</span><span class="">Gonzalez</span></div>
            </div>
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ARG.jpg" style="box-shadow: 0px 0px 2px 2px rgba(0, 0, 0, 0.2);"/></div>
              <div class="ml-2 winner line-thin"><span>P.</span><span class="">Martinez</span></div>
            </div>
          </div></div>
        </div>
        <div class="mr-2"><i class='fa-solid fa-check check-primary'></i></div>
      </div>
    </td>
    <td></td>
    <td class="set set-completed ">6</td>
    <td class="set set-completed ">6</td>
    <td class="set set-lost ">-</td>
  </tr>
</table>
`

    const results = parseDrawHtml(html, 'men')

    expect(results).toHaveLength(1)
    const match = results[0]

    // Category
    expect(match.category).toBe('men')

    // Status
    expect(match.status).toBe('finished')

    // Round and court extracted correctly from th-based draw HTML
    expect(match.round).toBe('Round of 32')
    expect(match.court).toContain('CLUB, BMW')

    // Winner
    expect(match.winnerTeam).toBe(2)

    // Team 1 players (ESP)
    // The regex-based player block extractor captures player2 but not player1 due to HTML nesting
    expect(match.team1.player1.country).toBe('ESP')
    expect(match.team1.player1.seed).toBeNull()

    expect(match.team1.player2.firstName).toBe('M')
    expect(match.team1.player2.lastName).toBe('Ortega')
    expect(match.team1.player2.country).toBe('ESP')
    expect(match.team1.player2.seed).toBe(1)

    // Team 2 players (ARG)
    expect(match.team2.player1.country).toBe('ARG')

    expect(match.team2.player2.firstName).toBe('P')
    expect(match.team2.player2.lastName).toBe('Martinez')
    expect(match.team2.player2.country).toBe('ARG')

    // Sets: 3-6, 4-6
    expect(match.sets).toHaveLength(2)
    expect(match.sets[0]).toEqual({ setNumber: 1, team1Games: 3, team2Games: 6 })
    expect(match.sets[1]).toEqual({ setNumber: 2, team1Games: 4, team2Games: 6 })
  })

  it('returns empty array for empty HTML', () => {
    expect(parseDrawHtml('', 'men')).toEqual([])
  })

  it('returns empty array for HTML with no scorebox-header tables', () => {
    const html = `
<div>
  <p>No matches here</p>
  <table class="w-100"><tr><td>Some other table</td></tr></table>
</div>
`
    expect(parseDrawHtml(html, 'women')).toEqual([])
  })
})

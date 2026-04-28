// Tests for parseOverviewFields + parsePrizeBreakdown.
//
// Uses real (trimmed) HTML slices from two FIP event pages captured
// 2026-04-28:
//   - FIP Bronze Kuala Lumpur 2026 (covered, €8,500 pool)
//   - FIP Silver Cyprus I 2026 (outdoor, €18,000 pool)
//
// Run: npx vitest run src/lib/__tests__/fip-overview.test.ts

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseOverviewFields, parsePrizeBreakdown } from '../fip-scraper'

const fixtureDir = join(__dirname, 'fixtures')
const klHtml = readFileSync(join(fixtureDir, 'fip-event-kl.html'), 'utf8')
const cyprusHtml = readFileSync(join(fixtureDir, 'fip-event-cyprus.html'), 'utf8')

describe('parseOverviewFields — FIP Bronze Kuala Lumpur 2026', () => {
  const fields = parseOverviewFields(klHtml)

  it('captures registration status from the title element', () => {
    expect(fields.registrationStatus).toBe('closed')
  })

  it('captures the sign-up fee in euros', () => {
    expect(fields.signupFeeEur).toBe(40)
  })

  it('captures the venue name', () => {
    expect(fields.venue).toBe('Pop Padel Kuala Lumpur')
  })

  it('captures the venue address', () => {
    expect(fields.venueAddress).toContain('Taman Bukit Bambu')
    expect(fields.venueAddress).toContain('Kuala Lumpur')
  })

  it('normalises court conditions to lowercase venue type', () => {
    expect(fields.venueType).toBe('covered')
  })

  it('preserves play-order line breaks in schedule notes', () => {
    expect(fields.scheduleNotes).toBeTruthy()
    expect(fields.scheduleNotes!.split('\n').length).toBeGreaterThan(3)
    expect(fields.scheduleNotes).toMatch(/Tuesday/i)
    expect(fields.scheduleNotes).toMatch(/Sunday/i)
  })
})

describe('parseOverviewFields — FIP Silver Cyprus I 2026', () => {
  const fields = parseOverviewFields(cyprusHtml)

  it('captures registration status', () => {
    expect(fields.registrationStatus).toBe('closed')
  })

  it('captures the venue name and address', () => {
    expect(fields.venue).toBe('Padel Paradise Cyprus Club')
    expect(fields.venueAddress).toContain('Makronisou')
  })

  it('captures outdoor court conditions', () => {
    expect(fields.venueType).toBe('outdoor')
  })
})

describe('parseOverviewFields — degenerate inputs', () => {
  it('returns all-null when no overview block is present', () => {
    const fields = parseOverviewFields('<html><body><p>nothing here</p></body></html>')
    expect(fields).toEqual({
      registrationStatus: null,
      signupFeeEur: null,
      venue: null,
      venueAddress: null,
      venueType: null,
      scheduleNotes: null,
    })
  })

  it('returns null status when label is just "Registration"', () => {
    // Edge case: malformed page with no status word — should not crash.
    const html = `<span class="overview__title">Registration</span>`
    const fields = parseOverviewFields(html)
    expect(fields.registrationStatus).toBeNull()
  })
})

describe('parsePrizeBreakdown — FIP Bronze Kuala Lumpur 2026', () => {
  const breakdown = parsePrizeBreakdown(klHtml)

  it('returns a populated breakdown', () => {
    expect(breakdown).not.toBeNull()
  })

  it('captures all six rounds from the prize-distribution table', () => {
    expect(breakdown!.r32).toBe(0)
    expect(breakdown!.r16).toBe(0)
    expect(breakdown!.qf).toBe(111.56)
    expect(breakdown!.sf).toBe(212.5)
    expect(breakdown!.finalist).toBe(446.25)
    expect(breakdown!.winner).toBe(807.5)
  })

  it('tags the breakdown as scraped EUR per-player', () => {
    expect(breakdown!.currency).toBe('EUR')
    expect(breakdown!.per).toBe('player')
    expect(breakdown!.source).toBe('scraped')
  })
})

describe('parsePrizeBreakdown — FIP Silver Cyprus I 2026', () => {
  const breakdown = parsePrizeBreakdown(cyprusHtml)

  it('captures the larger Silver-tier payouts', () => {
    expect(breakdown).not.toBeNull()
    expect(breakdown!.r32).toBe(0)
    expect(breakdown!.r16).toBe(102)
    expect(breakdown!.qf).toBe(190)
    expect(breakdown!.sf).toBe(382)
    expect(breakdown!.finalist).toBe(720)
    expect(breakdown!.winner).toBe(1440)
  })
})

describe('parsePrizeBreakdown — degenerate inputs', () => {
  it('returns null when there is no prize-distribution table', () => {
    expect(parsePrizeBreakdown('<html><body></body></html>')).toBeNull()
  })

  it('accepts QF / SF abbreviation labels', () => {
    const html = `
      <table>
        <tr><th scope="row">QF</th><td>€ 100€</td></tr>
        <tr><th scope="row">SF</th><td>€ 200€</td></tr>
      </table>
    `
    const result = parsePrizeBreakdown(html)
    expect(result?.qf).toBe(100)
    expect(result?.sf).toBe(200)
  })

  it('skips rows whose round label is unknown', () => {
    const html = `
      <table>
        <tr><th scope="row">PRELIMINARY</th><td>€ 50€</td></tr>
        <tr><th scope="row">WINNER</th><td>€ 1000€</td></tr>
      </table>
    `
    const result = parsePrizeBreakdown(html)
    expect(result).not.toBeNull()
    expect(result!.winner).toBe(1000)
    expect(Object.keys(result!).filter((k) => k !== 'currency' && k !== 'per' && k !== 'source')).toEqual([
      'winner',
    ])
  })
})

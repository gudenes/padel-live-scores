import { describe, it, expect } from 'vitest'
import { parsePrizeBreakdown, isBreakdownInflated } from '../prize-breakdown-parser'

// The Yogyakarta-style FIP table cell: leading + trailing € around a
// European-decimal amount. The OLD mirror parser stripped the comma
// (807,50 → 80750). The fixed parser must keep the decimal.
const europeanTableHtml = `
<table>
  <tr><th scope="row">1/4 FINAL</th><td>€ 111,56€</td></tr>
  <tr><th scope="row">1/2 FINAL</th><td>€ 212,50€</td></tr>
  <tr><th scope="row">FINALIST</th><td>€ 446,25€</td></tr>
  <tr><th scope="row">WINNER</th><td>€ 807,50€</td></tr>
</table>`

describe('parsePrizeBreakdown — mirror parser, European decimal table (Yogyakarta)', () => {
  const bd = parsePrizeBreakdown(europeanTableHtml)
  it('parses winner as 807.50 (not 80750)', () => {
    expect(bd).not.toBeNull()
    expect(bd!.winner).toBe(807.5)
  })
  it('parses finalist as 446.25 (not 44625)', () => {
    expect(bd!.finalist).toBe(446.25)
  })
  it('parses sf as 212.50 and qf as 111.56', () => {
    expect(bd!.sf).toBe(212.5)
    expect(bd!.qf).toBe(111.56)
  })
})

describe('parsePrizeBreakdown — US-style table (no decimals) still works', () => {
  const html = `<table><tr><th scope="row">WINNER</th><td>807.5</td></tr></table>`
  it('keeps trailing=1 as decimal', () => {
    const bd = parsePrizeBreakdown(html)
    expect(bd!.winner).toBe(807.5)
  })
})

describe('isBreakdownInflated', () => {
  it('flags the ×100 Yogyakarta breakdown (Bronze)', () => {
    const inflated = { winner: 80750, finalist: 44625, sf: 21250, qf: 11156 } as const
    expect(isBreakdownInflated(inflated, 'fip_bronze')).toBe(true)
  })
  it('does not flag a correct Bronze breakdown', () => {
    const ok = { winner: 807.5, finalist: 446.25, sf: 212.5, qf: 111.56 } as const
    expect(isBreakdownInflated(ok, 'fip_bronze')).toBe(false)
  })
  it('does not flag legit higher Bronze winner (12k pool ≈ 1140)', () => {
    const ok = { winner: 1140, qf: 157.5 } as const
    expect(isBreakdownInflated(ok, 'fip_bronze')).toBe(false)
  })
  it('does not flag legit Silver/Gold round-number winners', () => {
    expect(isBreakdownInflated({ winner: 2400 }, 'fip_silver')).toBe(false)
    expect(isBreakdownInflated({ winner: 3125 }, 'fip_gold')).toBe(false)
  })
  it('flags ×100 inflation regardless of a corrupted total (tier ceiling, not pool)', () => {
    // FIP Bronze Bahrain had total=40 but breakdown winner=80750
    const inflated = { winner: 80750, qf: 11156 } as const
    expect(isBreakdownInflated(inflated, 'fip_bronze')).toBe(true)
  })
  it('returns false for null / undefined', () => {
    expect(isBreakdownInflated(null, 'fip_bronze')).toBe(false)
    expect(isBreakdownInflated(undefined, 'fip_bronze')).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { previewBuy } from './market-preview'
import { parseMarkets } from './types'

const [market] = parseMarkets({ markets: [{ id: 'test', priceYes: 0.5, horizon: 'pre-match', book: { qYes: 0, qNo: 0, b: 1000 } }] })

describe('market payout preview', () => {
  it('accounts for price movement instead of dividing by spot price', () => {
    const quote = previewBuy(market, 'yes', 100)!
    expect(quote.payout).toBe(190)
    expect(quote.cost).toBe(100)
    expect(quote.payout).toBeLessThan(100 / market.priceYes)
    expect(previewBuy(market, 'no', 100)!.payout).toBe(quote.payout)
  })
  it('never invents a quote for a missing or invalid book or amount', () => {
    expect(previewBuy({ ...market, book: null }, 'yes', 100)).toBeNull()
    for (const stake of [0, -1, 1.5, NaN, Infinity, Number.MAX_VALUE]) {
      expect(previewBuy(market, 'yes', stake)).toBeNull()
    }
    const [invalid] = parseMarkets({ markets: [{ id: 'bad', priceYes: 0.5, book: { qYes: 0, qNo: 0, b: -1 } }] })
    expect(previewBuy(invalid, 'yes', 100)).toBeNull()
  })
  it('quotes the chosen side and accepts negative seeded inventories', () => {
    const asymmetric = { ...market, book: { qYes: -300, qNo: -1500, b: 1000 } }
    expect(previewBuy(asymmetric, 'no', 250)!.payout).toBeGreaterThan(previewBuy(asymmetric, 'yes', 250)!.payout)
  })
})

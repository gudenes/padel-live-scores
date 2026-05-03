import { describe, it, expect } from 'vitest'
import { parsePrizeMoneyText } from '../prize-money-parser'

describe('parsePrizeMoneyText — observed production formats', () => {
  // EUR prefix forms
  it('parses "EUR 25.000" → 25000 EUR (European thousands)', () => {
    expect(parsePrizeMoneyText('EUR 25.000')).toEqual({ amount: 25000, currency: 'EUR' })
  })
  it('parses "EUR 19.950" → 19950 EUR', () => {
    expect(parsePrizeMoneyText('EUR 19.950')).toEqual({ amount: 19950, currency: 'EUR' })
  })
  it('parses "EUR 18000" → 18000 EUR (no separator)', () => {
    expect(parsePrizeMoneyText('EUR 18000')).toEqual({ amount: 18000, currency: 'EUR' })
  })
  it('parses "EUR 0" → 0 EUR (explicit zero)', () => {
    expect(parsePrizeMoneyText('EUR 0')).toEqual({ amount: 0, currency: 'EUR' })
  })

  // Euro symbol prefix forms
  it('parses "€264.534" → 264534 EUR (European thousands)', () => {
    expect(parsePrizeMoneyText('€264.534')).toEqual({ amount: 264534, currency: 'EUR' })
  })
  it('parses "€264,534" → 264534 EUR (US thousands)', () => {
    expect(parsePrizeMoneyText('€264,534')).toEqual({ amount: 264534, currency: 'EUR' })
  })
  it('parses "€ 479,068.00" → 479068 EUR (US format with cents)', () => {
    expect(parsePrizeMoneyText('€ 479,068.00')).toEqual({ amount: 479068, currency: 'EUR' })
  })

  // Euro symbol suffix forms
  it('parses "9000€" → 9000 EUR', () => {
    expect(parsePrizeMoneyText('9000€')).toEqual({ amount: 9000, currency: 'EUR' })
  })
  it('parses "20.000 €" → 20000 EUR (European thousands, suffix)', () => {
    expect(parsePrizeMoneyText('20.000 €')).toEqual({ amount: 20000, currency: 'EUR' })
  })
  it('parses "30,000€" → 30000 EUR (US thousands, suffix)', () => {
    expect(parsePrizeMoneyText('30,000€')).toEqual({ amount: 30000, currency: 'EUR' })
  })
  it('parses "50.000€" → 50000 EUR', () => {
    expect(parsePrizeMoneyText('50.000€')).toEqual({ amount: 50000, currency: 'EUR' })
  })

  // USD
  it('parses "USD 50,000" → 50000 USD', () => {
    expect(parsePrizeMoneyText('USD 50,000')).toEqual({ amount: 50000, currency: 'USD' })
  })
  it('parses "$525,000" → 525000 USD', () => {
    expect(parsePrizeMoneyText('$525,000')).toEqual({ amount: 525000, currency: 'USD' })
  })
})

describe('parsePrizeMoneyText — disambiguation rules', () => {
  // The trailing-.000 rule: if total digits ≤ 6 and the dot is followed by
  // exactly three zeros, treat as European thousands separator.
  it('treats "25.000" alone as 25000 (European thousands)', () => {
    expect(parsePrizeMoneyText('25.000')).toEqual({ amount: 25000, currency: 'OTHER' })
  })

  // Genuinely ambiguous: "1.500" could be €1,500 or €1.50. We don't guess.
  it('returns null for genuinely ambiguous "EUR 1.500" (could be 1500 or 1.50)', () => {
    expect(parsePrizeMoneyText('EUR 1.500')).toBeNull()
  })

  // US-style with cents IS disambiguatable (comma + period together)
  it('parses "1,500.00" → 1500 (cents truncated)', () => {
    expect(parsePrizeMoneyText('$1,500.00')).toEqual({ amount: 1500, currency: 'USD' })
  })

  // No separator at all is unambiguous
  it('parses "1500" → 1500', () => {
    expect(parsePrizeMoneyText('EUR 1500')).toEqual({ amount: 1500, currency: 'EUR' })
  })
})

describe('parsePrizeMoneyText — null + garbage inputs', () => {
  it('returns null for null', () => expect(parsePrizeMoneyText(null)).toBeNull())
  it('returns null for undefined', () => expect(parsePrizeMoneyText(undefined)).toBeNull())
  it('returns null for empty string', () => expect(parsePrizeMoneyText('')).toBeNull())
  it('returns null for whitespace-only', () => expect(parsePrizeMoneyText('   ')).toBeNull())
  it('returns null for non-numeric "TBD"', () => expect(parsePrizeMoneyText('TBD')).toBeNull())
  it('returns null for currency only "EUR"', () => expect(parsePrizeMoneyText('EUR')).toBeNull())
})

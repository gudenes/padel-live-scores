/**
 * Parses messy prize-money strings from upstream sources (padelapi.org,
 * FIP scrapers) into a structured { amount, currency } shape.
 *
 * Pure function — no I/O, no DB. Returns null when the input is
 * genuinely ambiguous or unparseable; the caller is responsible for
 * surfacing nulls to a manual-review queue.
 *
 * Handles 8+ observed production formats. See unit tests for the full
 * matrix.
 */

export type ParsedPrize = {
  amount: number
  currency: 'EUR' | 'USD' | 'OTHER'
}

const CURRENCY_RE = /(EUR|USD|€|\$)/i

function detectCurrency(input: string): { currency: ParsedPrize['currency']; stripped: string } {
  const m = input.match(CURRENCY_RE)
  if (!m) return { currency: 'OTHER', stripped: input }
  const sym = m[1].toUpperCase()
  const currency: ParsedPrize['currency'] =
    sym === 'EUR' || sym === '€' ? 'EUR' :
    sym === 'USD' || sym === '$' ? 'USD' :
    'OTHER'
  return { currency, stripped: input.replace(CURRENCY_RE, '') }
}

function parseNumericPart(raw: string): number | null {
  const cleaned = raw.replace(/\s+/g, '')
  if (!cleaned) return null
  if (!/^[\d.,]+$/.test(cleaned)) return null

  const hasComma = cleaned.includes(',')
  const hasDot = cleaned.includes('.')

  // Both separators → US format: '.' decimal, ',' thousands
  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(',')
    const lastDot = cleaned.lastIndexOf('.')
    if (lastDot > lastComma) {
      // US: 479,068.00
      const stripped = cleaned.replace(/,/g, '')
      const n = Number.parseFloat(stripped)
      return Number.isFinite(n) ? Math.trunc(n) : null
    } else {
      // European: 479.068,00
      const stripped = cleaned.replace(/\./g, '').replace(',', '.')
      const n = Number.parseFloat(stripped)
      return Number.isFinite(n) ? Math.trunc(n) : null
    }
  }

  // Only comma → US thousands (e.g. 30,000)
  if (hasComma && !hasDot) {
    const stripped = cleaned.replace(/,/g, '')
    const n = Number.parseInt(stripped, 10)
    return Number.isFinite(n) ? n : null
  }

  // Only dot → ambiguous. Apply trailing-.000 rule.
  if (hasDot && !hasComma) {
    const digits = cleaned.replace(/\./g, '')
    if (digits.length > 6) {
      // 1.234.567 — clearly European multi-thousand
      const n = Number.parseInt(digits, 10)
      return Number.isFinite(n) ? n : null
    }
    // Single dot, ≤ 6 total digits
    const parts = cleaned.split('.')
    if (parts.length === 2) {
      const prefix = parts[0]
      const suffix = parts[1]
      // European thousands rule: "X.YYY" where X has ≥2 digits and YYY
      // is exactly 3 digits → X * 1000 + YYY. The prefix-length-2 floor
      // is a domain assumption: prize pools are never under €100, so
      // "10.500" is safe to read as €10,500 (not €10.50). Inputs with a
      // 1-digit prefix like "1.500" remain ambiguous and return null.
      if (suffix.length === 3 && /^\d{3}$/.test(suffix) && prefix.length >= 2) {
        const n = Number.parseInt(digits, 10)
        return Number.isFinite(n) ? n : null
      }
    }
    // Genuinely ambiguous (e.g. 1.500 — could be 1500 or 1.50)
    return null
  }

  // No separator → parse directly
  const n = Number.parseInt(cleaned, 10)
  return Number.isFinite(n) ? n : null
}

export function parsePrizeMoneyText(input: string | null | undefined): ParsedPrize | null {
  if (input == null) return null
  const trimmed = input.trim()
  if (!trimmed) return null

  const { currency, stripped } = detectCurrency(trimmed)
  const amount = parseNumericPart(stripped)
  if (amount == null) return null

  return { amount, currency }
}

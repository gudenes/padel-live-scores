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
      // If suffix is exactly 3 digits AND prefix has ≥ 2 digits, it's European thousands
      if (suffix.length === 3 && /^\d{3}$/.test(suffix) && prefix.length >= 2) {
        // 19.950, 264.534, 25.000 → European thousands
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

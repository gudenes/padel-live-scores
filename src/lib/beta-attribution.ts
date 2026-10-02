/** Campaign metadata only: never store arbitrary URL parameters or click identifiers. */
export const betaTrackingKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const
export type BetaAttribution = Partial<Record<typeof betaTrackingKeys[number], string>>

export function normalizeBetaAttribution(input: unknown): BetaAttribution {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const result: BetaAttribution = {}
  for (const key of betaTrackingKeys) {
    const value = (input as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.trim() && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value)) {
      result[key] = value.trim()
    }
  }
  return result
}

export function betaAttributionFromSearch(search: string): BetaAttribution {
  return normalizeBetaAttribution(Object.fromEntries(new URLSearchParams(search)))
}

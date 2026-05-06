// Pure helpers for the cookie-consent state machine.
//
// State lives in localStorage under `pn_consent`. The shape is intentionally
// flat — three booleans (essential is implicit) plus the timestamp of the
// last decision, used to drive the 12-month re-consent prompt.
//
// All functions here are side-effect free. The React hook (useConsent) is
// the layer that touches localStorage; tests for that are manual / browser.

export interface ConsentState {
  analytics: boolean
  push: boolean
  decided_at: string // ISO-8601
}

// 12 months — industry-standard re-consent cadence (Spotify, Strava, FotMob).
export const RECONSENT_INTERVAL_MS = 365 * 24 * 60 * 60 * 1000

export function parseConsent(raw: string | null): ConsentState | null {
  if (!raw) return null
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  if (typeof o.analytics !== 'boolean') return null
  if (typeof o.push !== 'boolean') return null
  if (typeof o.decided_at !== 'string') return null
  return {
    analytics: o.analytics,
    push: o.push,
    decided_at: o.decided_at,
  }
}

export function serializeConsent(c: ConsentState): string {
  return JSON.stringify(c)
}

export function isExpired(decidedAtISO: string, nowMs: number): boolean {
  const decidedMs = new Date(decidedAtISO).getTime()
  if (Number.isNaN(decidedMs)) return true
  return nowMs - decidedMs > RECONSENT_INTERVAL_MS
}

// Legacy migration: users who set `pn_analytics_opt_out='1'` via the old
// settings page should not be re-banner'd. Treat them as having explicitly
// rejected analytics + push. Returns null when no migration is needed.
export function migrateLegacy(
  pnConsentRaw: string | null,
  legacyOptOut: string | null,
): ConsentState | null {
  if (pnConsentRaw) return null // caller already has a parsed value
  if (legacyOptOut !== '1') return null
  return {
    analytics: false,
    push: false,
    decided_at: new Date().toISOString(),
  }
}

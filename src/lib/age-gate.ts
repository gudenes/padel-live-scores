// Pure, side-effect-free helpers for the device-level 18+ gate. State lives in
// localStorage under `pn_age_verified`; the React layer (useAgeGate) is the only
// thing that touches storage. Mirrors the split in lib/consent.ts.

export interface AgeVerification {
  verified: boolean        // passed the gate (>= market minAge)
  birthdate: string | null // ISO YYYY-MM-DD; null when the user answered "No"
  decided_at: string       // ISO-8601 timestamp of the decision
}

/**
 * Whole years between birthdate and now. Returns -1 for invalid or future dates
 * (callers treat -1 as "not old enough").
 */
export function computeAge(birthdateISO: string, now: Date): number {
  const b = new Date(birthdateISO)
  if (Number.isNaN(b.getTime())) return -1
  if (b.getTime() > now.getTime()) return -1
  let age = now.getUTCFullYear() - b.getUTCFullYear()
  const monthDiff = now.getUTCMonth() - b.getUTCMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < b.getUTCDate())) {
    age -= 1
  }
  return age
}

export function isOldEnough(birthdateISO: string, minAge: number, now: Date): boolean {
  const age = computeAge(birthdateISO, now)
  return age >= minAge
}

export function serializeAgeVerification(v: AgeVerification): string {
  return JSON.stringify(v)
}

export function parseAgeVerification(raw: string | null): AgeVerification | null {
  if (!raw) return null
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  if (typeof o.verified !== 'boolean') return null
  if (!(o.birthdate === null || typeof o.birthdate === 'string')) return null
  if (typeof o.decided_at !== 'string') return null
  return { verified: o.verified, birthdate: o.birthdate, decided_at: o.decided_at }
}

// src/lib/foryou-allow-list.ts
// During dark launch, force ON for an operator-curated set of emails even when
// the `foryou_enabled` feature flag's `enabled` column is false in prod.
// Removed (or left empty) once the flag flips ON publicly.

const ALLOW_LIST = new Set<string>([
  // Add operator + tester emails here, lowercase.
  // e.g. 'operator@padelnachos.com',
])

export function isInForYouAllowList(email: string | null | undefined): boolean {
  if (!email) return false
  return ALLOW_LIST.has(email.toLowerCase())
}

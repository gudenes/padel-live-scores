// src/lib/entitlements.ts
// Single source of truth for Pro entitlement decisions.
// `profiles.plan` is flipped manually until billing ships (premium-notifications spec).

export type Plan = 'free' | 'pro'

export type PlanRow = {
  plan: Plan
  plan_expires_at: string | null
}

/**
 * True iff the row is on the Pro plan and not past its (optional) expiry.
 * Null/undefined (anon users, missing profile) → false.
 */
export function isPro(row: Pick<PlanRow, 'plan' | 'plan_expires_at'> | null | undefined): boolean {
  if (!row || row.plan !== 'pro') return false
  if (row.plan_expires_at == null) return true
  const expiry = Date.parse(row.plan_expires_at)
  if (Number.isNaN(expiry)) return true // unparseable expiry → don't punish a paying user
  return expiry > Date.now()
}

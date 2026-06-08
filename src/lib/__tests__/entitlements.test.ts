// src/lib/__tests__/entitlements.test.ts
import { describe, it, expect } from 'vitest'
import { isPro, type PlanRow } from '@/lib/entitlements'

const FAR_FUTURE = '2999-01-01T00:00:00Z'
const PAST = '2000-01-01T00:00:00Z'

describe('isPro', () => {
  it('returns false for free plan', () => {
    expect(isPro({ plan: 'free', plan_expires_at: null })).toBe(false)
  })
  it('returns true for pro plan with no expiry', () => {
    expect(isPro({ plan: 'pro', plan_expires_at: null })).toBe(true)
  })
  it('returns true for pro plan not yet expired', () => {
    expect(isPro({ plan: 'pro', plan_expires_at: FAR_FUTURE })).toBe(true)
  })
  it('returns false for pro plan past expiry', () => {
    expect(isPro({ plan: 'pro', plan_expires_at: PAST })).toBe(false)
  })
  it('returns false for null/undefined row (anon or missing profile)', () => {
    expect(isPro(null)).toBe(false)
    expect(isPro(undefined)).toBe(false)
  })
  it('treats unknown plan string as not pro', () => {
    expect(isPro({ plan: 'enterprise' as PlanRow['plan'], plan_expires_at: null })).toBe(false)
  })
  it('fails open for an unparseable expiry on a pro plan (do not punish a payer)', () => {
    expect(isPro({ plan: 'pro', plan_expires_at: 'not-a-date' })).toBe(true)
  })
})

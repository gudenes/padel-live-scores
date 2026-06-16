'use client'
// Single source of truth for "is betting allowed here, and what's the next step".
// Composes the gate chain (flag → geo market → premier tier → GDPR consent →
// device age decision) so every betting surface — the page-level age gate AND the
// inline odds widget — reads the same policy instead of duplicating it.
//
// `market` is non-null only when all NON-age gates pass. From there:
//   - needsAgeGate: show the age prompt (no age decision recorded yet)
//   - showWidget:   render the odds widget (user verified 18+)
// A user who declined / is under-age has `decided` true but `verified` false, so
// both flags are false → nothing renders (page shows, just without odds).

import { useFeatureFlag } from '@/hooks/useFeatureFlag'
import { useGeoCountry } from '@/hooks/useGeoCountry'
import { useConsent } from '@/hooks/useConsent'
import { useAgeGate } from '@/hooks/useAgeGate'
import { FLAG_KEYS } from '@/lib/feature-flags'
import { getBettingMarket, type BettingMarket } from '@/lib/betting-markets'
import { isPremierLevel } from '@/lib/tournament-labels'
import type { AgeVerification } from '@/lib/age-gate'

export interface BettingEligibility {
  /** The enabled market when every non-age gate passes; null otherwise. */
  market: BettingMarket | null
  /** Visitor country (ISO alpha-2) — only meaningful when market is non-null. */
  geo: string | null
  /** Eligible to bet here AND no age decision recorded yet → show the age gate. */
  needsAgeGate: boolean
  /** Eligible to bet here AND user is verified 18+ → render the odds widget. */
  showWidget: boolean
  /** Persist the user's age decision (device-level). */
  setAgeVerification: (next: AgeVerification) => void
}

export function useBettingEligibility(
  tournamentLevel: string | null | undefined,
): BettingEligibility {
  const flagOn = useFeatureFlag(FLAG_KEYS.BETTING_ENABLED)
  const geo = useGeoCountry()
  const { hasDecided } = useConsent()
  const { verified, decided: ageDecided, hydrated, setAgeVerification } = useAgeGate()

  const market = getBettingMarket(geo)
  const baseEligible =
    flagOn && !!market && isPremierLevel(tournamentLevel) && hasDecided && hydrated

  return {
    market: baseEligible ? market : null,
    geo,
    needsAgeGate: baseEligible && !ageDecided,
    showWidget: baseEligible && verified,
    setAgeVerification,
  }
}

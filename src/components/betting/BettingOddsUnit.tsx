'use client'
// Fail-closed gated wrapper for the betting odds widget. Gate chain:
//   1. feature flag (betting_enabled)
//   2. geo-country in an ENABLED market
//   3. premier-tier match (coverage optimization — bookmakers rarely price
//      FIP-tier padel; remove this gate if a provider covers lower tiers)
//   4. GDPR consent decided (don't mount a 3rd-party tracker pre-consent)
//   5. 18+ age gate passed
// Any check missing/failed → render nothing (or the age prompt at step 5).
//
// All hooks run unconditionally (React rule); early returns happen after.

import { useTranslations } from 'next-intl'
import { useFeatureFlag } from '@/hooks/useFeatureFlag'
import { useGeoCountry } from '@/hooks/useGeoCountry'
import { useConsent } from '@/hooks/useConsent'
import { useAgeGate } from '@/hooks/useAgeGate'
import { FLAG_KEYS } from '@/lib/feature-flags'
import { getBettingMarket } from '@/lib/betting-markets'
import { isPremierLevel } from '@/lib/tournament-labels'
import { BettingProviderWidget } from './BettingProviderWidget'
import { AgeGatePrompt } from './AgeGatePrompt'

export interface BettingOddsUnitProps {
  matchId: string
  tournamentLevel: string | null | undefined
  homeLabel: string
  awayLabel: string
}

export function BettingOddsUnit({ matchId, tournamentLevel, homeLabel, awayLabel }: BettingOddsUnitProps) {
  const t = useTranslations('betting')
  const flagOn = useFeatureFlag(FLAG_KEYS.BETTING_ENABLED)
  const geo = useGeoCountry()
  const { hasDecided } = useConsent()
  const { verified, decided: ageDecided, hydrated, setAgeVerification } = useAgeGate()

  const market = getBettingMarket(geo)

  // Gate chain (fail-closed).
  if (!flagOn) return null
  if (!market) return null
  if (!isPremierLevel(tournamentLevel)) return null
  if (!hasDecided) return null          // GDPR: no tracker before consent decided
  if (!hydrated) return null            // avoid SSR/first-paint flash

  const containerStyle: React.CSSProperties = {
    margin: '8px 16px', display: 'flex', flexDirection: 'column', gap: 6,
  }

  // Age gate not yet passed.
  if (!verified) {
    // User explicitly answered "No"/under-age → respect it, show nothing meaningful.
    if (ageDecided) return null
    return (
      <div style={containerStyle}>
        <AgeGatePrompt
          minAge={market.minAge}
          onResolve={(r) => setAgeVerification({ ...r, decided_at: new Date().toISOString() })}
        />
      </div>
    )
  }

  // Passed all gates → render the odds widget + mandated disclaimer.
  return (
    <div style={containerStyle}>
      <span style={{ fontSize: 9, fontWeight: 700, color: '#777', textTransform: 'uppercase', letterSpacing: '1px' }}>
        {t('adLabel')}
      </span>
      <BettingProviderWidget matchId={matchId} homeLabel={homeLabel} awayLabel={awayLabel} geoCountry={geo as string} />
      <p style={{ fontSize: 11, color: '#888', margin: 0, lineHeight: 1.4 }}>
        {t(`disclaimers.${market.disclaimerKey}`)}
      </p>
    </div>
  )
}

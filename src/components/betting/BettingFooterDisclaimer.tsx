'use client'
// Geo-gated footer line. Shows the country's mandated responsible-gambling text
// ONLY in enabled markets — never in countries where the odds unit can't appear.
// Independent of the age gate (it's a passive notice, not betting content).

import { useTranslations } from 'next-intl'
import { useFeatureFlag } from '@/hooks/useFeatureFlag'
import { useGeoCountry } from '@/hooks/useGeoCountry'
import { FLAG_KEYS } from '@/lib/feature-flags'
import { getBettingMarket } from '@/lib/betting-markets'

export function BettingFooterDisclaimer() {
  const t = useTranslations('betting')
  const flagOn = useFeatureFlag(FLAG_KEYS.BETTING_ENABLED)
  const geo = useGeoCountry()
  const market = getBettingMarket(geo)

  if (!flagOn) return null
  if (!market) return null

  return (
    <p style={{ fontSize: 10, color: '#666', textAlign: 'center', padding: '12px 16px', margin: 0 }}>
      {t(`disclaimers.${market.disclaimerKey}`)}
    </p>
  )
}

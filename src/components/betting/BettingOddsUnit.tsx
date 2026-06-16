'use client'
// Inline odds widget, rendered directly under the score. Shows ONLY when the user
// is eligible AND has verified 18+ — the age PROMPT itself lives in MatchBettingGate
// (the page-level modal). All gate logic comes from useBettingEligibility; this
// component just renders the widget + mandated disclaimer once cleared.

import { useTranslations } from 'next-intl'
import { useBettingEligibility } from '@/hooks/useBettingEligibility'
import { BettingProviderWidget } from './BettingProviderWidget'

export interface BettingOddsUnitProps {
  matchId: string
  tournamentLevel: string | null | undefined
  homeLabel: string
  awayLabel: string
}

export function BettingOddsUnit({ matchId, tournamentLevel, homeLabel, awayLabel }: BettingOddsUnitProps) {
  const t = useTranslations('betting')
  const { market, geo, showWidget } = useBettingEligibility(tournamentLevel)

  if (!showWidget || !market) return null

  return (
    <div style={{ margin: '8px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
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

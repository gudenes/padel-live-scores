'use client'
// Isolated provider embed. The exact provider (Oddspedia / OddsMatrix / an
// affiliate network) is finalized at integration time; this file is the ONLY
// place that knows the provider's URL shape, so a swap touches nothing else.
//
// The src is built from NEXT_PUBLIC_BETTING_WIDGET_URL_TEMPLATE with tokens
// {geo} {home} {away} {matchId} interpolated. Fail-closed: no template → null.

import { useMemo } from 'react'

export interface BettingProviderWidgetProps {
  matchId: string
  homeLabel: string
  awayLabel: string
  geoCountry: string
}

export function BettingProviderWidget({
  matchId, homeLabel, awayLabel, geoCountry,
}: BettingProviderWidgetProps) {
  const src = useMemo(() => {
    const template = process.env.NEXT_PUBLIC_BETTING_WIDGET_URL_TEMPLATE
    if (!template) return null
    return template
      .replace('{geo}', encodeURIComponent(geoCountry))
      .replace('{home}', encodeURIComponent(homeLabel))
      .replace('{away}', encodeURIComponent(awayLabel))
      .replace('{matchId}', encodeURIComponent(matchId))
  }, [matchId, homeLabel, awayLabel, geoCountry])

  if (!src) return null

  return (
    <iframe
      src={src}
      title="Betting odds"
      loading="lazy"
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-same-origin"
      referrerPolicy="no-referrer-when-downgrade"
      style={{
        width: '100%',
        border: 'none',
        minHeight: 140,
        background: 'transparent',
        colorScheme: 'normal',
      }}
    />
  )
}

// src/app/[locale]/(app)/home/HomeDesktop.tsx
// Desktop variant of the /home page. Composes <DesktopShell/> with a
// per-page rail (LiveTickerRail at the top, more rail panels coming in
// later waves) and a wide main column.
//
// For Wave 1 the main column reuses the existing mobile section
// components from src/components/home/* — they already handle their
// own data fetching and look reasonable at the wider column. Subsequent
// polish (Spotlight hero variant, denser layout, etc.) ships
// incrementally without re-architecting the page.

'use client'

import { Suspense } from 'react'
import DesktopShell from '@/components/desktop/DesktopShell'
import LiveTickerRail from '@/components/desktop/rail/LiveTickerRail'
import DesktopRouteMarker from '@/components/desktop/DesktopRouteMarker'
import HomeMobile from './HomeMobile'

export default function HomeDesktop() {
  return (
    <DesktopShell rail={<LiveTickerRail />}>
      <DesktopRouteMarker />
      <Suspense fallback={null}>
        {/* Wave 1: reuse the existing mobile home tree as the main column.
            It already fetches data and renders the right sections; the
            extra horizontal space just lets it breathe. Future waves
            replace this with a desktop-tuned section composition (wider
            hero, 2x2 tournament grid, etc.). */}
        <HomeMobile />
      </Suspense>
    </DesktopShell>
  )
}

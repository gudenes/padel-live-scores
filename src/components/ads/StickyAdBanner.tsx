// src/components/ads/StickyAdBanner.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { usePathname } from '@/i18n/navigation'
import { pickBanner } from '@/lib/ad-banner-resolver'
import { useActiveBanner } from '@/hooks/useActiveBanner'
import { useGeoCountry } from '@/hooks/useGeoCountry'
import { useConsent } from '@/hooks/useConsent'
import { AdSlot } from './AdSlot'
import { useAdMobBanner } from './useAdMobBanner'

/**
 * Routes where the sticky banner is allowed (locale-stripped paths):
 *   /matches, /matches/<date>, /match/<id>, /player/<id>.
 * Scoped for now; widen this matcher to show on more pages later.
 */
function isAdRoute(pathname: string): boolean {
  return /^\/(matches(\/|$)|match\/|player\/)/.test(pathname)
}

/**
 * Sticky anchor banner (Sofascore-style). Pinned just above the bottom nav,
 * within the app's 500px column. Shown only on matches / match-detail / player
 * pages (see isAdRoute), and only when a sponsor matches the visitor's country
 * (else the NetworkAdSlot seam would fill it later — nothing today).
 */
export function StickyAdBanner() {
  const country = useGeoCountry()
  const pathname = usePathname()
  const { hasDecided } = useConsent()
  const active = useActiveBanner('sticky-bottom')
  const banner = active ? pickBanner(active.banners, country) : null
  // ?geo=XX is a manual testing override; in that mode we also skip the
  // consent gate so the banner can be previewed on a device without going
  // through the cookie flow.
  const testingGeo =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('geo')
  // Native apps (iOS/Android) deliberately never render the cookie-consent
  // prompt (App Store 5.1.2), so `hasDecided` is never set there. Treat native
  // as eligible: this is a first-party, direct-sold image ad (not third-party
  // cookie tracking), and the apps run analytics in memory-mode already.
  const isNative = Capacitor.isNativePlatform()
  // On the web, otherwise hold the banner until the visitor has dealt with the
  // cookie-consent prompt — keeps the consent UI unobstructed and avoids firing
  // an ad impression before consent (matters for EU/Spain visitors).
  const visible =
    !!banner && isAdRoute(pathname) && (hasDecided || testingGeo || isNative)

  // We also need navHeight when the NATIVE AdMob banner is in play (no direct
  // banner, so `visible` is false, but the overlay still needs to sit above
  // the bottom nav). Without this the measurement effect early-returns and
  // navHeight stays 0 → the native banner covers the nav.
  const needNavHeight = visible || (isNative && isAdRoute(pathname))

  const ref = useRef<HTMLDivElement>(null)
  const [navHeight, setNavHeight] = useState(0)

  // Testing convenience: persist a ?geo=XX override into the cookie so it
  // survives in-app navigation (which drops the query string).
  useEffect(() => {
    const override = new URLSearchParams(window.location.search).get('geo')
    if (override) {
      document.cookie = `geo-country=${override.toUpperCase()};path=/;max-age=86400`
    }
  }, [])

  // Sit directly above the bottom nav. Measure it so we adapt to the
  // safe-area inset (notch / home indicator) without hardcoding heights.
  //
  // The nav can mount late and even be *swapped* (a page's loading skeleton
  // renders its own nav, then the real content replaces it). So we re-resolve
  // `.v3-nav` on every DOM mutation and re-point the ResizeObserver at the
  // current element. setNavHeight with an unchanged value is a no-op, so this
  // stays cheap despite the broad observer.
  useEffect(() => {
    if (!needNavHeight) return
    let observed: HTMLElement | null = null
    let ro: ResizeObserver | null = null
    const sync = () => {
      const nav = document.querySelector('.v3-nav') as HTMLElement | null
      if (nav && nav !== observed) {
        ro?.disconnect()
        ro = new ResizeObserver(() => {
          const n = document.querySelector('.v3-nav') as HTMLElement | null
          setNavHeight(n ? n.offsetHeight : 0)
        })
        ro.observe(nav)
        observed = nav
      }
      setNavHeight(nav ? nav.offsetHeight : 0)
    }
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', sync)
    return () => {
      ro?.disconnect()
      mo.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [needNavHeight])

  // Native AdMob fill: show the native banner when there's no matching direct
  // banner on an ad route (the hook no-ops on web and when ineligible). Runs
  // unconditionally every render — placed before the early return below.
  useAdMobBanner({
    pathname,
    hasDirectBanner: !!banner,
    network: active?.network ?? null,
    navHeight,
  })

  if (!visible) return null

  return (
    // position: sticky (not fixed) so it pins correctly inside the desktop
    // phone-frame scroll container — that container uses `contain: paint`,
    // which would make a fixed element scroll away with content. Sticky also
    // takes flow space, so no manual body padding is needed. Mirrors the nav
    // and consent banner. `bottom: navHeight` parks it just above the nav.
    <div
      ref={ref}
      style={{
        position: 'sticky',
        bottom: navHeight,
        width: '100%',
        maxWidth: 500,
        margin: '0 auto',
        zIndex: 199,
      }}
    >
      <AdSlot slot="sticky-bottom" variant="sticky" banner={banner} />
    </div>
  )
}

// src/components/ads/useAdMobBanner.ts
'use client'

import { useEffect, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import { shouldShowAdMob, pickBannerUnit } from '@/lib/admob-eligibility'
import type { AdNetworkConfig } from '@/lib/ad-banner-resolver'

/**
 * Shows/hides the native AdMob adaptive banner (BOTTOM_CENTER, margined above
 * the bottom nav). Native-only — no-ops on web. The banner is a native overlay,
 * not a DOM node. Driven by the same inputs as the web sticky banner:
 *   - pathname (ad-route gate)
 *   - hasDirectBanner (a direct sponsor banner is showing → AdMob stays hidden)
 *   - network config (native_enabled + per-platform banner unit)
 *   - navHeight (margin so the banner sits above the tab bar)
 */
export function useAdMobBanner(args: {
  pathname: string
  hasDirectBanner: boolean
  network: AdNetworkConfig | null
  navHeight: number
}): void {
  const { pathname, hasDirectBanner, network, navHeight } = args
  const shownRef = useRef(false)

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const platform = Capacitor.getPlatform() // 'ios' | 'android'
    const eligible = shouldShowAdMob({
      isNative: true,
      pathname,
      hasDirectBanner,
      networkNativeEnabled: !!network?.native_enabled,
    })
    const unit = network ? pickBannerUnit(platform, network) : null

    let cancelled = false
    ;(async () => {
      try {
        const { AdMob, BannerAdSize, BannerAdPosition } = await import('@capacitor-community/admob')
        if (eligible && unit) {
          await AdMob.showBanner({
            adId: unit,
            adSize: BannerAdSize.ADAPTIVE_BANNER,
            position: BannerAdPosition.BOTTOM_CENTER,
            margin: Math.max(0, Math.round(navHeight)),
          })
          if (!cancelled) shownRef.current = true
        } else if (shownRef.current) {
          await AdMob.removeBanner()
          if (!cancelled) shownRef.current = false
        }
      } catch (err) {
        console.log('[AdMob] banner toggle failed:', err)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [pathname, hasDirectBanner, network, navHeight])

  // Hide the banner when the component using this hook unmounts.
  useEffect(() => {
    return () => {
      if (!Capacitor.isNativePlatform() || !shownRef.current) return
      void import('@capacitor-community/admob')
        .then(({ AdMob }) => AdMob.removeBanner())
        .catch(() => {})
    }
  }, [])
}

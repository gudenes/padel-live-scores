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

    ;(async () => {
      try {
        const { AdMob, BannerAdSize, BannerAdPosition } = await import('@capacitor-community/admob')
        if (eligible && unit) {
          shownRef.current = true
          await AdMob.showBanner({
            adId: unit,
            adSize: BannerAdSize.ADAPTIVE_BANNER,
            position: BannerAdPosition.BOTTOM_CENTER,
            margin: Math.max(0, Math.round(navHeight)),
          })
        } else {
          // Not eligible (e.g. navigated OFF the match-detail page). Always tear
          // the banner down — never gate this on a "was it shown?" flag. A show
          // interrupted by fast navigation could leave that flag unset while the
          // native overlay is actually up, stranding the banner at the bottom of
          // every other screen. removeBanner rejects when nothing is shown; that
          // rejection is a harmless no-op we swallow.
          shownRef.current = false
          await AdMob.removeBanner().catch(() => {})
        }
      } catch (err) {
        console.log('[AdMob] banner toggle failed:', err)
      }
    })()
  }, [pathname, hasDirectBanner, network, navHeight])

  // Reserve layout space for the native banner so it never overlaps the
  // bottom nav. On Android 15+ the plugin pins the banner to the system inset
  // and IGNORES our `margin`, so we can't lift the banner — instead we lift
  // the web nav + content by the banner's real height. The plugin reports that
  // height (in dp ≈ CSS px) via the bannerAdSizeChanged event: non-zero when a
  // banner is visible, 0 when hidden/removed. We publish it to the
  // `--admob-banner-h` CSS var that BottomNavV3 + body padding consume.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let handle: { remove: () => void } | null = null
    let cancelled = false
    ;(async () => {
      try {
        const { AdMob, BannerAdPluginEvents } = await import('@capacitor-community/admob')
        const h = await AdMob.addListener(
          BannerAdPluginEvents.SizeChanged,
          (info: { height: number }) => {
            const px = info && info.height > 0 ? `${info.height}px` : '0px'
            document.documentElement.style.setProperty('--admob-banner-h', px)
          },
        )
        if (cancelled) h.remove()
        else handle = h
      } catch {
        // plugin unavailable — leave the var at its 0px default
      }
    })()
    return () => {
      cancelled = true
      handle?.remove()
      document.documentElement.style.setProperty('--admob-banner-h', '0px')
    }
  }, [])

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

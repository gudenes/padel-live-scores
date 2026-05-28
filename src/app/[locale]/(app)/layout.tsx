'use client'
// src/app/(app)/layout.tsx
// App layout shell — bottom nav with PadelNachos branding.

import { useSearchParams } from 'next/navigation'
import { usePathname } from '@/i18n/navigation'
import BottomNavV3 from '@/components/nav/BottomNavV3'
import { BadgeToastProvider } from '@/components/BadgeToast'
import DesktopDownloadRail from '@/components/DesktopDownloadRail'
import { ForYouOverlayProvider, useForYouOverlay } from '@/hooks/useForYouOverlay'
import { ForYouOverlay } from '@/components/feed/foryou/ForYouOverlay'

// Routes that render their own focused chrome and should NOT show the
// app's bottom nav. The picker uses its own sticky Continue/Skip CTA at
// the bottom of the viewport — overlaying the nav would intercept the
// CTA's clicks.
const FULLSCREEN_ROUTES = new Set(['/welcome', '/scratch-foryou'])

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <BadgeToastProvider>
      <ForYouOverlayProvider>
        <AppLayoutInner>{children}</AppLayoutInner>
        <ForYouOverlay />
      </ForYouOverlayProvider>
    </BadgeToastProvider>
  )
}

/**
 * Inner layout — needs to be a child of ForYouOverlayProvider so it can
 * subscribe to the overlay's open state. When the overlay is open, the
 * bottom nav + download rail hide so the immersive feed truly takes over
 * the viewport.
 */
function AppLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { isOpen: overlayOpen } = useForYouOverlay()
  // For You tab on /feed is also fullscreen (immersive card stack).
  const isForYouTab = pathname === '/feed' && searchParams.get('tab') === 'foryou'
  const hideNav = FULLSCREEN_ROUTES.has(pathname) || isForYouTab || overlayOpen
  return (
    <>
      {/* NotificationNudgeProvider moved UP to [locale]/layout.tsx so it
          also covers /match/[id] and /player/[id] (those routes live
          outside this (app) group but still need the nudge context). */}
      <div style={{ paddingBottom: hideNav ? 0 : 72 }}>{children}</div>
      {!hideNav && <BottomNavV3 />}
      {/* Quiet "get the app" rail — desktop-only, hidden inside Capacitor
          shells. Self-gated for mobile/tablet via CSS media query. Skipped
          on full-screen routes for the same reason BottomNavV3 is. */}
      {!hideNav && <DesktopDownloadRail />}
    </>
  )
}

'use client'
// src/app/(app)/layout.tsx
// App layout shell — bottom nav with PadelNachos branding.

import { usePathname } from '@/i18n/navigation'
import BottomNavV3 from '@/components/nav/BottomNavV3'
import { BadgeToastProvider } from '@/components/BadgeToast'
import DesktopDownloadRail from '@/components/DesktopDownloadRail'
import { ForYouOverlayProvider } from '@/hooks/useForYouOverlay'
import { ForYouOverlay } from '@/components/feed/foryou/ForYouOverlay'

// Routes that render their own focused chrome and should NOT show the
// app's bottom nav. The picker uses its own sticky Continue/Skip CTA at
// the bottom of the viewport — overlaying the nav would intercept the
// CTA's clicks.
const FULLSCREEN_ROUTES = new Set(['/welcome'])

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const hideNav = FULLSCREEN_ROUTES.has(pathname)
  return (
    <BadgeToastProvider>
      <ForYouOverlayProvider>
        <div style={{ paddingBottom: hideNav ? 0 : 72 }}>{children}</div>
        {!hideNav && <BottomNavV3 />}
        {/* Quiet "get the app" rail — desktop-only, hidden inside Capacitor
            shells. Self-gated for mobile/tablet via CSS media query. Skipped
            on full-screen routes for the same reason BottomNavV3 is. */}
        {!hideNav && <DesktopDownloadRail />}
        <ForYouOverlay />
      </ForYouOverlayProvider>
    </BadgeToastProvider>
  )
}

'use client'
// src/app/[locale]/(app)/layout.tsx
// App layout shell — bottom nav with PadelNachos branding on mobile;
// global Topbar on desktop. Topbar lives here (not inside DesktopShell)
// so every (app)/* route has navigation during Waves 1–3 while we
// gradually convert each route's main column to a desktop layout.

import { usePathname } from '@/i18n/navigation'
import BottomNavV3 from '@/components/nav/BottomNavV3'
import { BadgeToastProvider } from '@/components/BadgeToast'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import Topbar from '@/components/desktop/Topbar'

// Routes that render their own focused chrome and should NOT show the
// app's bottom nav. The picker uses its own sticky Continue/Skip CTA at
// the bottom of the viewport — overlaying the nav would intercept the
// CTA's clicks.
const FULLSCREEN_ROUTES = new Set(['/welcome'])

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isDesktop = useIsDesktop()
  const isFullscreenRoute = FULLSCREEN_ROUTES.has(pathname)
  const hideBottomNav = isFullscreenRoute || isDesktop
  const showTopbar = isDesktop && !isFullscreenRoute
  return (
    <BadgeToastProvider>
      {showTopbar && <Topbar />}
      <div style={{ paddingBottom: hideBottomNav ? 0 : 72 }}>{children}</div>
      {!hideBottomNav && <BottomNavV3 />}
    </BadgeToastProvider>
  )
}

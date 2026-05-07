'use client'
// src/app/[locale]/(app)/layout.tsx
// App layout shell — bottom nav with PadelNachos branding on mobile;
// hidden on desktop where <Topbar/> (mounted by each *Desktop page's
// shell) handles navigation.

import { usePathname } from '@/i18n/navigation'
import BottomNavV3 from '@/components/nav/BottomNavV3'
import { BadgeToastProvider } from '@/components/BadgeToast'
import { useIsDesktop } from '@/hooks/useIsDesktop'

// Routes that render their own focused chrome and should NOT show the
// app's bottom nav. The picker uses its own sticky Continue/Skip CTA at
// the bottom of the viewport — overlaying the nav would intercept the
// CTA's clicks.
const FULLSCREEN_ROUTES = new Set(['/welcome'])

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isDesktop = useIsDesktop()
  const hideNav = FULLSCREEN_ROUTES.has(pathname) || isDesktop
  return (
    <BadgeToastProvider>
      <div style={{ paddingBottom: hideNav ? 0 : 72 }}>{children}</div>
      {!hideNav && <BottomNavV3 />}
    </BadgeToastProvider>
  )
}

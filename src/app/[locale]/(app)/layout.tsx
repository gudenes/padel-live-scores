'use client'
// src/app/(app)/layout.tsx
// App layout shell — bottom nav with PadelNachos branding.

import dynamic from 'next/dynamic'
import BottomNavV3 from '@/components/nav/BottomNavV3'
import { BadgeToastProvider } from '@/components/BadgeToast'

const SpotlightCoachmarks = dynamic(() => import('@/components/SpotlightCoachmarks').then(m => ({ default: m.SpotlightCoachmarks })), { ssr: false })

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <BadgeToastProvider>
      <div style={{ paddingBottom: 72 }}>{children}</div>
      <BottomNavV3 />
      <SpotlightCoachmarks />
    </BadgeToastProvider>
  )
}

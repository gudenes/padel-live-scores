'use client'
// src/app/v2/layout.tsx
// Shell for all /v2/* pages — provides the floating glassmorphic bottom nav.

import BottomNav from '../components/BottomNav'

export default function V2Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Content — padded at bottom so feed is never hidden behind the nav */}
      <div style={{ paddingBottom: 64 }}>
        {children}
      </div>

      <BottomNav />
    </>
  )
}

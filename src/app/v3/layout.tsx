'use client'
// src/app/v3/layout.tsx
// V3 layout shell — new 3-tab bottom nav with PadelNachos branding.

import BottomNavV3 from './components/BottomNavV3'

export default function V3Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div style={{ paddingBottom: 72 }}>
        {children}
      </div>
      <BottomNavV3 />
    </>
  )
}

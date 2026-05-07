// src/components/desktop/DesktopShell.tsx
// The shared 2-column desktop layout. Renders the global Topbar at the
// top, then a 1280px-max-width grid below: main content (flex) on the
// left, fixed 360px rail on the right.
//
// Each desktop page composes this with its own page-specific rail content:
//
//   <DesktopShell rail={<><LiveTickerRail /><WatchTonightRail /></>}>
//     {/* main column content */}
//   </DesktopShell>
//
// Not rendered on mobile.

'use client'

import type { ReactNode } from 'react'
import Topbar from './Topbar'

interface DesktopShellProps {
  children: ReactNode
  rail?: ReactNode
}

export default function DesktopShell({ children, rail }: DesktopShellProps) {
  return (
    <div style={{ minHeight: '100vh' }}>
      <Topbar />
      <div
        style={{
          maxWidth: 1280,
          margin: '0 auto',
          padding: '32px 40px 80px',
          display: 'grid',
          gridTemplateColumns: rail ? 'minmax(0, 1fr) 360px' : 'minmax(0, 1fr)',
          gap: 36,
          alignItems: 'start',
        }}
      >
        <main style={{ minWidth: 0 }}>{children}</main>
        {rail && <aside style={{ minWidth: 0 }}>{rail}</aside>}
      </div>
    </div>
  )
}

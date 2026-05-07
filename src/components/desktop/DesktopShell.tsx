// src/components/desktop/DesktopShell.tsx
// The shared 2-column desktop layout. Renders a 1280px-max-width grid:
// flexible main column on the left, fixed 360px rail on the right.
//
// The global <Topbar/> is mounted by (app)/layout.tsx for ALL desktop
// pages (including those that haven't been converted yet) — this shell
// is only responsible for the per-page main + rail composition.
//
//   <DesktopShell rail={<><LiveTickerRail /><WatchTonightRail /></>}>
//     {/* main column content */}
//   </DesktopShell>
//
// Not rendered on mobile.

'use client'

import type { ReactNode } from 'react'

interface DesktopShellProps {
  children: ReactNode
  rail?: ReactNode
}

export default function DesktopShell({ children, rail }: DesktopShellProps) {
  return (
    <div style={{ minHeight: '100vh' }}>
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

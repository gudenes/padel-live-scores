// apps/ops/src/app/(app)/layout.tsx
// Auth + operator gate, plus the sidebar + main + activity rail shell
// for every (app)/ route. Also mounts the PlayerDrawerProvider + host so any
// surface can open the drawer via useOpenPlayerDrawer().

import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/Sidebar'
import { ActivityRail } from '@/components/ActivityRail'
import { PlayerDrawerProvider } from '@/components/player-drawer-context'
import { PlayerDrawerHost } from '@/components/PlayerDrawerHost'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) {
    redirect('/login')
  }
  if (!session.user.isOperator) {
    redirect('/not-authorized')
  }
  return (
    <PlayerDrawerProvider>
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          background: 'var(--bg-canvas)',
        }}
      >
        <Sidebar userEmail={session.user.email ?? null} />
        <main style={{ flex: 1, minWidth: 0 }}>{children}</main>
        <ActivityRail />
      </div>
      <PlayerDrawerHost />
    </PlayerDrawerProvider>
  )
}

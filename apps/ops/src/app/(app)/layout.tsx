// apps/ops/src/app/(app)/layout.tsx
// Auth + operator gate. Mounts the new AppShell chrome (global header +
// collapsible accordion rail + light/dark theme) and keeps the PlayerDrawer
// provider/host so any surface can open the drawer via useOpenPlayerDrawer().

import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/shell/AppShell'
import { PlayerDrawerProvider } from '@/components/player-drawer-context'
import { PlayerDrawerHost } from '@/components/PlayerDrawerHost'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (!session.user.isOperator) redirect('/not-authorized')

  return (
    <PlayerDrawerProvider>
      <AppShell userEmail={session.user.email ?? null}>{children}</AppShell>
      <PlayerDrawerHost />
    </PlayerDrawerProvider>
  )
}

// apps/ops/src/app/(app)/layout.tsx
// Auth + operator gate, plus the sidebar shell for every (app)/ route.
// The sidebar (client component) owns collapse state + badge polling;
// the layout passes the operator's email through for the footer.

import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/Sidebar'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) {
    redirect('/login')
  }
  if (!session.user.isOperator) {
    redirect('/not-authorized')
  }
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        background: 'var(--bg-canvas)',
      }}
    >
      <Sidebar userEmail={session.user.email ?? null} />
      <main style={{ flex: 1, minWidth: 0 }}>{children}</main>
    </div>
  )
}

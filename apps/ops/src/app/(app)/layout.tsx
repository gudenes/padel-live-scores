// apps/ops/src/app/(app)/layout.tsx
// Auth + operator gate.
// Anything under (app)/ is only rendered for signed-in operators.
// The full sidebar shell ships in Plan 2 — this file is a minimal gate.

import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) {
    redirect('/login')
  }
  if (!session.user.isOperator) {
    redirect('/not-authorized')
  }
  return <>{children}</>
}

// apps/ops/src/app/(app)/layout.tsx
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/shell/AppShell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) {
    redirect('/login')
  }
  if (!session.user.isOperator) {
    redirect('/not-authorized')
  }
  return <AppShell>{children}</AppShell>
}

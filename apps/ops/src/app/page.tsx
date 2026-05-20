// apps/ops/src/app/page.tsx
// Root router. Signed-in users go to /today (gated; operator check happens in (app)/layout).
// Anonymous users go to /login.

import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function RootPage() {
  const session = await auth()
  if (session?.user) {
    redirect('/today')
  }
  redirect('/login')
}

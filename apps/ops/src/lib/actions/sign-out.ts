// apps/ops/src/lib/actions/sign-out.ts
// Server action wrapping Auth.js v5 signOut. Used by client components that
// need to trigger sign-out from a form action (e.g. SidebarUserMenu).
'use server'

import { signOut } from '@/lib/auth'

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/login' })
}

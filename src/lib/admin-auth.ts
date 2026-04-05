// src/lib/admin-auth.ts
// Email-based admin auth for /admin/* pages and API routes.
// Only @padelnachos.com emails are granted admin access.

import { createServerClient } from '@/lib/supabase'
import { NextRequest } from 'next/server'

const ADMIN_DOMAIN = 'padelnachos.com'

export function isAdminEmail(email: string | undefined | null): boolean {
  return !!email && email.endsWith(`@${ADMIN_DOMAIN}`)
}

/**
 * Verify admin access from an API route request.
 * Checks Authorization Bearer token against Supabase auth,
 * falls back to ops_token cookie for backwards compat.
 * Returns the user email if admin, null otherwise.
 */
export async function verifyAdminRequest(request: NextRequest): Promise<string | null> {
  // Try Supabase auth token
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const supabase = createServerClient()
    const { data: { user } } = await supabase.auth.getUser(token)
    if (user && isAdminEmail(user.email)) return user.email!
  }

  // Fallback: ops_token cookie (backwards compat with CRON_SECRET)
  const cronSecret = process.env.CRON_SECRET
  const cookieToken = request.cookies.get('ops_token')?.value
  if (cronSecret && cookieToken === cronSecret) {
    return 'ops@padelnachos.com'
  }

  return null
}

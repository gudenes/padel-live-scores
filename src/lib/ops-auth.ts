// src/lib/ops-auth.ts
// Shared ops dashboard auth check.
// Phase 1: reads ops_token cookie directly (existing behavior, centralized).
// Phase 2 (proxy integration): reads x-ops-authenticated header set by proxy.

import { cookies, headers } from 'next/headers'

/**
 * Check if the current request is authenticated for ops dashboard access.
 * Returns null if authenticated, or a Response to return if not.
 */
export async function checkOpsAuth(): Promise<Response | null> {
  // Phase 2: check header from proxy first
  const hdrs = await headers()
  if (hdrs.get('x-ops-authenticated') === 'true') return null

  // Phase 1 fallback: read cookie directly
  const cookieStore = await cookies()
  const token = cookieStore.get('ops_token')?.value
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    console.error('[Ops Auth] CRON_SECRET env var is not set')
    return Response.json(
      { error: 'Unauthorized', reason: 'server_misconfigured' },
      { status: 401 }
    )
  }

  if (token !== cronSecret) {
    console.error('[Ops Auth] Token mismatch', {
      hasToken: !!token,
      tokenLength: token?.length,
    })
    return Response.json(
      { error: 'Unauthorized', reason: 'token_mismatch' },
      { status: 401 }
    )
  }

  return null
}

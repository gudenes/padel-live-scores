// src/app/api/user/_auth.ts
// Shared auth check for /api/user/* routes.

import { auth } from '@/auth'
import { createServiceClient } from '@/lib/supabase'

export async function getUserOrFail() {
  const session = await auth()
  if (!session?.user?.id) {
    return { user: null, supabase: null, error: Response.json({ error: 'unauthorized' }, { status: 401 }) }
  }
  return { user: session.user, supabase: createServiceClient(), error: null }
}

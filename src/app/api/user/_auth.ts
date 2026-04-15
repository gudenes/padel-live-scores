// src/app/api/user/_auth.ts
// Shared auth check for /api/user/* routes.

import { auth } from '@/auth'
import { createServiceClient } from '@/lib/supabase'

type AuthSuccess = {
  user: { id: string; name?: string | null; email?: string | null; image?: string | null }
  supabase: ReturnType<typeof createServiceClient>
  error: null
}

type AuthFailure = {
  user: null
  supabase: null
  error: Response
}

export async function getUserOrFail(): Promise<AuthSuccess | AuthFailure> {
  const session = await auth()
  if (!session?.user?.id) {
    return { user: null, supabase: null, error: Response.json({ error: 'unauthorized' }, { status: 401 }) }
  }
  return {
    user: { ...session.user, id: session.user.id },
    supabase: createServiceClient(),
    error: null,
  }
}

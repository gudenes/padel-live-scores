// src/lib/supabase-server-cookie.ts
// Cookie-aware Supabase client for Server Components and API routes.
// Reads/writes session cookies so auth state is consistent with the browser client
// when cookieAuthEnabled is true.

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createServerSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll throws in Server Components (read-only context).
            // Expected — proxy handles refresh.
          }
        },
      },
    }
  )
}

// src/app/auth/callback/route.ts
// Handles OAuth and magic link redirects — exchanges code for session

import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')

  if (code) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { flowType: 'pkce', detectSessionInUrl: false } }
    )

    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      console.error('[Auth Callback] Error exchanging code:', error.message)
      return NextResponse.redirect(new URL('/v2?auth_error=1', requestUrl.origin))
    }
  }

  // Redirect to home after successful auth
  return NextResponse.redirect(new URL('/v2', requestUrl.origin))
}

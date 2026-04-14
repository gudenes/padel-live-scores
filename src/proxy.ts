// src/proxy.ts
// Next.js 16 proxy (formerly middleware.ts)
// Composes pre-i18n auth/redirect logic with next-intl locale routing,
// then decorates the response with geo-country and invite ref cookies.

import createMiddleware from 'next-intl/middleware'
import { createServerClient } from '@supabase/ssr'
import { routing } from './i18n/routing'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const handleI18nRouting = createMiddleware(routing)
const cookieAuthEnabled = process.env.NEXT_PUBLIC_USE_COOKIE_AUTH !== 'false'

export default async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl

  // ── Pre-i18n: short-circuit routes ─────────────────────────────

  // 1. Auth param rescue — if Supabase redirects to wrong page with auth params, forward to callback
  const code = searchParams.get('code')
  const hasAuthCode = code && code.length >= 20 && !/^[0-9]{1,10}$/.test(code)
  const hasTokenHash = searchParams.has('token_hash')
  if ((hasAuthCode || hasTokenHash) && pathname !== '/auth/callback') {
    const callbackUrl = new URL('/auth/callback', request.url)
    callbackUrl.search = request.nextUrl.search
    return NextResponse.redirect(callbackUrl)
  }

  // 2. Legacy /v3/* redirects
  if (pathname === '/v3' || pathname === '/v3/') {
    return NextResponse.redirect(new URL('/home', request.url), 308)
  }
  if (pathname.startsWith('/v3/scores')) {
    return NextResponse.redirect(new URL(pathname.replace('/v3/scores', '/matches'), request.url), 308)
  }
  if (pathname.startsWith('/v3/ranking')) {
    return NextResponse.redirect(new URL(pathname.replace('/v3/ranking', '/rankings'), request.url), 308)
  }
  if (pathname.startsWith('/v3/feed')) {
    return NextResponse.redirect(new URL(pathname.replace('/v3/feed', '/feed'), request.url), 308)
  }
  if (pathname.startsWith('/v3/following')) {
    return NextResponse.redirect(new URL(pathname.replace('/v3/following', '/following'), request.url), 308)
  }
  if (pathname.startsWith('/v3/profile')) {
    return NextResponse.redirect(new URL(pathname.replace('/v3/profile', '/profile'), request.url), 308)
  }
  if (pathname.startsWith('/v3/tournaments')) {
    return NextResponse.redirect(new URL(pathname.replace('/v3/tournaments', '/tournaments'), request.url), 308)
  }

  // 3. Ops dashboard auth (covers /ops pages and /api/ops routes)
  if (pathname.startsWith('/ops') || pathname.startsWith('/api/ops')) {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      return new NextResponse('Server misconfigured', { status: 500 })
    }

    // Check for token in query param (first visit / bookmark) — pages only
    if (pathname.startsWith('/ops')) {
      const tokenParam = request.nextUrl.searchParams.get('token')
      if (tokenParam === cronSecret) {
        // Set cookie and redirect without token in URL
        const cleanUrl = new URL(pathname, request.url)
        const response = NextResponse.redirect(cleanUrl)
        // Set cookie with path=/ so it's sent to both /ops/* and /api/ops/*
        response.cookies.set('ops_token', cronSecret, {
          httpOnly: true,
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 30, // 30 days
          path: '/',
        })
        return response
      }
    }

    // Check cookie
    const cookieToken = request.cookies.get('ops_token')?.value
    if (cookieToken !== cronSecret) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    // /api/ops routes: validate and pass through (skip i18n)
    if (pathname.startsWith('/api/ops')) {
      const headers = new Headers(request.headers)
      headers.set('x-ops-authenticated', 'true')
      return NextResponse.next({ request: { headers } })
    }

    // /ops pages: fall through to i18n routing below
  }

  // 4. Auth routes — outside [locale], skip i18n routing
  if (pathname.startsWith('/auth')) {
    return NextResponse.next()
  }

  // 5. Admin routes — auth checked client-side and in API routes
  if (pathname.startsWith('/admin')) {
    return NextResponse.next()
  }

  // ── Supabase cookie refresh ─────────────────────────────────────
  let supabaseResponse = NextResponse.next({
    request: { headers: request.headers },
  })

  if (cookieAuthEnabled) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: (cookiesToSet) => {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            )
            supabaseResponse = NextResponse.next({ request })
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            )
          },
        },
      }
    )

    // Triggers token refresh if access token expired
    await supabase.auth.getUser()
  }

  // ── Run next-intl locale routing ───────────────────────────────
  const response = handleI18nRouting(request)

  // ── Post-i18n: decorate response with cookies ──────────────────

  // Merge Supabase auth cookies into the i18n response.
  // Copy raw Set-Cookie headers to preserve options (httpOnly, sameSite, maxAge)
  // that getAll() may not carry. This ensures the browser receives the full
  // cookie attributes that @supabase/ssr set in the setAll callback.
  if (cookieAuthEnabled) {
    supabaseResponse.headers.getSetCookie().forEach((setCookieHeader) => {
      response.headers.append('Set-Cookie', setCookieHeader)
    })
  }

  // Geo-country cookie
  const country = request.headers.get('x-vercel-ip-country') ?? ''
  if (country) {
    response.cookies.set('geo-country', country, {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      maxAge: 86400,
    })
  }

  // Geo-timezone cookie (IANA timezone from Vercel IP geolocation)
  const timezone = request.headers.get('x-vercel-ip-timezone') ?? ''
  if (timezone) {
    response.cookies.set('geo-timezone', timezone, {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      maxAge: 86400,
    })
  }

  // Invite ref code capture — ?ref=XXXXXX into a cookie for signup attribution
  const ref = searchParams.get('ref')
  if (ref && /^[A-Z0-9]{6}$/.test(ref)) {
    response.cookies.set('pn_invite_ref', ref, {
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: '/',
      sameSite: 'lax',
    })
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image (static files)
     * - Files with extensions (e.g. .png, .ico, .webp — static assets)
     * - api routes (handled separately)
     * - _vercel (Vercel internals)
     */
    '/((?!api(?!/ops)|_next|_vercel|.*\\..*).*)',
  ],
}

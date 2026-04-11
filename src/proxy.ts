// src/proxy.ts
// Next.js 16 proxy (formerly middleware.ts)
// Handles redirects, auth, geo-country cookies, and invite ref capture.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl

  // ── Auth param rescue — if Supabase redirects to wrong page with auth params, forward to callback ──
  // Supabase verify endpoint redirects with ?code=<auth_code> (36+ char random string)
  const code = searchParams.get('code')
  const hasAuthCode = code && code.length >= 20 && !/^[0-9]{1,10}$/.test(code)
  const hasTokenHash = searchParams.has('token_hash')
  if ((hasAuthCode || hasTokenHash) && pathname !== '/auth/callback') {
    const callbackUrl = new URL('/auth/callback', request.url)
    callbackUrl.search = request.nextUrl.search
    return NextResponse.redirect(callbackUrl)
  }

  // ── Root → Home redirect ────────────────────────────────────
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/home', request.url), 308)
  }

  // ── Legacy /v3/* redirects ─────────────────────────────────
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

  // ── Ops dashboard auth ──────────────────────────────────────
  if (pathname.startsWith('/ops')) {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      return new NextResponse('Server misconfigured', { status: 500 })
    }

    // Check for token in query param (first visit / bookmark)
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

    // Check cookie
    const cookieToken = request.cookies.get('ops_token')?.value
    if (cookieToken !== cronSecret) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    return NextResponse.next()
  }

  // ── Admin routes — auth checked client-side and in API routes ──
  if (pathname.startsWith('/admin')) {
    return NextResponse.next()
  }

  // ── Invite ref code capture ────────────────────────────────
  // Capture ?ref=XXXXXX into a cookie so we can claim it on signup.
  // Only accept codes matching the 6-char base36 format.
  const ref = request.nextUrl.searchParams.get('ref')

  // ── Geo-country cookie (existing) ───────────────────────────
  const response = NextResponse.next()
  const country = request.headers.get('x-vercel-ip-country') ?? ''
  if (country) {
    response.cookies.set('geo-country', country, {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      maxAge: 86400,
    })
  }

  // Set ref code cookie if valid
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
     * - favicon.ico, manifest.json, icons, sw.js (public assets)
     * - api routes (handled separately)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|manifest\\.json|icons/|sw\\.js|api/).*)',
  ],
}

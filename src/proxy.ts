// src/proxy.ts
// Next.js 16 proxy (formerly middleware.ts)
// Composes pre-i18n auth/redirect logic with next-intl locale routing,
// then decorates the response with geo-country and invite ref cookies.

import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const handleI18nRouting = createMiddleware(routing)

export default function proxy(request: NextRequest) {
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

  // 2b. Legacy `/home?view=tournaments` → `/tournaments`. Eventos was
  // a sub-view of /home for a long time; the bottom-nav reshuffle
  // promoted it to a top-level tab with its own route. Old bookmarks
  // and shared links land here; forward them so they keep working.
  // Locale-aware: covers /home, /es/home, /pt/home, etc.
  const localeStripped = pathname.replace(/^\/(es|pt|it|fr)(?=\/|$)/, '')
  if (
    (localeStripped === '/home' || localeStripped === '/home/') &&
    request.nextUrl.searchParams.get('view') === 'tournaments'
  ) {
    const localePrefix = pathname.slice(0, pathname.length - localeStripped.length)
    const dest = new URL(`${localePrefix}/tournaments`, request.url)
    request.nextUrl.searchParams.forEach((value, key) => {
      if (key !== 'view') dest.searchParams.set(key, value)
    })
    return NextResponse.redirect(dest, 308)
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

    // /ops pages: skip i18n routing (ops is outside [locale])
    return NextResponse.next()
  }

  // 4. Auth routes — outside [locale], skip i18n routing
  if (pathname.startsWith('/auth')) {
    return NextResponse.next()
  }

  // 5. Admin routes — auth checked client-side and in API routes
  if (pathname.startsWith('/admin')) {
    return NextResponse.next()
  }

  // 6. Hidden /x/ preview routes — English-only, skip i18n
  if (pathname.startsWith('/x/')) {
    return NextResponse.next()
  }

  // 7. PadelGod API docs — English-only developer docs, skip i18n routing
  if (pathname === '/padelgodapi' || pathname.startsWith('/padelgodapi/')) {
    return NextResponse.next()
  }

  // 8. Sentry tunnel route — `tunnelRoute: '/monitoring'` in next.config.ts
  // makes the SDK POST events to /monitoring/... so they look like
  // first-party traffic to ad-blockers (uBlock etc. shadow-block direct
  // sentry.io ingest URLs). Without this skip, next-intl wraps the
  // request in /es/monitoring/... and the rewritten path 404s — events
  // never reach Sentry. Discovered 2026-04-25 when the first prod test
  // errors all returned 404 (Not Found) on the tunnel POST.
  if (pathname === '/monitoring' || pathname.startsWith('/monitoring/')) {
    return NextResponse.next()
  }

  // 9. PostHog reverse-proxy route — `/ingest/*` rewrites in next.config.ts
  // proxy to eu.i.posthog.com so the SDK requests look like first-party
  // traffic to ad-blockers. Same i18n-skip story as Sentry's tunnel above.
  if (pathname === '/ingest' || pathname.startsWith('/ingest/')) {
    return NextResponse.next()
  }

  // ── Cookie-wins locale redirect ────────────────────────────────
  //
  // When the user manually picks a language via LocaleSwitcher, we write
  // NEXT_LOCALE and navigate to the new-locale URL. But the browser's
  // history still holds URLs with the OLD locale prefix — so pressing
  // Back reverts the visible language even though the user's preference
  // is now different.
  //
  // Fix: if the request URL has a locale prefix that conflicts with the
  // user's NEXT_LOCALE cookie, 307-redirect to the cookie's locale
  // version of the same path. This makes the user's explicit pick
  // "sticky" across back/forward navigation while still honouring
  // shared links for first-time visitors (who have no cookie yet — URL
  // prefix still wins for them) and for search engines (Googlebot
  // never sends cookies, so URL prefix is authoritative for indexing).
  const cookieLocale = request.cookies.get('NEXT_LOCALE')?.value
  const urlPrefixMatch = pathname.match(/^\/(es|pt|it|fr)(\/|$)/)
  const urlLocale = urlPrefixMatch ? urlPrefixMatch[1] : 'en'
  if (
    cookieLocale &&
    (['en', 'es', 'pt', 'it', 'fr'] as const).includes(cookieLocale as 'en' | 'es' | 'pt' | 'it' | 'fr') &&
    cookieLocale !== urlLocale
  ) {
    // Strip any existing locale prefix and re-prefix with cookieLocale
    // (no prefix for English since localePrefix is 'as-needed').
    const pathWithoutLocale = urlPrefixMatch
      ? pathname.slice(urlPrefixMatch[0].length - 1) || '/'
      : pathname
    const newPath = cookieLocale === 'en'
      ? pathWithoutLocale
      : `/${cookieLocale}${pathWithoutLocale === '/' ? '' : pathWithoutLocale}`
    const target = new URL(newPath, request.url)
    target.search = request.nextUrl.search
    return NextResponse.redirect(target, 307)
  }

  // ── Run next-intl locale routing ───────────────────────────────
  const response = handleI18nRouting(request)

  // ── Post-i18n: decorate response with cookies ──────────────────

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

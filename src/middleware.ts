import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

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
      // Set cookie on both /ops and / paths so it's sent to /api/ops/* too
      response.cookies.set('ops_token', cronSecret, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30, // 30 days
        path: '/',
      })
      // Delete old cookie scoped to /ops (from before this fix)
      response.cookies.delete({ name: 'ops_token', path: '/ops' })
      return response
    }

    // Check cookie
    const cookieToken = request.cookies.get('ops_token')?.value
    if (cookieToken !== cronSecret) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    return NextResponse.next()
  }

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
  return response
}

export const config = {
  matcher: ['/v2/:path*', '/ops/:path*'],
}

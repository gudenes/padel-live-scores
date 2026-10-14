import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { scouterRouteAllowed } from '@/lib/scouting-permissions'

export const proxy = auth((request) => {
  if (/^\/shared\/report\/(?:[A-Za-z0-9_-]{22}|[A-Za-z0-9_-]{43})$/.test(request.nextUrl.pathname) && ['GET','HEAD'].includes(request.method)) return NextResponse.next()
  if (/^\/api\/shared\/report\/(?:[A-Za-z0-9_-]{22}|[A-Za-z0-9_-]{43})\/verify$/.test(request.nextUrl.pathname) && request.method==='POST') return NextResponse.next()
  if (/^\/s\/[A-Za-z0-9_-]{22}$/.test(request.nextUrl.pathname) && ['GET','HEAD'].includes(request.method)) return NextResponse.next()
  const user = request.auth?.user
  if ((user?.isScouter || user?.isViewer) && !user.isOperator) {
    const path = request.nextUrl.pathname.replace(/\/$/, '') || '/'
    if (['/', '/today', '/login'].includes(path) && request.method === 'GET') {
      return NextResponse.redirect(new URL('/scouting', request.url))
    }
    if (!scouterRouteAllowed(path, request.method, !!user.isViewer)) {
      return path.startsWith('/api/')
        ? NextResponse.json({error:'Your role does not allow this action.'},{status:403})
        : new NextResponse('This page requires administrator access.', {status:403})
    }
  }
  return NextResponse.next()
})
export const config = { matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|woff2?)$).*)'] }

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { scouterRouteAllowed } from '@/lib/scouting-permissions'

export const proxy = auth((request) => {
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

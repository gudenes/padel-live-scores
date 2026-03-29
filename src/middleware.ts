import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const response = NextResponse.next()

  // Vercel injects x-vercel-ip-country with the 2-letter ISO country code
  const country = request.headers.get('x-vercel-ip-country') ?? ''
  if (country) {
    response.cookies.set('geo-country', country, {
      path: '/',
      httpOnly: false, // readable by client JS
      sameSite: 'lax',
      maxAge: 86400, // refresh daily
    })
  }

  return response
}

export const config = {
  matcher: ['/v2/:path*'],
}

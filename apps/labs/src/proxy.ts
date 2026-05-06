// apps/labs/src/proxy.ts
// Next.js 16 proxy. Phase 1: minimal — only ensures /app routes are dynamic
// (auth check happens in the (app) layout). Phase 4 adds rate-limiting.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function proxy(_request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
}

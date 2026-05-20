// apps/ops/src/proxy.ts
// Next.js 16 proxy (middleware-equivalent). Phase 1: pass-through.
// Auth gating happens at the (app)/layout.tsx level via await auth().

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function proxy(_request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
}

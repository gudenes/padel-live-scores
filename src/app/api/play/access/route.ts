// GET /api/play/access
//
// Cosmetic-only probe for the bottom nav: should this user see the PLAY tab?
//
// Deliberately returns 200 `{ allowed: false }` rather than a 404 for users
// without access. The nav asks this on every page load, and a 404 here would
// be indistinguishable from "the route is broken" in logs — and would make
// the absence of the feature noisier than its presence.
//
// This is NOT the gate. `src/app/[locale]/(app)/play/layout.tsx` calls
// requirePlayAccess() and 404s; that is the thing that actually protects the
// feature. Anyone can curl this endpoint and learn a boolean about their own
// account, which is not a secret worth keeping.

import { NextResponse } from 'next/server'
import { requirePlayAccess } from '@/lib/play-access'

export const runtime = 'nodejs'
// Per-user answer — must never be cached at the edge or shared between users.
export const dynamic = 'force-dynamic'

export async function GET() {
  const grant = await requirePlayAccess()
  return NextResponse.json(
    { allowed: grant !== null },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

// Public navigation probe. Account APIs independently require authentication.
import { NextResponse } from 'next/server'
import { isPlayEnabled } from '@/lib/play-access'
import { createServiceClient } from '@/lib/supabase'

export const runtime = 'nodejs'
// Per-user answer — must never be cached at the edge or shared between users.
export const dynamic = 'force-dynamic'

export async function GET() {
  const allowed = await isPlayEnabled(createServiceClient())
  return NextResponse.json(
    { allowed },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

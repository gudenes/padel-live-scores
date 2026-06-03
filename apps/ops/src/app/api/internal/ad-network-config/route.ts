// apps/ops/src/app/api/internal/ad-network-config/route.ts
// Read/update the singleton AdSense/AdMob config. Auth: operator session.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

const COLS = 'key, web_enabled, adsense_publisher_id, adsense_slot_id, native_enabled, admob_ios_app_id, admob_android_app_id, admob_banner_unit_id, admob_ios_banner_unit_id, updated_at'

async function requireOperator() {
  const session = await auth()
  return session?.user?.isOperator ? null : NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

export async function GET() {
  const deny = await requireOperator()
  if (deny) return deny
  const supabase = serviceClient()
  const { data, error } = await supabase.from('ad_network_config').select(COLS).eq('key', 'default').maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ config: data })
}

const ALLOWED = [
  'web_enabled', 'adsense_publisher_id', 'adsense_slot_id',
  'native_enabled', 'admob_ios_app_id', 'admob_android_app_id', 'admob_banner_unit_id', 'admob_ios_banner_unit_id',
] as const

export async function PATCH(request: Request) {
  const deny = await requireOperator()
  if (deny) return deny
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const k of ALLOWED) if (k in body) updates[k] = body[k]
  const supabase = serviceClient()
  const { data, error } = await supabase.from('ad_network_config').update(updates).eq('key', 'default').select(COLS).single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ config: data })
}

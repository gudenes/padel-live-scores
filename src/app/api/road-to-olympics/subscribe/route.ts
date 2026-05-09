// src/app/api/road-to-olympics/subscribe/route.ts
//
// POST handler for newsletter signup. Double-opt-in: insert with
// confirm_token + confirmed_at=NULL, send a confirmation email, set
// confirmed_at when the user clicks the link.
//
// Schema: { email: string, locale?: 'en'|'es'|'pt'|'it'|'fr', displayName?: string, country?: string }

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { sendSubscribeConfirmEmail } from '@/lib/road-to-olympics/subscribe-email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_LOCALES = new Set(['en', 'es', 'pt', 'it', 'fr'])

export async function POST(req: NextRequest) {
  let body: { email?: string; locale?: string; displayName?: string; country?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const email = body.email?.trim().toLowerCase().slice(0, 254)
  const locale = (body.locale ?? 'en').trim().toLowerCase()
  const displayName = body.displayName?.trim().slice(0, 80) || null
  const country = body.country?.trim().slice(0, 2).toUpperCase() || null
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 })
  }
  if (!VALID_LOCALES.has(locale)) {
    return NextResponse.json({ error: 'invalid_locale' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  )
  const confirmToken = randomBytes(32).toString('base64url')

  // Upsert: re-subscribing after unsubscribe should reset everything.
  // display_name + country are optional — updates them if provided.
  const { error } = await supabase
    .from('road_to_olympics_subscribers')
    .upsert({
      email,
      locale,
      confirm_token: confirmToken,
      confirmed_at: null,
      unsubscribed_at: null,
      ...(displayName !== null && { display_name: displayName }),
      ...(country !== null && { country }),
    }, { onConflict: 'email' })

  if (error) {
    console.error('[road-to-olympics] subscribe insert failed:', error)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }

  await sendSubscribeConfirmEmail({
    email,
    confirmToken,
    locale: locale as 'en' | 'es' | 'pt' | 'it' | 'fr',
  })

  return NextResponse.json({ ok: true })
}

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { betaSignupsClosed } from '@/lib/beta-schedule'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (betaSignupsClosed()) {
    return NextResponse.json({ error: 'signups_closed' }, { status: 410 })
  }
  const origin = request.headers.get('origin')
  // Railway forwards the public site to an internal host. Keep the canonical
  // public origins explicit instead of trusting arbitrary forwarded headers.
  const allowedOrigins = new Set([
    new URL(request.url).origin, 'https://padelnachos.com', 'https://www.padelnachos.com',
  ])
  if (origin && !allowedOrigins.has(origin)) {
    return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  }

  let body: unknown
  try {
    const raw = await request.text()
    if (raw.length > 4096) return NextResponse.json({ error: 'too_large' }, { status: 413 })
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  }
  const input = body as Record<string, unknown>
  // Quietly discard submissions from the field hidden from real visitors.
  if (input.website) return NextResponse.json({ ok: true })
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  if (!name || name.length > 80 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || typeof input.language !== 'string' || !['en', 'es', 'pt'].includes(input.language)
    || typeof input.locale !== 'string' || !['en', 'es', 'pt'].includes(input.locale)
    || input.commitment !== true || input.contactConsent !== true) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  }

  try {
    const { error } = await createServiceClient().from('prediction_beta_signups').insert({
      name, email, language: input.language, locale: input.locale,
      commitment: true, contact_consent: true, consent_version: '2026-09-25',
    })
    // Identical responses prevent revealing whether an email is already signed up.
    if (error && error.code !== '23505') {
      console.error('[beta-signup] Save failed:', error.code)
      return NextResponse.json({ error: 'save_failed' }, { status: 503 })
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'save_failed' }, { status: 503 })
  }
}

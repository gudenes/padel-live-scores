// src/app/api/road-to-olympics/contact/route.ts
//
// POST handler for the Road to the Olympics corrections / contact form.
// Forwards the message to hello@padelnachos.com via Resend.
//
// Schema: {
//   name?: string,
//   email: string (required),
//   message: string (required),
//   type?: 'correction' | 'information' | 'other',
//   locale?: string,
//   honeypot?: string (must be empty — bots fill it in)
// }
//
// Rate limit: 3 submissions per client IP per hour, in-memory (resets on
// process restart — fine for Soft Launch; Hardening Wave can move to Redis
// or a DB-backed counter).
//
// IPs are used as the rate-limit key only — they're not stored anywhere
// persistent and not included in the email. No salt needed.

import { NextRequest, NextResponse } from 'next/server'
import { sendContactEmail } from '@/lib/road-to-olympics/contact-email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_NAME = 80
const MAX_EMAIL = 254
const MAX_MESSAGE = 4000
const VALID_TYPES = new Set(['correction', 'information', 'other'])
const VALID_LOCALES = new Set(['en', 'es', 'pt', 'it', 'fr'])

// Simple in-memory rate limiter — keyed by client IP, resets each hour.
// For Soft Launch this is enough; switch to Redis/DB in Hardening Wave.
const RATE_LIMIT = 3
const RATE_WINDOW_MS = 60 * 60 * 1000
const submissions = new Map<string, number[]>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const cutoff = now - RATE_WINDOW_MS
  const past = (submissions.get(ip) ?? []).filter(t => t > cutoff)
  if (past.length >= RATE_LIMIT) return true
  past.push(now)
  submissions.set(ip, past)
  return false
}

interface ContactBody {
  name?: string
  email?: string
  message?: string
  type?: string
  locale?: string
  honeypot?: string
}

export async function POST(req: NextRequest) {
  let body: ContactBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  // Honeypot — silently accept (don't tip off the bot)
  if (body.honeypot && body.honeypot.trim().length > 0) {
    return NextResponse.json({ ok: true })
  }

  const name = body.name?.trim().slice(0, MAX_NAME) || null
  const email = body.email?.trim().toLowerCase().slice(0, MAX_EMAIL)
  const message = body.message?.trim().slice(0, MAX_MESSAGE)
  const typeRaw = (body.type ?? 'other').trim().toLowerCase()
  const type = (VALID_TYPES.has(typeRaw) ? typeRaw : 'other') as 'correction' | 'information' | 'other'
  const locale = (body.locale ?? 'en').trim().toLowerCase()
  const safeLocale = VALID_LOCALES.has(locale) ? locale : 'en'

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 })
  }
  if (!message || message.length < 5) {
    return NextResponse.json({ error: 'message_too_short' }, { status: 400 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || '0.0.0.0'

  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  const result = await sendContactEmail({
    visitorName: name,
    visitorEmail: email,
    message,
    type,
    locale: safeLocale,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'server_error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

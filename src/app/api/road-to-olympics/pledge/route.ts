// src/app/api/road-to-olympics/pledge/route.ts
//
// POST handler for the open-letter pledge form.
//
// Schema: { displayName?: string, email?: string, country?: string,
//           subscribed?: boolean }
//
// Anti-abuse: hash the request IP + RTO_IP_SALT and store in ip_hash so we
// can rate-limit later without storing raw IPs. One pledge per email is
// enforced by the partial unique index.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_NAME = 80
const MAX_EMAIL = 254
const MAX_COUNTRY = 2

interface PledgeBody {
  displayName?: string
  email?: string
  country?: string
  subscribed?: boolean
  source?: string
}

function hashIp(ip: string): string {
  const salt = process.env.RTO_IP_SALT ?? 'dev-salt-change-me'
  return createHash('sha256').update(ip + salt).digest('hex')
}

export async function POST(req: NextRequest) {
  let body: PledgeBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const displayName = body.displayName?.trim().slice(0, MAX_NAME) || null
  const email = body.email?.trim().toLowerCase().slice(0, MAX_EMAIL) || null
  const country = body.country?.trim().toUpperCase().slice(0, MAX_COUNTRY) || null
  const subscribed = !!body.subscribed
  const source = body.source?.trim().slice(0, 32) ?? 'hub'

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || '0.0.0.0'
  const ipHash = hashIp(ip)

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  )

  const { error } = await supabase
    .from('road_to_olympics_pledges')
    .insert({
      email,
      display_name: displayName,
      country,
      subscribed,
      source,
      ip_hash: ipHash,
    })

  if (error) {
    if (error.code === '23505') {
      // Duplicate email — treat as success so users don't double-submit
      return NextResponse.json({ ok: true, duplicate: true })
    }
    console.error('[road-to-olympics] pledge insert failed:', error)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

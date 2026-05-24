// src/app/api/feed/suggest-source/route.ts
// Public endpoint for users to suggest a news source URL. Rate-limited
// to 3/day per IP. Inserts into news_source_suggestions with status='pending'.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import crypto from 'crypto'
import { detectSource } from '@/lib/source-detector-public'

export const dynamic = 'force-dynamic'

const RATE_LIMIT_PER_DAY = 3

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    url?: string
    note?: string
    suggested_by_email?: string
  }
  const url = (body.url ?? '').trim()
  if (!url || !/^https?:\/\/.+/.test(url) || url.length > 500) {
    return NextResponse.json({ error: 'invalid_url' }, { status: 400 })
  }
  const note = (body.note ?? '').slice(0, 500)
  const email = (body.suggested_by_email ?? '').trim().slice(0, 200) || null

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0'
  const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32)

  const supabase = createServerClient()

  // Rate limit: count submissions from this IP in last 24h
  const since = new Date(Date.now() - 86400_000).toISOString()
  const { count, error: countErr } = await supabase
    .from('news_source_suggestions')
    .select('id', { count: 'exact', head: true })
    .eq('suggested_by_ip', ipHash)
    .gte('created_at', since)
  if (countErr) return NextResponse.json({ error: 'rate_check_failed' }, { status: 500 })
  if ((count ?? 0) >= RATE_LIMIT_PER_DAY) {
    return NextResponse.json({ error: 'rate_limited', retry_after_hours: 24 }, { status: 429 })
  }

  // Duplicate check
  const { data: existing } = await supabase
    .from('news_sources')
    .select('id')
    .eq('url', url)
    .maybeSingle()
  const initialStatus: 'pending' | 'duplicate' = existing ? 'duplicate' : 'pending'

  // NEW: run detector synchronously (non-fatal — fall through on failure)
  let detected: { type: string; name?: string; language?: string; sample: unknown[]; notes?: string } = {
    type: 'unknown', sample: [],
  }
  try {
    detected = await detectSource(url)
  } catch {
    // detector failure is non-fatal — fall through with 'unknown'
  }

  const { error } = await supabase.from('news_source_suggestions').insert({
    url,
    note,
    suggested_by_email: email,
    suggested_by_ip: ipHash,
    status: initialStatus,
    submitted_by_kind: 'user',
    detected_type: detected.type,
    detected_payload: { name: detected.name, language: detected.language, sample: detected.sample, notes: detected.notes },
  })
  if (error) return NextResponse.json({ error: 'insert_failed' }, { status: 500 })

  // Non-blocking observability event
  void supabase.from('ops_events').insert({
    source: 'feed.suggest_source.received',
    status: 'ok',
    meta: { url, has_email: !!email, detected_type: detected.type, suggestion_status: initialStatus },
  })

  return NextResponse.json({
    ok: true,
    status: initialStatus,
    detected: { type: detected.type, name: detected.name },
  })
}

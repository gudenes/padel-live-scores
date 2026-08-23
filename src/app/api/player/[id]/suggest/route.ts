// src/app/api/player/[id]/suggest/route.ts
// Public endpoint: submit suggested corrections to a player's profile.
// Anonymous-friendly; attaches the logged-in user if present. Rate-limited
// to 5/day per IP hash. Honeypot + whitelist + length caps. Inserts a
// pending row into player_suggestions for ops review.

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createServerClient } from '@/lib/supabase'
import { auth } from '@/auth'
import { sanitizeChanges, sanitizeComment } from '@/lib/player-suggestion-fields'
import { getClientIp } from '@/lib/client-ip'

export const dynamic = 'force-dynamic'

const RATE_LIMIT_PER_DAY = 5

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: playerId } = await params

  const body = (await req.json().catch(() => ({}))) as {
    changes?: unknown
    comment?: unknown
    hp?: unknown // honeypot
  }

  // Honeypot: bots fill the hidden field. Silently accept, do nothing.
  if (typeof body.hp === 'string' && body.hp.trim() !== '') {
    return NextResponse.json({ ok: true })
  }

  const changes = sanitizeChanges(body.changes)
  const comment = sanitizeComment(body.comment)
  if (changes.length === 0 && !comment) {
    return NextResponse.json({ error: 'empty' }, { status: 400 })
  }

  const supabase = createServerClient()

  // Validate the player exists + snapshot the display name.
  const { data: player, error: playerErr } = await supabase
    .from('players')
    .select('id, name, display_name')
    .eq('id', playerId)
    .maybeSingle()
  if (playerErr) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  if (!player) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Rate limit by IP hash. getClientIp() prefers Cloudflare's
  // `cf-connecting-ip` — reading `x-forwarded-for[0]` directly would let a
  // caller spoof a fresh IP per request and walk straight past this limit.
  const ip = getClientIp(req.headers) ?? '0.0.0.0'
  const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32)
  const since = new Date(Date.now() - 86400_000).toISOString()
  const { count, error: countErr } = await supabase
    .from('player_suggestions')
    .select('id', { count: 'exact', head: true })
    .eq('submitted_by_ip', ipHash)
    .gte('created_at', since)
  if (countErr) return NextResponse.json({ error: 'rate_check_failed' }, { status: 500 })
  if ((count ?? 0) >= RATE_LIMIT_PER_DAY) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  // Attach the logged-in user if there's a session (never required).
  let userId: string | null = null
  let userEmail: string | null = null
  try {
    const session = await auth()
    userId = session?.user?.id ?? null
    userEmail = session?.user?.email ?? null
  } catch {
    // no session — stay anonymous
  }

  const { error: insertErr } = await supabase.from('player_suggestions').insert({
    player_id: playerId,
    player_name: player.display_name?.trim() || player.name,
    changes,
    comment,
    submitted_by_user_id: userId,
    submitted_by_email: userEmail,
    submitted_by_ip: ipHash,
    status: 'pending',
  })
  if (insertErr) return NextResponse.json({ error: 'insert_failed' }, { status: 500 })

  return NextResponse.json({ ok: true })
}

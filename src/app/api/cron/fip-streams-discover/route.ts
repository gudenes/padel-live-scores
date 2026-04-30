// src/app/api/cron/fip-streams-discover/route.ts
//
// Discovers FIP YouTube livestreams + replays by scanning the FIP
// channel's uploads playlist every 15 min. Cheap: ~2 quota units/run.
//
// Spec: docs/superpowers/specs/2026-04-30-fip-youtube-streams-design.md
// Schedule: */15 * * * * (every 15 minutes), see vercel.json

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { logOpsEvent } from '@/lib/ops-logger'
import { FIP_UPLOADS_PLAYLIST_ID } from '@/lib/fip-channel'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  // Auth — same pattern as other crons.
  const authHeader = request.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    return NextResponse.json({ ok: true, skipped: 'no_api_key' })
  }

  try {
    const meta = await logOpsEvent('cron:fip-streams-discover', async () => {
      const supabase = createServerClient()

      // Tournament-aware short-circuit: only run if at least one FIP-tier
      // tournament is currently active or ended in the last 7 days.
      const { data: activeRow } = await supabase
        .from('tournaments')
        .select('id')
        .in('level', ['fip_bronze', 'fip_silver', 'fip_gold', 'fip_platinum', 'fip_promises', 'fip_other'])
        .lte('starts_at', new Date().toISOString())
        .gte('ends_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .limit(1)
        .maybeSingle()

      if (!activeRow) {
        return { ok: true, skipped: 'no_active_tournament' }
      }

      // Filled in by Task 6.
      void FIP_UPLOADS_PLAYLIST_ID // referenced by Task 6; suppress unused-import lint
      return { ok: true, skipped: null, scanned: 0, newly_matched: 0, newly_unresolved: 0, open_unresolved_total: 0, state_transitions: {}, ms: 0 }
    })
    return NextResponse.json(meta)
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

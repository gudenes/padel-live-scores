// src/app/api/admin/backfill-fip-covers/route.ts
// One-shot backfill: for every FIP-sourced tournament with a null
// cover_image_url AND a populated slug, hit padelfip.com's WP API with
// ?_embed=true and write the embedded featured-media URL to
// tournaments.cover_image_url.
//
// This is the bridge between "padelgod's discovery worker now writes
// covers on new runs" and "existing rows still have null covers"
// — needed once after the parser/worker change ships, then padelgod's
// hourly discovery pass keeps everything current.
//
// Ops manual uploads through /api/ops/tournaments/[id]/cover are NOT
// touched (we only write when existing cover_image_url is null).

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const maxDuration = 60

const FIP_WP_EVENTS = 'https://www.padelfip.com/wp-json/wp/v2/events'

interface RawEmbeddedMedia {
  source_url?: string
}
interface RawEvent {
  slug?: string
  _embedded?: {
    'wp:featuredmedia'?: RawEmbeddedMedia[]
  }
}

function extractSourceUrl(events: unknown): string | null {
  if (!Array.isArray(events) || events.length === 0) return null
  const e = events[0] as RawEvent
  const url = e._embedded?.['wp:featuredmedia']?.[0]?.source_url
  return typeof url === 'string' && url.length > 0 ? url : null
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()

  const url = new URL(req.url)
  const limitParam = url.searchParams.get('limit')
  const limit = limitParam ? Math.max(1, Math.min(500, Number(limitParam))) : 50

  // Candidates: FIP-sourced rows with a slug and no cover yet. Use slug
  // (the canonical FIP id) for the WP API lookup; fall back to fip_id
  // stripped of its `fip-` prefix when slug is null (shouldn't happen
  // post-padelgod but cheap insurance).
  const { data: rows, error: selectError } = await supabase
    .from('tournaments')
    .select('id, slug, fip_id, name')
    .eq('source', 'fip')
    .is('cover_image_url', null)
    .not('slug', 'is', null)
    .order('starts_at', { ascending: false })
    .limit(limit)

  if (selectError) {
    return NextResponse.json(
      { error: 'select_failed', detail: selectError.message },
      { status: 500 },
    )
  }

  const updated: Array<{ id: string; slug: string; url: string }> = []
  const skipped: Array<{ id: string; slug: string; reason: string }> = []
  const errors: Array<{ id: string; slug: string; detail: string }> = []

  for (const row of rows ?? []) {
    const slug = row.slug as string | null
    if (!slug) {
      skipped.push({ id: row.id, slug: '', reason: 'no_slug' })
      continue
    }
    try {
      const res = await fetch(
        `${FIP_WP_EVENTS}?slug=${encodeURIComponent(slug)}&_embed=true`,
        { headers: { 'User-Agent': 'PadelNachos/1.0 (backfill)' } },
      )
      if (!res.ok) {
        errors.push({ id: row.id, slug, detail: `http_${res.status}` })
        continue
      }
      const sourceUrl = extractSourceUrl(await res.json())
      if (!sourceUrl) {
        skipped.push({ id: row.id, slug, reason: 'no_featured_media' })
        continue
      }
      const { error: updateError } = await supabase
        .from('tournaments')
        .update({ cover_image_url: sourceUrl })
        .eq('id', row.id)
      if (updateError) {
        errors.push({ id: row.id, slug, detail: updateError.message })
        continue
      }
      updated.push({ id: row.id, slug, url: sourceUrl })
    } catch (e) {
      errors.push({
        id: row.id,
        slug,
        detail: e instanceof Error ? e.message : String(e),
      })
    }
    // Polite throttle. padelfip.com's CDN is fine, but a serial loop
    // of 50 fetches at <50ms apart looks like burst traffic — same
    // 250ms cadence padelgod uses in fip-event-page-enricher.
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  return NextResponse.json({
    candidates: rows?.length ?? 0,
    updated_count: updated.length,
    skipped_count: skipped.length,
    error_count: errors.length,
    updated,
    skipped,
    errors,
  })
}

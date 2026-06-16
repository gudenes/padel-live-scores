// src/app/api/ads/preview/route.ts
// Public read of a SINGLE banner by id, WITHOUT the active filter — powers the
// shareable ?ad_preview=<id> link so an operator can show a not-yet-live banner
// to reviewers for sign-off. Distinct from /api/ads/active, which hard-filters
// active=true and is aggressively cached for every visitor.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import type { AdBanner } from '@/lib/ad-banner-resolver'

/** Pull a usable banner id from ?id=. Returns null when absent / blank. */
export function parsePreviewId(raw: string | null): string | null {
  const id = (raw ?? '').trim()
  return id || null
}

export async function GET(req: NextRequest) {
  const id = parsePreviewId(req.nextUrl.searchParams.get('id'))
  if (!id) return NextResponse.json({ banner: null })

  const supabase = createServerClient()
  try {
    const { data } = await supabase
      .from('ad_banners')
      .select('id, name, country_codes, slot, image_url, click_url, active, weight')
      .eq('id', id)
      .maybeSingle()
    return NextResponse.json(
      { banner: (data ?? null) as AdBanner | null },
      // Per-id and used rarely; do not cache like /active.
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    // Degrade to "no banner" rather than erroring the caller.
    return NextResponse.json({ banner: null })
  }
}

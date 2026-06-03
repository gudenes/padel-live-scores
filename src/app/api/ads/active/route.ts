// src/app/api/ads/active/route.ts
// Public, cached read of active banners for a slot + the global network config.
// Country-agnostic so one cached response serves every visitor; the client
// picks the banner for its country via pickBanner().

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import type { AdBanner, AdNetworkConfig } from '@/lib/ad-banner-resolver'

export async function GET(req: NextRequest) {
  const slot = req.nextUrl.searchParams.get('slot') ?? 'sticky-bottom'
  const supabase = createServerClient()

  try {
    const [{ data: banners }, { data: network }] = await Promise.all([
      supabase
        .from('ad_banners')
        .select('id, name, country_codes, slot, image_url, click_url, active, weight')
        .eq('slot', slot)
        .eq('active', true),
      supabase
        .from('ad_network_config')
        .select('web_enabled, adsense_publisher_id, adsense_slot_id, native_enabled, admob_ios_app_id, admob_android_app_id, admob_banner_unit_id')
        .eq('key', 'default')
        .maybeSingle(),
    ])

    return NextResponse.json(
      { banners: (banners ?? []) as AdBanner[], network: (network ?? null) as AdNetworkConfig | null },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } },
    )
  } catch {
    // Degrade to "no ad" rather than erroring the caller.
    return NextResponse.json({ banners: [], network: null })
  }
}

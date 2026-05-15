// src/lib/where-to-watch/fetch-broadcasters.ts
//
// Server-side query for broadcasters rows the popup will display.
// Filtered server-side by country to keep the payload tiny.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BroadcasterRow } from './group-builder'

export async function fetchBroadcastersForCountry(
  supabase: SupabaseClient,
  country: string | null,
): Promise<BroadcasterRow[]> {
  if (!country) return []
  const { data, error } = await supabase
    .from('broadcasters')
    .select('id, name, url, logo_url, is_free, display_order, country_iso2, channel_id')
    .eq('country_iso2', country)
    .eq('active', true)
    .not('channel_id', 'is', null)
    .order('display_order', { ascending: true })
    .order('is_free', { ascending: false })
  if (error) {
    console.error('[fetchBroadcastersForCountry] query failed:', error.message)
    return []
  }
  return (data ?? []) as BroadcasterRow[]
}

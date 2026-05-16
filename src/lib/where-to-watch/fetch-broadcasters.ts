// src/lib/where-to-watch/fetch-broadcasters.ts
//
// Server-side queries that feed the Where-to-Watch popup.
//   - fetchActiveBroadcasters: all classified, active broadcaster rows.
//     Returns ~400 rows (broadcasters across all countries) — small
//     enough to ship to the client whole so the region picker can swap
//     countries without a round-trip. buildGroups filters by effective
//     country at render time.
//   - fetchChannelsMeta: active YouTube channel metadata (small table,
//     ~2 rows today). Used by buildGroups to seed groups for channels
//     that aren't currently live but have broadcasters or matches today.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BroadcasterRow, ChannelMeta } from './group-builder'

export async function fetchActiveBroadcasters(
  supabase: SupabaseClient,
): Promise<BroadcasterRow[]> {
  const { data, error } = await supabase
    .from('broadcasters')
    .select('id, name, url, logo_url, is_free, display_order, country_iso2, channel_id')
    .eq('active', true)
    .not('channel_id', 'is', null)
    .order('country_iso2', { ascending: true })
    .order('display_order', { ascending: true })
    .order('is_free', { ascending: false })
  if (error) {
    console.error('[fetchActiveBroadcasters] query failed:', error.message)
    return []
  }
  return (data ?? []) as BroadcasterRow[]
}

export async function fetchChannelsMeta(
  supabase: SupabaseClient,
): Promise<ChannelMeta[]> {
  const { data, error } = await supabase
    .from('youtube_channels')
    .select('id, name, abbreviation, color_hex, display_order')
    .eq('is_active', true)
    .order('display_order', { ascending: true })
  if (error) {
    console.error('[fetchChannelsMeta] query failed:', error.message)
    return []
  }
  return (data ?? []).map(r => ({
    id: r.id as string,
    name: r.name as string,
    abbreviation: r.abbreviation as string,
    colorHex: r.color_hex as string,
    displayOrder: r.display_order as number,
  }))
}

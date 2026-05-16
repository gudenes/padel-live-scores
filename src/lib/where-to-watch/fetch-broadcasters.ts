// src/lib/where-to-watch/fetch-broadcasters.ts
//
// Server-side queries that feed the Where-to-Watch popup.
//   - fetchBroadcastersForCountry: country-scoped broadcaster rows
//   - fetchChannelsMeta: active YouTube channel metadata (small table,
//     ~2 rows today). Used by buildGroups to seed groups for channels
//     that aren't currently live but have broadcasters or matches today.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BroadcasterRow, ChannelMeta } from './group-builder'

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

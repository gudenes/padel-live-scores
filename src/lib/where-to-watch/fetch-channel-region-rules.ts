import type { SupabaseClient } from '@supabase/supabase-js'

export interface ChannelRegionBlock {
  channelId: string
  countryIso2: string
}

/** Fetch all active block rules. Small bounded table (channels × countries),
 *  safe to fetch whole and ship to the client for region swaps. */
export async function fetchChannelRegionBlocks(
  supabase: SupabaseClient,
): Promise<ChannelRegionBlock[]> {
  const { data, error } = await supabase
    .from('channel_region_rules')
    .select('channel_id, country_iso2')
    .eq('effect', 'block')
  if (error || !data) return []
  return data.map(r => ({
    channelId: r.channel_id as string,
    countryIso2: (r.country_iso2 as string).toLowerCase(),
  }))
}

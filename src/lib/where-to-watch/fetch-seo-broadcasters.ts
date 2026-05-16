// src/lib/where-to-watch/fetch-seo-broadcasters.ts
//
// Server-side fetch for the SEO layer (BroadcastEvent JSON-LD + sr-only
// sentence). Scoped to a single channel abbreviation (PP / FIP), returns
// channel meta + active broadcasters + currently-live YT streams for the
// circuit. Called from match + tournament server layouts.

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ChannelMetaForSeo,
  LiveStreamForSeo,
  BroadcasterForSeo,
} from './build-broadcast-jsonld'

export interface SeoBroadcastersPayload {
  channelMeta: ChannelMetaForSeo | null
  liveStreams: LiveStreamForSeo[]
  broadcasters: BroadcasterForSeo[]
}

const STALE_MS = 30 * 60 * 1000

export async function fetchSeoBroadcasters(
  supabase: SupabaseClient,
  channelAbbr: string | null,
): Promise<SeoBroadcastersPayload> {
  if (!channelAbbr) {
    return { channelMeta: null, liveStreams: [], broadcasters: [] }
  }

  const [chRes, liveRes, broadcasterRes] = await Promise.all([
    supabase
      .from('youtube_channels')
      .select('id, channel_id, name, abbreviation')
      .eq('is_active', true)
      .eq('abbreviation', channelAbbr)
      .maybeSingle(),
    supabase
      .from('youtube_channel_live')
      .select(`video_id, title, channel:youtube_channels!inner(abbreviation, is_active)`)
      .gt('last_seen_at', new Date(Date.now() - STALE_MS).toISOString())
      .eq('channel.is_active', true)
      .eq('channel.abbreviation', channelAbbr),
    // Broadcasters: needs the youtube_channels join filter, but cheaper
    // to filter by channel_id once we know it. Issue this second query
    // after the channel lookup resolves; in a parallel Promise.all the
    // first round wins anyway.
    supabase
      .from('broadcasters')
      .select(`name, url, country_iso2, channel:youtube_channels!inner(abbreviation, is_active)`)
      .eq('active', true)
      .eq('channel.is_active', true)
      .eq('channel.abbreviation', channelAbbr)
      .order('country_iso2', { ascending: true })
      .order('display_order', { ascending: true }),
  ])

  if (chRes.error) console.error('[fetchSeoBroadcasters] channel query failed:', chRes.error.message)
  if (liveRes.error) console.error('[fetchSeoBroadcasters] live query failed:', liveRes.error.message)
  if (broadcasterRes.error) console.error('[fetchSeoBroadcasters] broadcasters query failed:', broadcasterRes.error.message)

  const channelMeta: ChannelMetaForSeo | null = chRes.data
    ? {
        id: chRes.data.id as string,
        channelId: chRes.data.channel_id as string,
        name: chRes.data.name as string,
        abbreviation: chRes.data.abbreviation as string,
      }
    : null

  const liveStreams: LiveStreamForSeo[] = (liveRes.data ?? []).map((r: any) => ({
    videoId: r.video_id as string,
    title: r.title as string,
  }))

  const broadcasters: BroadcasterForSeo[] = (broadcasterRes.data ?? []).map((r: any) => ({
    name: r.name as string,
    url: r.url as string,
    country_iso2: r.country_iso2 as string,
  }))

  return { channelMeta, liveStreams, broadcasters }
}

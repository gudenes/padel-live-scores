//
// Pure data shape: given the inputs the Where-to-Watch popup has at hand,
// return the channel groups it should render, in display order. Empty
// groups are filtered out so the caller can render the result blindly.

export interface LiveChannel {
  videoId: string
  title: string
  channel: {
    id: string
    name: string
    abbreviation: string
    colorHex: string
    displayOrder: number
  }
}

export interface BroadcasterRow {
  id: string
  name: string
  url: string
  logo_url: string | null
  is_free: boolean
  display_order: number
  country_iso2: string
  channel_id: string | null
}

export interface ChannelGroup {
  channelId: string
  channelName: string
  abbreviation: string
  colorHex: string
  displayOrder: number
  hasLive: boolean
  liveStreams: Array<{ videoId: string; title: string }>
  broadcasters: Array<{
    id: string
    name: string
    logoUrl: string | null
    url: string
    isFree: boolean
  }>
}

export interface BuildGroupsInput {
  liveChannels: LiveChannel[]
  broadcasters: BroadcasterRow[]
  todayCircuits: Set<string>  // set of channel abbreviations
  country: string | null
}

export function buildGroups(input: BuildGroupsInput): ChannelGroup[] {
  const { liveChannels, broadcasters, todayCircuits, country } = input

  // Index 1: channel metadata, keyed by channel id. Sourced from live
  // channels first (their `channel` payload is the authoritative meta).
  const channelMetaById = new Map<string, ChannelGroup>()
  for (const lc of liveChannels) {
    if (!channelMetaById.has(lc.channel.id)) {
      channelMetaById.set(lc.channel.id, {
        channelId: lc.channel.id,
        channelName: lc.channel.name,
        abbreviation: lc.channel.abbreviation,
        colorHex: lc.channel.colorHex,
        displayOrder: lc.channel.displayOrder,
        hasLive: false,
        liveStreams: [],
        broadcasters: [],
      })
    }
  }

  // Index 2: attach live streams
  for (const lc of liveChannels) {
    const g = channelMetaById.get(lc.channel.id)!
    g.hasLive = true
    g.liveStreams.push({ videoId: lc.videoId, title: lc.title })
  }

  // Index 3: attach broadcasters. Filter rules:
  //   - country must match (caller usually pre-filters, but defensive)
  //   - channel_id must be set (NULL = unclassified, do not render)
  //   - country must be non-null
  if (country) {
    for (const b of broadcasters) {
      if (!b.channel_id) continue
      if (b.country_iso2 !== country) continue
      const g = channelMetaById.get(b.channel_id)
      if (!g) continue  // broadcaster references a channel we don't have metadata for
      g.broadcasters.push({
        id: b.id,
        name: b.name,
        logoUrl: b.logo_url,
        url: b.url,
        isFree: b.is_free,
      })
    }
  }

  // Sort broadcasters within each group: free first, then display_order
  for (const g of channelMetaById.values()) {
    g.broadcasters.sort((a, b) => {
      if (a.isFree !== b.isFree) return a.isFree ? -1 : 1
      return 0  // input is already pre-sorted by display_order
    })
  }

  // Drop empty groups: no live AND no broadcasters AND circuit not in today
  // (we can't render a group with no content)
  const result: ChannelGroup[] = []
  for (const g of channelMetaById.values()) {
    const hasContent = g.hasLive || g.broadcasters.length > 0
    if (!hasContent) continue
    // If a group has ONLY broadcasters (no live), require its circuit
    // to be in today's set — otherwise the user is seeing "watch X on
    // Movistar" with no relevant match.
    if (!g.hasLive && !todayCircuits.has(g.abbreviation)) continue
    result.push(g)
  }

  // Final sort: by displayOrder ascending
  result.sort((a, b) => a.displayOrder - b.displayOrder)
  return result
}

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

export interface ChannelMeta {
  id: string
  name: string
  abbreviation: string
  colorHex: string
  displayOrder: number
}

export interface BuildGroupsInput {
  liveChannels: LiveChannel[]
  broadcasters: BroadcasterRow[]
  todayCircuits: Set<string>  // set of channel abbreviations
  country: string | null
  /** All tracked YouTube channels (active or not). Used to seed the
   *  group metadata so broadcaster-only groups (channel not currently
   *  live but its circuit has matches today) can still render with the
   *  channel's name/color/abbreviation. Optional — when omitted the
   *  builder falls back to sourcing metadata only from `liveChannels`. */
  channelsMeta?: ChannelMeta[]
  /** Block rules: a channel's live YouTube stream is geo-blocked in these
   *  countries. When the viewer's country matches, the channel's live
   *  streams are dropped (existing broadcasters still surface). Optional —
   *  omit for no geo-blocking. */
  channelRegionBlocks?: Array<{ channelId: string; countryIso2: string }>
}

export function buildGroups(input: BuildGroupsInput): ChannelGroup[] {
  const { liveChannels, broadcasters, todayCircuits, country, channelsMeta = [], channelRegionBlocks = [] } = input

  // Index 1: channel metadata, keyed by channel id. Sourced from
  // `channelsMeta` first (covers dormant channels) then live channels —
  // the latter overwrites if a channel appears in both, since the live
  // payload is freshest. This makes broadcaster-only groups possible.
  const channelMetaById = new Map<string, ChannelGroup>()
  for (const cm of channelsMeta) {
    channelMetaById.set(cm.id, {
      channelId: cm.id,
      channelName: cm.name,
      abbreviation: cm.abbreviation,
      colorHex: cm.colorHex,
      displayOrder: cm.displayOrder,
      hasLive: false,
      liveStreams: [],
      broadcasters: [],
    })
  }
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

  // Index 2: attach live streams — skipping channels blocked in this country.
  const blockedChannelIds = new Set(
    channelRegionBlocks.filter(r => r.countryIso2 === country).map(r => r.channelId),
  )
  for (const lc of liveChannels) {
    if (blockedChannelIds.has(lc.channel.id)) continue
    const g = channelMetaById.get(lc.channel.id)!
    g.hasLive = true
    g.liveStreams.push({ videoId: lc.videoId, title: lc.title })
  }

  // Index 3: attach broadcasters. Filter rules:
  //   - country must match (caller usually pre-filters, but defensive)
  //   - channel_id must be set (NULL = unclassified, do not render)
  //   - country must be non-null
  //   - channel meta must exist in our map (otherwise the broadcaster
  //     references a channel we don't know about; skip rather than
  //     render a group with no name/color)
  if (country) {
    for (const b of broadcasters) {
      if (!b.channel_id) continue
      if (b.country_iso2 !== country) continue
      const g = channelMetaById.get(b.channel_id)
      if (!g) continue
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

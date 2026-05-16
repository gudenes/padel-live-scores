import { describe, it, expect } from 'vitest'
import { buildGroups, type LiveChannel, type BroadcasterRow } from '@/lib/where-to-watch/group-builder'

const PP_CHANNEL_ID = '11111111-1111-1111-1111-111111111111'
const FIP_CHANNEL_ID = '22222222-2222-2222-2222-222222222222'

const ppChannelMeta = {
  id: PP_CHANNEL_ID, name: 'Premier Padel', abbreviation: 'PP',
  colorHex: '#FF0000', displayOrder: 10,
}
const fipChannelMeta = {
  id: FIP_CHANNEL_ID, name: 'FIP Tour', abbreviation: 'FIP',
  colorHex: '#1657A0', displayOrder: 20,
}

const movistar: BroadcasterRow = {
  id: 'b1', name: 'Movistar Plus+', url: 'https://movistar.es',
  logo_url: null, is_free: false, display_order: 100,
  country_iso2: 'es', channel_id: PP_CHANNEL_ID,
}
const redBull: BroadcasterRow = {
  id: 'b2', name: 'Red Bull TV', url: 'https://redbull.tv',
  logo_url: null, is_free: true, display_order: 50,
  country_iso2: 'es', channel_id: PP_CHANNEL_ID,
}

const ppLive: LiveChannel = {
  videoId: 'vid1', title: 'BA P1 Centre Court', channel: ppChannelMeta,
}
const fipLive: LiveChannel = {
  videoId: 'vid2', title: 'Cyprus Bronze SF', channel: fipChannelMeta,
}

describe('buildGroups', () => {
  it('returns empty array when there is nothing to show', () => {
    const groups = buildGroups({
      liveChannels: [],
      broadcasters: [],
      todayCircuits: new Set(),
      country: 'es',
    })
    expect(groups).toEqual([])
  })

  it('renders a YT-only group when no broadcasters available', () => {
    const groups = buildGroups({
      liveChannels: [ppLive],
      broadcasters: [],
      todayCircuits: new Set(['PP']),
      country: null,
    })
    expect(groups).toHaveLength(1)
    expect(groups[0].channelId).toBe(PP_CHANNEL_ID)
    expect(groups[0].hasLive).toBe(true)
    expect(groups[0].liveStreams).toHaveLength(1)
    expect(groups[0].broadcasters).toHaveLength(0)
  })

  it('nests broadcasters under the matching channel', () => {
    const groups = buildGroups({
      liveChannels: [ppLive],
      broadcasters: [movistar, redBull],
      todayCircuits: new Set(['PP']),
      country: 'es',
    })
    expect(groups).toHaveLength(1)
    expect(groups[0].liveStreams).toHaveLength(1)
    // Free first, by display_order ascending
    expect(groups[0].broadcasters.map(b => b.id)).toEqual(['b2', 'b1'])
  })

  it('skips broadcaster-only groups when channelsMeta is omitted', () => {
    // Without dormant channel metadata, broadcaster-only groups can't
    // render — the builder has no name/color/abbreviation to attach to
    // the broadcasters. This is the "callers should pass channelsMeta"
    // contract; the page Server Component now does so.
    const groups = buildGroups({
      liveChannels: [],
      broadcasters: [movistar, redBull],
      todayCircuits: new Set(['PP']),
      country: 'es',
    })
    expect(groups).toEqual([])
  })

  it('renders broadcaster-only group when channelsMeta provides the channel', () => {
    const groups = buildGroups({
      liveChannels: [],
      broadcasters: [movistar, redBull],
      todayCircuits: new Set(['PP']),
      country: 'es',
      channelsMeta: [
        { id: PP_CHANNEL_ID, name: 'Premier Padel', abbreviation: 'PP', colorHex: '#FF0000', displayOrder: 10 },
      ],
    })
    expect(groups).toHaveLength(1)
    expect(groups[0].channelId).toBe(PP_CHANNEL_ID)
    expect(groups[0].hasLive).toBe(false)
    expect(groups[0].liveStreams).toHaveLength(0)
    // Free first (Red Bull) then paid (Movistar)
    expect(groups[0].broadcasters.map(b => b.id)).toEqual(['b2', 'b1'])
  })

  it('still omits a broadcaster-only group when its circuit has no matches today (even with channelsMeta)', () => {
    const groups = buildGroups({
      liveChannels: [],
      broadcasters: [movistar, redBull],
      todayCircuits: new Set(['FIP']), // PP not in today
      country: 'es',
      channelsMeta: [
        { id: PP_CHANNEL_ID, name: 'Premier Padel', abbreviation: 'PP', colorHex: '#FF0000', displayOrder: 10 },
      ],
    })
    expect(groups).toEqual([])
  })

  it('omits dormant channel-meta entries that have nothing to show', () => {
    // Providing channelsMeta for a channel with no live + no broadcasters
    // + circuit not in today → should NOT render an empty group.
    const groups = buildGroups({
      liveChannels: [],
      broadcasters: [],
      todayCircuits: new Set(),
      country: 'es',
      channelsMeta: [
        { id: PP_CHANNEL_ID, name: 'Premier Padel', abbreviation: 'PP', colorHex: '#FF0000', displayOrder: 10 },
        { id: FIP_CHANNEL_ID, name: 'FIP Tour', abbreviation: 'FIP', colorHex: '#1657A0', displayOrder: 20 },
      ],
    })
    expect(groups).toEqual([])
  })

  it('omits a broadcaster-only group when its circuit has no matches today', () => {
    const groups = buildGroups({
      liveChannels: [],
      broadcasters: [movistar, redBull],
      todayCircuits: new Set(['FIP']), // PP not in today
      country: 'es',
    })
    expect(groups).toEqual([])
  })

  it('keeps YT-live groups regardless of todayCircuits', () => {
    // FIP live but no FIP-tier match on the page → still show it
    const groups = buildGroups({
      liveChannels: [fipLive],
      broadcasters: [],
      todayCircuits: new Set(['PP']),
      country: 'es',
    })
    expect(groups).toHaveLength(1)
    expect(groups[0].channelId).toBe(FIP_CHANNEL_ID)
  })

  it('renders multiple groups sorted by displayOrder', () => {
    const groups = buildGroups({
      liveChannels: [fipLive, ppLive], // intentionally out of order
      broadcasters: [movistar, redBull],
      todayCircuits: new Set(['PP', 'FIP']),
      country: 'es',
    })
    expect(groups.map(g => g.abbreviation)).toEqual(['PP', 'FIP']) // PP=10, FIP=20
    expect(groups[0].broadcasters).toHaveLength(2) // PP gets the broadcasters
    expect(groups[1].broadcasters).toHaveLength(0) // FIP has none
  })

  it('skips broadcasters with NULL channel_id', () => {
    const orphan: BroadcasterRow = { ...movistar, id: 'b3', channel_id: null }
    const groups = buildGroups({
      liveChannels: [ppLive],
      broadcasters: [orphan],
      todayCircuits: new Set(['PP']),
      country: 'es',
    })
    expect(groups[0].broadcasters).toHaveLength(0)
  })

  it('returns empty when country is null and no live channels', () => {
    const groups = buildGroups({
      liveChannels: [],
      broadcasters: [movistar],
      todayCircuits: new Set(['PP']),
      country: null,
    })
    // No country → no broadcaster section (the broadcaster row is filtered out by country mismatch upstream too, but defensive)
    expect(groups).toEqual([])
  })
})

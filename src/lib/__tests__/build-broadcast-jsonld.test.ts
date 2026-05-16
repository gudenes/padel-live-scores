import { describe, it, expect } from 'vitest'
import { buildBroadcastJsonLd, type ChannelMetaForSeo, type LiveStreamForSeo, type BroadcasterForSeo } from '@/lib/where-to-watch/build-broadcast-jsonld'

const ppChannel: ChannelMetaForSeo = {
  id: 'uuid-pp',
  channelId: 'UCK59dYVs3Wgwoe73nDTH6jw',
  name: 'Premier Padel',
  abbreviation: 'PP',
}

const movistar: BroadcasterForSeo = {
  name: 'Movistar Plus+',
  url: 'https://www.movistarplus.es/deportes',
  country_iso2: 'es',
}
const redBullEs: BroadcasterForSeo = {
  name: 'Red Bull TV',
  url: 'https://www.redbull.com/tv',
  country_iso2: 'es',
}
const redBullIt: BroadcasterForSeo = { ...redBullEs, country_iso2: 'it' }

const ppLiveStream: LiveStreamForSeo = {
  videoId: 'vid1',
  title: 'BA P1 — Centre Court',
}

describe('buildBroadcastJsonLd', () => {
  it('returns empty array when channelMeta is null', () => {
    const out = buildBroadcastJsonLd({
      channelMeta: null,
      liveStreams: [],
      broadcasters: [movistar],
    })
    expect(out).toEqual([])
  })

  it('emits a YT BroadcastEvent when channelMeta is provided, even with no live streams', () => {
    const out = buildBroadcastJsonLd({
      channelMeta: ppChannel,
      liveStreams: [],
      broadcasters: [],
    })
    expect(out).toHaveLength(1)
    expect(out[0]['@type']).toBe('BroadcastEvent')
    expect(out[0].isLiveBroadcast).toBe(false)
    expect(out[0].publishedOn['@type']).toBe('BroadcastService')
    expect(out[0].publishedOn.name).toBe('Premier Padel')
    expect(out[0].publishedOn.url).toBe('https://www.youtube.com/channel/UCK59dYVs3Wgwoe73nDTH6jw')
  })

  it('marks the YT entry isLiveBroadcast=true when liveStreams is non-empty', () => {
    const out = buildBroadcastJsonLd({
      channelMeta: ppChannel,
      liveStreams: [ppLiveStream],
      broadcasters: [],
    })
    expect(out[0].isLiveBroadcast).toBe(true)
    expect(out[0].videoFormat).toBe('HD')
  })

  it('appends one BroadcastEvent per broadcaster row with areaServed', () => {
    const out = buildBroadcastJsonLd({
      channelMeta: ppChannel,
      liveStreams: [],
      broadcasters: [movistar, redBullEs, redBullIt],
    })
    // 1 YT + 3 broadcasters
    expect(out).toHaveLength(4)

    const movistarEntry = out[1]
    expect(movistarEntry.publishedOn.name).toBe('Movistar Plus+')
    expect(movistarEntry.publishedOn.url).toBe('https://www.movistarplus.es/deportes')
    expect(movistarEntry.publishedOn.areaServed).toEqual({ '@type': 'Country', name: 'Spain' })
    expect(movistarEntry.isLiveBroadcast).toBe(false)
    expect(movistarEntry.name).toBe('Watch on Movistar Plus+ in Spain')
  })

  it('uses the uppercased ISO when the country code is unknown to the name map', () => {
    const odd: BroadcasterForSeo = { ...movistar, country_iso2: 'zz' }
    const out = buildBroadcastJsonLd({
      channelMeta: ppChannel,
      liveStreams: [],
      broadcasters: [odd],
    })
    expect(out[1].publishedOn.areaServed?.name).toBe('ZZ')
  })

  it('preserves broadcaster order (caller pre-sorts by country, then display_order)', () => {
    const out = buildBroadcastJsonLd({
      channelMeta: ppChannel,
      liveStreams: [],
      broadcasters: [redBullIt, movistar, redBullEs],
    })
    // YT first, then broadcasters in input order
    expect(out.slice(1).map(e => e.publishedOn.name)).toEqual(['Red Bull TV', 'Movistar Plus+', 'Red Bull TV'])
    expect(out.slice(1).map(e => e.publishedOn.areaServed?.name)).toEqual(['Italy', 'Spain', 'Spain'])
  })
})

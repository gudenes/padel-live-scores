// Pure builder: turns the SEO-side fetch payload (channel meta + live YT
// streams + broadcasters) into a schema.org BroadcastEvent[] array. Used
// inside the existing SportsEvent JSON-LD on match + tournament layouts.

const ISO2_TO_NAME: Record<string, string> = {
  es: 'Spain', it: 'Italy', fr: 'France', de: 'Germany', gb: 'United Kingdom',
  us: 'United States', ar: 'Argentina', mx: 'Mexico', br: 'Brazil',
  pt: 'Portugal', nl: 'Netherlands', be: 'Belgium', se: 'Sweden', no: 'Norway',
  dk: 'Denmark', fi: 'Finland', pl: 'Poland', ch: 'Switzerland', at: 'Austria',
  ie: 'Ireland', gr: 'Greece', tr: 'Turkey', il: 'Israel', sa: 'Saudi Arabia',
  ae: 'UAE', qa: 'Qatar', eg: 'Egypt', ma: 'Morocco', za: 'South Africa',
  jp: 'Japan', kr: 'South Korea', cn: 'China', in: 'India', au: 'Australia',
}

export interface ChannelMetaForSeo {
  id: string                 // youtube_channels.id (uuid)
  channelId: string          // youtube_channels.channel_id (UC...)
  name: string
  abbreviation: string
}

export interface LiveStreamForSeo {
  videoId: string
  title: string
}

export interface BroadcasterForSeo {
  name: string
  url: string
  country_iso2: string
}

export interface BroadcastServiceEntry {
  '@type': 'BroadcastService'
  name: string
  broadcastDisplayName?: string
  url: string
  areaServed?: { '@type': 'Country'; name: string }
  broadcaster: { '@type': 'Organization'; name: string }
}

export interface BroadcastEventEntry {
  '@type': 'BroadcastEvent'
  name: string
  isLiveBroadcast: boolean
  videoFormat?: string
  publishedOn: BroadcastServiceEntry
}

export interface BuildBroadcastJsonLdInput {
  channelMeta: ChannelMetaForSeo | null
  liveStreams: LiveStreamForSeo[]
  broadcasters: BroadcasterForSeo[]
}

function countryName(iso2: string): string {
  return ISO2_TO_NAME[iso2.toLowerCase()] ?? iso2.toUpperCase()
}

export function buildBroadcastJsonLd(input: BuildBroadcastJsonLdInput): BroadcastEventEntry[] {
  const { channelMeta, liveStreams, broadcasters } = input
  if (!channelMeta) return []

  const isLive = liveStreams.length > 0
  const ytUrl = `https://www.youtube.com/channel/${channelMeta.channelId}`

  const ytEntry: BroadcastEventEntry = {
    '@type': 'BroadcastEvent',
    name: `${channelMeta.name} on YouTube`,
    isLiveBroadcast: isLive,
    ...(isLive ? { videoFormat: 'HD' } : {}),
    publishedOn: {
      '@type': 'BroadcastService',
      name: channelMeta.name,
      broadcastDisplayName: channelMeta.name,
      url: ytUrl,
      broadcaster: { '@type': 'Organization', name: channelMeta.name },
    },
  }

  const broadcasterEntries: BroadcastEventEntry[] = broadcasters.map((b) => {
    const country = countryName(b.country_iso2)
    return {
      '@type': 'BroadcastEvent',
      name: `Watch on ${b.name} in ${country}`,
      isLiveBroadcast: false,
      publishedOn: {
        '@type': 'BroadcastService',
        name: b.name,
        url: b.url,
        areaServed: { '@type': 'Country', name: country },
        broadcaster: { '@type': 'Organization', name: b.name },
      },
    }
  })

  return [ytEntry, ...broadcasterEntries]
}

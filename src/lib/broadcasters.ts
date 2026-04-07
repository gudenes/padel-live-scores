// src/lib/broadcasters.ts
//
// Helpers for normalizing broadcaster data fetched from the
// premierpadel.com /getwheretowatch API. Used by the sync cron and
// any client code that needs to render broadcaster names/icons.

/** Known broadcasters with curated display names and free-tier flags.
 *  Keys are URL hostnames (no www). Anything not in the map falls back
 *  to a derived name from the hostname. */
const KNOWN_BROADCASTERS: Record<string, { name: string; isFree: boolean }> = {
  'redbull.com':         { name: 'Red Bull TV',           isFree: true  },
  'youtube.com':         { name: 'Premier Padel YouTube', isFree: true  },
  'beinsports.com':      { name: 'beIN Sports',           isFree: false },
  'sporttv.pt':          { name: 'Sport TV',              isFree: false },
  'sport.sky.it':        { name: 'Sky Sport Italia',      isFree: false },
  'sky.it':              { name: 'Sky Sport Italia',      isFree: false },
  'supertennis.tv':      { name: 'SuperTennis',           isFree: false },
  'movistarplus.es':     { name: 'Movistar Plus+',        isFree: false },
  'cosmotetv.gr':        { name: 'Cosmote TV',            isFree: false },
  'espn.com':            { name: 'ESPN',                  isFree: false },
  'viaplaygroup.com':    { name: 'Viaplay',               isFree: false },
  'viaplay.com':         { name: 'Viaplay',               isFree: false },
  'vk.com':              { name: 'VK Padel',              isFree: true  },
  'sport1.maariv.co.il': { name: 'Sport 1',               isFree: false },
  'maariv.co.il':        { name: 'Sport 1',               isFree: false },
  'canalplus.com':       { name: 'Canal+',                isFree: false },
  'tod.tv':              { name: 'TOD',                   isFree: false },
  'go3.lt':              { name: 'Go3',                   isFree: false },
}

/** Pull the hostname out of a URL, lowercased and stripped of any leading
 *  "www." prefix. Returns null on malformed input. */
export function broadcasterHostname(url: string): string | null {
  try {
    const u = new URL(url)
    return u.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/** Resolve a friendly broadcaster name from its watch URL.
 *  Falls back to capitalizing the hostname's second-level domain when the
 *  URL isn't in the known-broadcasters map. */
export function broadcasterNameFromUrl(url: string): string {
  const host = broadcasterHostname(url)
  if (!host) return 'Watch'
  if (KNOWN_BROADCASTERS[host]) return KNOWN_BROADCASTERS[host].name
  // Fallback: take the second-level domain (e.g. example.co.uk → example)
  const parts = host.split('.')
  const slug = parts.length >= 2 ? parts[parts.length - 2] : parts[0]
  return slug.charAt(0).toUpperCase() + slug.slice(1)
}

/** Returns true if the broadcaster (by URL) is one of the known free
 *  options (Red Bull TV, YouTube). */
export function broadcasterIsFree(url: string): boolean {
  const host = broadcasterHostname(url)
  if (!host) return false
  return KNOWN_BROADCASTERS[host]?.isFree ?? false
}

/** Extract the 2-letter ISO country code from a Premier Padel flag URL.
 *  Example: "https://d1txpmnu5q46gr.cloudfront.net/uploads/default/flags/128x128/af.png" → "af"
 *  Returns null if the URL doesn't match the expected pattern. */
export function iso2FromFlagUrl(flagUrl: string | null | undefined): string | null {
  if (!flagUrl) return null
  const match = flagUrl.match(/\/flags\/[^/]+\/([a-z]{2})\.png/i)
  return match ? match[1].toLowerCase() : null
}

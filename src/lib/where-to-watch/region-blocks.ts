// Pure helpers for the geo-rules suggestion path. No I/O.

export interface RegionBlockObservation {
  sampleSize: number
  blocked: Record<string, number>
}

/** Aggregate YouTube `regionRestriction.blocked` over a channel's recent
 *  videos. Only videos that carry a `blocked` list count toward sampleSize. */
export function aggregateRegionBlocks(
  videos: Array<{ regionRestriction?: { blocked?: string[]; allowed?: string[] } }>,
): RegionBlockObservation {
  let sampleSize = 0
  const blocked: Record<string, number> = {}
  for (const v of videos) {
    const list = v.regionRestriction?.blocked
    if (!list || list.length === 0) continue
    sampleSize++
    for (const cc of list) {
      const k = cc.toLowerCase()
      blocked[k] = (blocked[k] ?? 0) + 1
    }
  }
  return { sampleSize, blocked }
}

export interface BlockSuggestion {
  country: string
  reasons: Array<'yt_api' | 'broadcaster'>
  ytBlockedCount?: number
  ytSampleSize?: number
}

export interface ComputeSuggestionsArgs {
  observed: RegionBlockObservation | null
  broadcasterCountries: string[]
  alreadyBlocked: string[]
  threshold?: number  // fraction of samples, default 0.6
  minSample?: number  // minimum sampleSize to trust yt_api, default 5
}

/** Combine the YouTube-observed blocks and broadcaster signal into a
 *  de-duplicated suggestion list, excluding already-blocked countries. */
export function computeBlockSuggestions(args: ComputeSuggestionsArgs): BlockSuggestion[] {
  const { observed, broadcasterCountries, alreadyBlocked, threshold = 0.6, minSample = 5 } = args
  const already = new Set(alreadyBlocked.map(c => c.toLowerCase()))
  const byCountry = new Map<string, BlockSuggestion>()

  if (observed && observed.sampleSize >= minSample) {
    for (const [cc, count] of Object.entries(observed.blocked)) {
      if (count / observed.sampleSize < threshold) continue
      byCountry.set(cc, {
        country: cc, reasons: ['yt_api'],
        ytBlockedCount: count, ytSampleSize: observed.sampleSize,
      })
    }
  }

  for (const raw of broadcasterCountries) {
    const cc = raw.toLowerCase()
    const existing = byCountry.get(cc)
    if (existing) {
      if (!existing.reasons.includes('broadcaster')) existing.reasons.push('broadcaster')
    } else {
      byCountry.set(cc, { country: cc, reasons: ['broadcaster'] })
    }
  }

  return [...byCountry.values()]
    .filter(s => !already.has(s.country))
    .sort((a, b) => a.country.localeCompare(b.country))
}

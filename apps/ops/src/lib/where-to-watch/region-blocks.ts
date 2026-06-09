// Pure helpers for the geo-rules suggestion path. No I/O.

export interface RegionBlockObservation {
  sampleSize: number
  blocked: Record<string, number>
}

/** Aggregate YouTube `regionRestriction.blocked` over a channel's recent
 *  videos. Only videos that carry a `blocked` list count toward sampleSize. */
export function aggregateRegionBlocks(
  videos: Array<{ regionRestriction?: { blocked?: string[]; allowed?: string[] } | null }>,
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

/** Build the block-suggestion list.
 *
 *  Suggestions are driven ONLY by YouTube's observed `regionRestriction` — the
 *  accurate signal for "the live stream won't play here". A local broadcaster
 *  existing is NOT evidence the stream is blocked (Premier's where-to-watch
 *  feed lists a broadcaster for ~every country), so it never generates a
 *  suggestion on its own; it only annotates a YouTube-based suggestion to tell
 *  the operator a redirect target already exists. Already-blocked countries are
 *  excluded. */
export function computeBlockSuggestions(args: ComputeSuggestionsArgs): BlockSuggestion[] {
  const { observed, broadcasterCountries, alreadyBlocked, threshold = 0.6, minSample = 5 } = args
  const already = new Set(alreadyBlocked.map(c => c.toLowerCase()))
  const hasBroadcaster = new Set(broadcasterCountries.map(c => c.toLowerCase()))
  const out: BlockSuggestion[] = []

  if (observed && observed.sampleSize >= minSample) {
    for (const [ccRaw, count] of Object.entries(observed.blocked)) {
      const cc = ccRaw.toLowerCase()
      if (count / observed.sampleSize < threshold) continue
      if (already.has(cc)) continue
      const reasons: Array<'yt_api' | 'broadcaster'> = ['yt_api']
      if (hasBroadcaster.has(cc)) reasons.push('broadcaster')
      out.push({ country: cc, reasons, ytBlockedCount: count, ytSampleSize: observed.sampleSize })
    }
  }

  return out.sort((a, b) => a.country.localeCompare(b.country))
}

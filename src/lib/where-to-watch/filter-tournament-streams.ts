// src/lib/where-to-watch/filter-tournament-streams.ts
//
// Pure function — filter a batch of live YouTube videos down to those
// attributable to a specific tournament.
//
// Attribution rules (per channel):
//   - FIP TOUR (channel abbreviation 'FIP'): canonical attribution via the
//     fip-streams-discover cron — keep iff video_id is in attributedVideoIds.
//   - Other channels: heuristic — keep iff the title's token set intersects
//     the tournament-name token set on at least `minHeuristicTokens` tokens
//     (default 2). Same tokenizer the FIP title parser uses, so noise tokens
//     ('fip', 'padel', 'tour', …) and year tokens never contribute to overlap.

import { tokenize } from '../fip-stream-title-parser'
import type { LiveChannel } from './group-builder'

export interface FilterTournamentStreamsArgs {
  liveVideos: LiveChannel[]
  attributedVideoIds: Set<string>
  /** Pre-tokenized via `tokenize()` from `fip-stream-title-parser`. Noise
   *  tokens ('fip', 'padel', 'tour', …) and 4-digit year tokens must already
   *  be stripped — pass raw `tournament.name.split(' ')` and the overlap
   *  count will be wrong. */
  tournamentNameTokens: string[]
  minHeuristicTokens?: number
}

const FIP_ABBR = 'FIP'

export function filterTournamentStreams(args: FilterTournamentStreamsArgs): LiveChannel[] {
  const {
    liveVideos,
    attributedVideoIds,
    tournamentNameTokens,
    minHeuristicTokens = 2,
  } = args
  const nameTokenSet = new Set(tournamentNameTokens)
  const result: LiveChannel[] = []

  for (const v of liveVideos) {
    if (v.channel.abbreviation === FIP_ABBR) {
      if (attributedVideoIds.has(v.videoId)) result.push(v)
      continue
    }
    const titleTokens = tokenize(v.title)
    let overlap = 0
    for (const tok of titleTokens) {
      if (nameTokenSet.has(tok)) {
        overlap += 1
        if (overlap >= minHeuristicTokens) break
      }
    }
    if (overlap >= minHeuristicTokens) result.push(v)
  }

  return result
}

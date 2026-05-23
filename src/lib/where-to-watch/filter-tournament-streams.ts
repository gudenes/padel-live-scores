// src/lib/where-to-watch/filter-tournament-streams.ts
//
// Pure function — filter a batch of live YouTube videos down to those
// attributable to a specific tournament via title-token overlap.
//
// Rules:
//   - Non-FIP channels: keep iff the title's token set intersects the
//     tournament-name token set on at least `minHeuristicTokens` tokens
//     (default 2). Same tokenizer the title parser uses, so noise tokens
//     ('fip', 'padel', 'tour', …) and year tokens never contribute.
//   - FIP TOUR channel (abbreviation 'FIP'): videos are excluded by
//     default. Callers that know collisions are bounded (e.g. the
//     tournament page restricting this to its active window
//     now ∈ [starts_at, ends_at + 24h]) opt in via
//     `applyFipHeuristic: true`, at which point FIP videos go through
//     the same token-overlap check.
//
// Why FIP is opt-in: the FIP TOUR channel broadcasts many similarly-named
// events simultaneously, so a 2024-edition title can token-collide with a
// 2026 live stream. Callers without a temporal/scope guard should leave
// the flag at its default and accept that FIP-channel videos never match.

import { tokenize } from '../fip-stream-title-parser'
import type { LiveChannel } from './group-builder'

export interface FilterTournamentStreamsArgs {
  liveVideos: LiveChannel[]
  /** Pre-tokenized via `tokenize()` from `fip-stream-title-parser`. Noise
   *  tokens ('fip', 'padel', 'tour', …) and 4-digit year tokens must already
   *  be stripped — pass raw `tournament.name.split(' ')` and the overlap
   *  count will be wrong. */
  tournamentNameTokens: string[]
  minHeuristicTokens?: number
  /** When true, FIP-channel videos go through the same title-token
   *  heuristic non-FIP videos use. The caller is responsible for setting
   *  this only when collision risk is low — the tournament page restricts
   *  it to currently-active tournaments (now ∈ [starts_at, ends_at + 24h])
   *  so a 2024 edition can't hijack a 2026 live stream. Default: false. */
  applyFipHeuristic?: boolean
}

const FIP_ABBR = 'FIP'

export function filterTournamentStreams(args: FilterTournamentStreamsArgs): LiveChannel[] {
  const {
    liveVideos,
    tournamentNameTokens,
    minHeuristicTokens = 2,
    applyFipHeuristic = false,
  } = args
  const nameTokenSet = new Set(tournamentNameTokens)
  const result: LiveChannel[] = []

  for (const v of liveVideos) {
    if (v.channel.abbreviation === FIP_ABBR && !applyFipHeuristic) continue

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

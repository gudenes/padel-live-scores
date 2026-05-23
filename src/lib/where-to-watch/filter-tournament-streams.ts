// src/lib/where-to-watch/filter-tournament-streams.ts
//
// Pure function — filter a batch of live YouTube videos down to those
// attributable to a specific tournament.
//
// Attribution rules (per channel):
//   - FIP TOUR (channel abbreviation 'FIP'): first try attribution via
//     fip_court_streams (the cron's authoritative output). Then, if the
//     caller opts in via `applyFipHeuristic`, fall through to the same
//     title-token overlap check used for non-FIP channels.
//   - Other channels: heuristic — keep iff the title's token set intersects
//     the tournament-name token set on at least `minHeuristicTokens` tokens
//     (default 2). Same tokenizer the FIP title parser uses, so noise tokens
//     ('fip', 'padel', 'tour', …) and year tokens never contribute to overlap.
//
// Why the FIP heuristic is opt-in rather than always-on:
// The original spec required FIP-channel videos to be canonically attributed
// (a row in fip_court_streams) because the FIP TOUR channel broadcasts many
// similarly-named tournaments simultaneously — token collisions across past
// editions of the same event were a real false-positive risk. In practice
// the fip-streams-discover cron's title-resolver has scored 0/50 on every
// run we have telemetry for (the in-route matcher had two reversed checks
// — required court name + wrong-direction subset check). Manual rows exist
// in fip_court_streams from operator backfills, but auto-attribution has
// never worked end-to-end. So:
//
//   - Callers that already have a tournament-active context (e.g. the
//     tournament page where now ∈ [starts_at, ends_at+24h]) should set
//     applyFipHeuristic=true — the active-window check guards against
//     past-edition collisions that the original spec was worried about.
//   - Callers without that context (or that want strict attribution) leave
//     the flag at its default (false) and get the original behaviour.

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
  /** When true, FIP-channel videos that miss attribution fall through to
   *  the same title-token heuristic non-FIP videos use. The caller is
   *  responsible for setting this only when collision risk is low — the
   *  tournament page restricts it to currently-active tournaments
   *  (now ∈ [starts_at, ends_at + 24h]) so a 2024 edition can't hijack
   *  a 2026 live stream. Default: false (strict attribution only). */
  applyFipHeuristic?: boolean
}

const FIP_ABBR = 'FIP'

export function filterTournamentStreams(args: FilterTournamentStreamsArgs): LiveChannel[] {
  const {
    liveVideos,
    attributedVideoIds,
    tournamentNameTokens,
    minHeuristicTokens = 2,
    applyFipHeuristic = false,
  } = args
  const nameTokenSet = new Set(tournamentNameTokens)
  const result: LiveChannel[] = []

  for (const v of liveVideos) {
    if (v.channel.abbreviation === FIP_ABBR) {
      // Canonical attribution always wins, regardless of the flag.
      if (attributedVideoIds.has(v.videoId)) {
        result.push(v)
        continue
      }
      // Strict mode: no attribution, no match.
      if (!applyFipHeuristic) continue
      // Heuristic mode: fall through to the token-overlap check below.
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

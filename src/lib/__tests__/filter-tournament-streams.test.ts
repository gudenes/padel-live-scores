import { describe, it, expect } from 'vitest'
import { filterTournamentStreams } from '../where-to-watch/filter-tournament-streams'
import type { LiveChannel } from '../where-to-watch/group-builder'

const fipVideo = (videoId: string, title: string): LiveChannel => ({
  videoId,
  title,
  channel: { id: 'fip-uuid', name: 'FIP TOUR', abbreviation: 'FIP', colorHex: '#1A4DAA', displayOrder: 1 },
})
const pmVideo = (videoId: string, title: string): LiveChannel => ({
  videoId,
  title,
  channel: { id: 'pm-uuid', name: 'Padelmag TV', abbreviation: 'PM', colorHex: '#16A34A', displayOrder: 2 },
})

describe('filterTournamentStreams', () => {
  it('keeps a non-FIP video whose title shares ≥2 non-noise tokens with the tournament name', () => {
    const result = filterTournamentStreams({
      liveVideos: [pmVideo('v1', 'Piste centrale — FIP Bronze Marnes — 1/8 et 1/4')],
      tournamentNameTokens: ['bronze', 'marnes'],
    })
    expect(result.map(v => v.videoId)).toEqual(['v1'])
  })

  it('drops a non-FIP video that shares only 1 token with the tournament name', () => {
    const result = filterTournamentStreams({
      liveVideos: [pmVideo('v1', 'FIP Bronze Yogyakarta — Court 4')],
      tournamentNameTokens: ['bronze', 'marnes'],
    })
    expect(result).toEqual([])
  })

  it('drops a non-FIP video that shares 0 tokens with the tournament name', () => {
    const result = filterTournamentStreams({
      liveVideos: [pmVideo('v1', 'Random padel highlights compilation')],
      tournamentNameTokens: ['bronze', 'marnes'],
    })
    expect(result).toEqual([])
  })

  it('handles diacritics in both tournament name and video title', () => {
    const result = filterTournamentStreams({
      liveVideos: [pmVideo('v1', 'FIP Silver Buènos Aires — Pista Central')],
      tournamentNameTokens: ['buenos', 'aires'],
    })
    expect(result.map(v => v.videoId)).toEqual(['v1'])
  })

  it('respects a custom minHeuristicTokens threshold', () => {
    const result = filterTournamentStreams({
      liveVideos: [pmVideo('v1', 'FIP Bronze Marnes — R16')],
      tournamentNameTokens: ['bronze', 'marnes'],
      minHeuristicTokens: 3,
    })
    expect(result).toEqual([])
  })

  it('returns an empty array when given no live videos', () => {
    const result = filterTournamentStreams({
      liveVideos: [],
      tournamentNameTokens: ['bronze', 'marnes'],
    })
    expect(result).toEqual([])
  })

  it('drops all non-FIP videos when tournamentNameTokens is empty', () => {
    // Defensive: a tournament whose name tokenizes to nothing (e.g. a name
    // composed entirely of noise tokens) should not accidentally match every
    // non-FIP stream. Empty name token set → zero overlap → all rows drop.
    const result = filterTournamentStreams({
      liveVideos: [
        fipVideo('v1', 'FIP Bronze Marnes — R16'),
        pmVideo('v2', 'Piste centrale — FIP Bronze Marnes'),
      ],
      tournamentNameTokens: [],
      applyFipHeuristic: true,
    })
    expect(result).toEqual([])
  })

  // ── FIP-channel handling ──────────────────────────────────────────
  // FIP TOUR is excluded by default (callers without a temporal/scope
  // guard would risk past-edition collisions). Opting in routes FIP
  // videos through the same token-overlap check non-FIP videos use.

  it('drops a FIP TOUR video by default, even if the title would token-match', () => {
    const result = filterTournamentStreams({
      liveVideos: [fipVideo('v1', 'FIP BRONZE MARNES - Finals')],
      tournamentNameTokens: ['bronze', 'marnes'],
      // applyFipHeuristic omitted → default false
    })
    expect(result).toEqual([])
  })

  it('keeps a FIP TOUR video when applyFipHeuristic is true and tokens overlap ≥ min', () => {
    // The Marnes-style case the heuristic exists for: live FIP TOUR video
    // for the active tournament, title and name share enough significant
    // tokens.
    const result = filterTournamentStreams({
      liveVideos: [fipVideo('v1', 'FIP BRONZE MARNES - Finals')],
      tournamentNameTokens: ['bronze', 'marnes'],
      applyFipHeuristic: true,
    })
    expect(result.map(v => v.videoId)).toEqual(['v1'])
  })

  it('drops a FIP TOUR video when applyFipHeuristic is true but token overlap is < min', () => {
    // Heuristic-on doesn't mean "match anything FIP" — it still requires
    // the same min-overlap that non-FIP channels need, preventing a
    // currently-active tournament from grabbing every unrelated FIP video.
    const result = filterTournamentStreams({
      liveVideos: [fipVideo('v1', 'FIP Bronze Yogyakarta — R32 — Court 4')],
      tournamentNameTokens: ['bronze', 'marnes'],
      applyFipHeuristic: true,
    })
    // Title shares "bronze" with the name but no city token → 1 overlap < min 2 → drop.
    expect(result).toEqual([])
  })

  it('handles a mixed batch of FIP and non-FIP videos with the flag enabled', () => {
    const result = filterTournamentStreams({
      liveVideos: [
        fipVideo('v1', 'FIP BRONZE MARNES - Finals'),
        fipVideo('v2', 'FIP BRONZE YOGYAKARTA - Quarterfinals'),
        pmVideo('v3', 'Piste centrale — FIP Bronze Marnes'),
        pmVideo('v4', 'FIP Bronze Yogyakarta — Court 4'),
      ],
      tournamentNameTokens: ['bronze', 'marnes'],
      applyFipHeuristic: true,
    })
    expect(result.map(v => v.videoId).sort()).toEqual(['v1', 'v3'])
  })
})

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
  it('keeps a FIP TOUR video whose id is in the attributed set', () => {
    const result = filterTournamentStreams({
      liveVideos: [fipVideo('v1', 'FIP Bronze Marnes — R16')],
      attributedVideoIds: new Set(['v1']),
      tournamentNameTokens: ['bronze', 'marnes'],
    })
    expect(result.map(v => v.videoId)).toEqual(['v1'])
  })

  it('drops a FIP TOUR video whose id is not in the attributed set, even if the title matches', () => {
    const result = filterTournamentStreams({
      liveVideos: [fipVideo('v1', 'FIP Bronze Marnes — R16')],
      attributedVideoIds: new Set(),
      tournamentNameTokens: ['bronze', 'marnes'],
    })
    expect(result).toEqual([])
  })

  it('keeps a non-FIP video whose title shares ≥2 non-noise tokens with the tournament name', () => {
    const result = filterTournamentStreams({
      liveVideos: [pmVideo('v1', 'Piste centrale — FIP Bronze Marnes — 1/8 et 1/4')],
      attributedVideoIds: new Set(),
      tournamentNameTokens: ['bronze', 'marnes'],
    })
    expect(result.map(v => v.videoId)).toEqual(['v1'])
  })

  it('drops a non-FIP video that shares only 1 token with the tournament name', () => {
    const result = filterTournamentStreams({
      liveVideos: [pmVideo('v1', 'FIP Bronze Yogyakarta — Court 4')],
      attributedVideoIds: new Set(),
      tournamentNameTokens: ['bronze', 'marnes'],
    })
    expect(result).toEqual([])
  })

  it('drops a non-FIP video that shares 0 tokens with the tournament name', () => {
    const result = filterTournamentStreams({
      liveVideos: [pmVideo('v1', 'Random padel highlights compilation')],
      attributedVideoIds: new Set(),
      tournamentNameTokens: ['bronze', 'marnes'],
    })
    expect(result).toEqual([])
  })

  it('handles diacritics in both tournament name and video title', () => {
    const result = filterTournamentStreams({
      liveVideos: [pmVideo('v1', 'FIP Silver Buènos Aires — Pista Central')],
      attributedVideoIds: new Set(),
      tournamentNameTokens: ['buenos', 'aires'],
    })
    expect(result.map(v => v.videoId)).toEqual(['v1'])
  })

  it('respects a custom minHeuristicTokens threshold', () => {
    const result = filterTournamentStreams({
      liveVideos: [pmVideo('v1', 'FIP Bronze Marnes — R16')],
      attributedVideoIds: new Set(),
      tournamentNameTokens: ['bronze', 'marnes'],
      minHeuristicTokens: 3,
    })
    expect(result).toEqual([])
  })

  it('returns an empty array when given no live videos', () => {
    const result = filterTournamentStreams({
      liveVideos: [],
      attributedVideoIds: new Set(),
      tournamentNameTokens: ['bronze', 'marnes'],
    })
    expect(result).toEqual([])
  })

  it('handles a mixed batch of FIP-attributed, FIP-unattributed, and non-FIP videos', () => {
    const result = filterTournamentStreams({
      liveVideos: [
        fipVideo('v1', 'FIP Bronze Marnes — R16'),
        fipVideo('v2', 'FIP Bronze Yogyakarta — R32 — Court 4'),
        pmVideo('v3', 'Piste centrale — FIP Bronze Marnes'),
        pmVideo('v4', 'FIP Bronze Yogyakarta — Court 4'),
      ],
      attributedVideoIds: new Set(['v1']),
      tournamentNameTokens: ['bronze', 'marnes'],
    })
    expect(result.map(v => v.videoId).sort()).toEqual(['v1', 'v3'])
  })

  it('drops all non-FIP videos when tournamentNameTokens is empty', () => {
    // Defensive: a tournament whose name tokenizes to nothing (e.g. a name
    // composed entirely of noise tokens) should not accidentally match every
    // non-FIP stream. Empty name token set → zero overlap → all non-FIP rows
    // drop. FIP rows still flow through the canonical attribution branch.
    const result = filterTournamentStreams({
      liveVideos: [
        fipVideo('v1', 'FIP Bronze Marnes — R16'),
        pmVideo('v2', 'Piste centrale — FIP Bronze Marnes'),
      ],
      attributedVideoIds: new Set(['v1']),
      tournamentNameTokens: [],
    })
    expect(result.map(v => v.videoId)).toEqual(['v1'])
  })
})

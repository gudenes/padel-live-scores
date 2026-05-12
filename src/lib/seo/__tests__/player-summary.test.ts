import { describe, it, expect } from 'vitest'
import { buildPlayerSummary, type PlayerSummaryInput } from '../player-summary'

const basePlayer: PlayerSummaryInput = {
  name: 'Juan Lebron',
  country: 'Spain',
  category: 'men',
  ranking: 4,
  total_matches: 312,
  win_rate: 0.71,
  recent: [
    {
      tournament_name: 'Buenos Aires P1',
      round: 'Final',
      opponents: ['Stupaczuk / Di Nenno'],
      result: 'won 6-4, 7-5',
      played_on: '2026-05-04',
    },
    {
      tournament_name: 'Buenos Aires P1',
      round: 'Semifinal',
      opponents: ['Coello / Tapia'],
      result: 'won 7-6, 6-3',
      played_on: '2026-05-03',
    },
  ],
}

describe('buildPlayerSummary', () => {
  it('produces a one-line headline including ranking + country', () => {
    const summary = buildPlayerSummary(basePlayer)
    expect(summary.headline).toBe(
      'Juan Lebron — professional padel player from Spain, currently ranked #4 in the men’s circuit',
    )
  })

  it('returns a list of factual sentences for the body', () => {
    const summary = buildPlayerSummary(basePlayer)
    expect(summary.facts).toContain('Country: Spain')
    expect(summary.facts).toContain('Current ranking: #4 (men)')
    expect(summary.facts.some((f) => f.startsWith('Career: 312 matches'))).toBe(true)
  })

  it('emits recent match lines for SEO body content', () => {
    const summary = buildPlayerSummary(basePlayer)
    expect(summary.recentLines).toHaveLength(2)
    expect(summary.recentLines[0]).toBe(
      '2026-05-04 — Buenos Aires P1 Final: won 6-4, 7-5 vs Stupaczuk / Di Nenno',
    )
  })

  it('handles unranked player', () => {
    const unranked: PlayerSummaryInput = { ...basePlayer, ranking: null }
    const summary = buildPlayerSummary(unranked)
    expect(summary.headline).toBe(
      'Juan Lebron — professional padel player from Spain',
    )
    expect(summary.facts).not.toContain('Current ranking: #4 (men)')
  })

  it('handles unknown country', () => {
    const noCountry: PlayerSummaryInput = { ...basePlayer, country: null }
    const summary = buildPlayerSummary(noCountry)
    expect(summary.headline).toBe(
      'Juan Lebron — professional padel player, currently ranked #4 in the men’s circuit',
    )
  })
})

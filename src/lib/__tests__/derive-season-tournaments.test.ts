import { describe, it, expect } from 'vitest'
import { deriveSeasonTournaments } from '../derive-season-tournaments'
import type { MatchRowForTitles } from '../derive-titles'

const player = { id: 'p1' }
const partner = { id: 'p2' }
const opp1 = { id: 'p3' }
const opp2 = { id: 'p4' }

const match = (overrides: Partial<MatchRowForTitles>): MatchRowForTitles => ({
  id: 'm',
  round: 'R16',
  status: 'finished',
  winner_pair: 1,
  played_at: null,
  finished_at: '2026-04-01T18:00:00Z',
  scheduled_at: null,
  pair1_player1: player,
  pair1_player2: partner,
  pair2_player1: opp1,
  pair2_player2: opp2,
  tournament: { id: 't1', name: 'Tour 1', level: 'premier_p2' },
  ...overrides,
})

describe('deriveSeasonTournaments', () => {
  it('returns empty for empty input', () => {
    expect(deriveSeasonTournaments([], 'p1', 2026)).toEqual([])
  })

  it('filters matches to the requested year', () => {
    const m2025 = match({ id: 'a', finished_at: '2025-04-01T00:00:00Z' })
    const m2026 = match({ id: 'b', finished_at: '2026-04-01T00:00:00Z' })
    const result = deriveSeasonTournaments([m2025, m2026], 'p1', 2026)
    expect(result).toHaveLength(1)
  })

  it('aggregates multiple matches in same tournament', () => {
    const r16 = match({ id: 'a', round: 'R16', winner_pair: 1 })
    const qf  = match({ id: 'b', round: 'QF',  winner_pair: 1 })
    const sf  = match({ id: 'c', round: 'SF',  winner_pair: 2 }) // lost in SF
    const result = deriveSeasonTournaments([r16, qf, sf], 'p1', 2026)
    expect(result).toHaveLength(1)
    expect(result[0].bestRound).toBe('SF')
    expect(result[0].matchCount).toBe(3)
    expect(result[0].wins).toBe(2)
    expect(result[0].losses).toBe(1)
    expect(result[0].isTitle).toBe(false)
  })

  it('marks isTitle=true and bestRound="W" when player won the final', () => {
    const sf = match({ id: 'a', round: 'SF', winner_pair: 1 })
    const f  = match({ id: 'b', round: 'F',  winner_pair: 1 })
    const result = deriveSeasonTournaments([sf, f], 'p1', 2026)
    expect(result[0].bestRound).toBe('W')
    expect(result[0].isTitle).toBe(true)
  })

  it('bestRound stays "F" when player lost the final', () => {
    const sf = match({ id: 'a', round: 'SF', winner_pair: 1 })
    const f  = match({ id: 'b', round: 'F',  winner_pair: 2 }) // lost final
    const result = deriveSeasonTournaments([sf, f], 'p1', 2026)
    expect(result[0].bestRound).toBe('F')
    expect(result[0].isTitle).toBe(false)
  })

  it('sorts tournaments by latest match date desc', () => {
    const apr = match({ id: 'a', tournament: { id: 'apr', name: 'Apr', level: null }, finished_at: '2026-04-15T00:00:00Z' })
    const may = match({ id: 'b', tournament: { id: 'may', name: 'May', level: null }, finished_at: '2026-05-15T00:00:00Z' })
    const feb = match({ id: 'c', tournament: { id: 'feb', name: 'Feb', level: null }, finished_at: '2026-02-15T00:00:00Z' })
    const result = deriveSeasonTournaments([apr, may, feb], 'p1', 2026)
    expect(result.map(r => r.tournament.id)).toEqual(['may', 'apr', 'feb'])
  })

  it('skips matches with no tournament reference', () => {
    const orphan = match({ tournament: null })
    expect(deriveSeasonTournaments([orphan], 'p1', 2026)).toEqual([])
  })

  it('uses played_at or scheduled_at when finished_at is null', () => {
    const m = match({ finished_at: null, played_at: '2026-03-01' })
    const result = deriveSeasonTournaments([m], 'p1', 2026)
    expect(result).toHaveLength(1)
  })
})

import { describe, it, expect } from 'vitest'
import { parseScoreAfter, deriveLiveState, markCurrentSets, buildLiveCard } from '../padelgod-live-cards'
import type { ShadowPointRow, ShadowSetRow, MatchRow } from '../padelgod-live-cards'

describe('parseScoreAfter', () => {
  it('parses a standard score string', () => {
    expect(parseScoreAfter('40-30')).toEqual({ pair1Score: '40', pair2Score: '30' })
  })

  it('parses deuce', () => {
    expect(parseScoreAfter('40-40')).toEqual({ pair1Score: '40', pair2Score: '40' })
  })

  it('parses advantage (Ad-40)', () => {
    expect(parseScoreAfter('Ad-40')).toEqual({ pair1Score: 'Ad', pair2Score: '40' })
  })

  it('returns 0-0 for null', () => {
    expect(parseScoreAfter(null)).toEqual({ pair1Score: '0', pair2Score: '0' })
  })

  it('returns 0-0 for malformed input', () => {
    expect(parseScoreAfter('nonsense')).toEqual({ pair1Score: '0', pair2Score: '0' })
  })
})

const mkPoint = (o: Partial<ShadowPointRow>): ShadowPointRow => ({
  match_id: 'm1',
  set_number: 1,
  game_number: 1,
  point_number: 1,
  winner_pair: 1,
  score_after: '15-0',
  server_team: 1,
  is_golden_point: false,
  created_at: '2026-04-21T09:00:00.000Z',
  ...o,
})

describe('deriveLiveState', () => {
  it('returns 0-0 and null server when no points', () => {
    expect(deriveLiveState([])).toEqual({
      currentGame: { pair1Score: '0', pair2Score: '0', isGoldenPoint: false },
      servingTeam: null,
    })
  })

  it('uses the latest point by (set, game, pt) — newest-last input', () => {
    const points: ShadowPointRow[] = [
      mkPoint({ set_number: 1, game_number: 1, point_number: 1, score_after: '15-0',  server_team: 1 }),
      mkPoint({ set_number: 1, game_number: 2, point_number: 3, score_after: '30-40', server_team: 2 }),
    ]
    expect(deriveLiveState(points)).toEqual({
      currentGame: { pair1Score: '30', pair2Score: '40', isGoldenPoint: false },
      servingTeam: 2,
    })
  })

  it('flags a golden-point correctly', () => {
    const points = [mkPoint({ score_after: '40-40', server_team: 1, is_golden_point: true })]
    expect(deriveLiveState(points)).toEqual({
      currentGame: { pair1Score: '40', pair2Score: '40', isGoldenPoint: true },
      servingTeam: 1,
    })
  })

  it('returns null server when server_team is null', () => {
    const points = [mkPoint({ server_team: null, score_after: '15-0' })]
    expect(deriveLiveState(points).servingTeam).toBeNull()
  })
})

const mkSet = (o: Partial<ShadowSetRow>): ShadowSetRow => ({
  match_id: 'm1',
  set_number: 1,
  pair1_games: 0,
  pair2_games: 0,
  updated_at: null,
  ...o,
})

describe('markCurrentSets', () => {
  it('returns empty array for empty input', () => {
    expect(markCurrentSets([])).toEqual([])
  })

  it('marks the highest-numbered set as current', () => {
    const sets = [
      mkSet({ set_number: 1, pair1_games: 6, pair2_games: 3 }),
      mkSet({ set_number: 2, pair1_games: 3, pair2_games: 4 }),
    ]
    expect(markCurrentSets(sets)).toEqual([
      { setNumber: 1, pair1Games: 6, pair2Games: 3, isCurrent: false },
      { setNumber: 2, pair1Games: 3, pair2Games: 4, isCurrent: true },
    ])
  })

  it('returns sets sorted by set_number ascending regardless of input order', () => {
    const sets = [
      mkSet({ set_number: 2, pair1_games: 3, pair2_games: 4 }),
      mkSet({ set_number: 1, pair1_games: 6, pair2_games: 3 }),
    ]
    const result = markCurrentSets(sets)
    expect(result.map(s => s.setNumber)).toEqual([1, 2])
    expect(result[1].isCurrent).toBe(true)
  })

  it('handles null games as 0', () => {
    const sets = [mkSet({ set_number: 1, pair1_games: null, pair2_games: null })]
    expect(markCurrentSets(sets)).toEqual([
      { setNumber: 1, pair1Games: 0, pair2Games: 0, isCurrent: true },
    ])
  })
})

const baseMatch: MatchRow = {
  id: 'match-1',
  tournament_id: 'tour-1',
  status: 'live',
  court: 'COURT NEXTENSA',
  round: 'Q3',
  scheduled_at: null,
  pair1_player1: { name: 'Coello', country: 'ESP' },
  pair1_player2: { name: 'Tapia', country: 'ARG' },
  pair2_player1: { name: 'Galán', country: 'ESP' },
  pair2_player2: { name: 'Chingotto', country: 'ARG' },
}

describe('buildLiveCard', () => {
  it('builds a live card with servingTeam=null when points are empty', () => {
    const card = buildLiveCard(baseMatch, 'Brussels P2 2026', [], [])
    expect(card.status).toBe('live')
    expect(card.servingTeam).toBeNull()
    expect(card.currentGame).toEqual({ pair1Score: '0', pair2Score: '0', isGoldenPoint: false })
    expect(card.sets).toEqual([])
    expect(card.points).toEqual([])
    expect(card.tournamentName).toBe('Brussels P2 2026')
    expect(card.pair1.player1).toEqual({ name: 'Coello', country: 'ESP' })
  })

  it('sets servingTeam and currentGame from the latest point', () => {
    const points: ShadowPointRow[] = [
      mkPoint({ set_number: 1, game_number: 1, point_number: 1, score_after: '15-0',  server_team: 1 }),
      mkPoint({ set_number: 1, game_number: 2, point_number: 3, score_after: '30-40', server_team: 2 }),
    ]
    const card = buildLiveCard(baseMatch, 'Brussels P2 2026', [], points)
    expect(card.servingTeam).toBe(2)
    expect(card.currentGame).toEqual({ pair1Score: '30', pair2Score: '40', isGoldenPoint: false })
  })

  it('orders points oldest-first regardless of input order', () => {
    const points: ShadowPointRow[] = [
      mkPoint({ set_number: 1, game_number: 2, point_number: 3, created_at: 't2' }),
      mkPoint({ set_number: 1, game_number: 1, point_number: 1, created_at: 't1' }),
    ]
    const card = buildLiveCard(baseMatch, 'T', [], points)
    expect(card.points.map(p => `${p.set}-${p.game}-${p.pt}`)).toEqual([
      '1-1-1', '1-2-3',
    ])
  })

  it('caps points at 50, keeping the most recent', () => {
    const points: ShadowPointRow[] = []
    for (let i = 1; i <= 60; i++) {
      points.push(mkPoint({ set_number: 1, game_number: 1, point_number: i }))
    }
    const card = buildLiveCard(baseMatch, 'T', [], points)
    expect(card.points).toHaveLength(50)
    // First entry should be point_number 11 (oldest of the kept 50)
    expect(card.points[0].pt).toBe(11)
    expect(card.points[49].pt).toBe(60)
  })

  it('hides servingTeam for finished matches', () => {
    const match: MatchRow = { ...baseMatch, status: 'finished' }
    const points = [mkPoint({ server_team: 1 })]
    const card = buildLiveCard(match, 'T', [], points)
    expect(card.status).toBe('finished')
    expect(card.servingTeam).toBeNull()
  })

  it('normalises status "ended" to "finished"', () => {
    const match: MatchRow = { ...baseMatch, status: 'ended' }
    const card = buildLiveCard(match, 'T', [], [])
    expect(card.status).toBe('finished')
  })

  it('passes scheduled status through untouched', () => {
    const match: MatchRow = { ...baseMatch, status: 'scheduled' }
    const card = buildLiveCard(match, 'T', [], [])
    expect(card.status).toBe('scheduled')
    expect(card.servingTeam).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'
import {
  parseScoreAfter,
  deriveLiveState,
  derivedSetScores,
  composeSets,
  computeMatchTiming,
  buildLiveCard,
  isRecentlyActive,
  LIVE_ACTIVITY_WINDOW_MS,
} from '../padelgod-live-cards'
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
  it('returns 0-0 / null server when no points', () => {
    expect(deriveLiveState([])).toEqual({
      pair1Score: '0', pair2Score: '0', isGoldenPoint: false, server: null,
    })
  })

  it('uses the latest point by (set, game, pt) and nests server', () => {
    const points: ShadowPointRow[] = [
      mkPoint({ set_number: 1, game_number: 1, point_number: 1, score_after: '15-0', server_team: 1 }),
      mkPoint({ set_number: 1, game_number: 2, point_number: 3, score_after: '30-40', server_team: 2 }),
    ]
    expect(deriveLiveState(points)).toEqual({
      pair1Score: '30', pair2Score: '40', isGoldenPoint: false, server: 'pair2',
    })
  })

  it('flags a golden-point correctly', () => {
    const points = [mkPoint({ score_after: '40-40', server_team: 1, is_golden_point: true })]
    expect(deriveLiveState(points)).toEqual({
      pair1Score: '40', pair2Score: '40', isGoldenPoint: true, server: 'pair1',
    })
  })

  it('server is null when server_team is null', () => {
    const points = [mkPoint({ server_team: null, score_after: '15-0' })]
    expect(deriveLiveState(points).server).toBeNull()
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

describe('derivedSetScores', () => {
  it('returns empty map for empty points', () => {
    expect(derivedSetScores([])).toEqual(new Map())
  })

  it('counts won games from latest point in each game, skipping the in-progress game', () => {
    // Set 1: 6 games, all won by pair1 (last point of each game won by pair1).
    // Set 2: in progress — game 1 only has 2 points played, latest won by pair2 — IGNORED.
    const points: ShadowPointRow[] = []
    for (let g = 1; g <= 6; g++) {
      points.push(mkPoint({ set_number: 1, game_number: g, point_number: 4, winner_pair: 1 }))
    }
    points.push(mkPoint({ set_number: 2, game_number: 1, point_number: 1, winner_pair: 1 }))
    points.push(mkPoint({ set_number: 2, game_number: 1, point_number: 2, winner_pair: 2 }))
    const result = derivedSetScores(points)
    expect(result.get(1)).toEqual({ pair1Games: 6, pair2Games: 0, winner: 'pair1' })
    // Set 2 has no completed games yet (the one in-progress game is excluded)
    expect(result.has(2)).toBe(false)
  })

  it('assigns winners only to SET that are done (not the latest set)', () => {
    // Set 1: pair1 wins games 1+2; pair2 wins games 3+4; set is "done" in the sense
    // that set 2 has started. Winner = whoever has more games (pair1 2 vs pair2 2 → tie,
    // in reality a set ends 6-x so a tie can't actually happen; test keeps logic simple).
    const points: ShadowPointRow[] = [
      // set 1, 4 completed games
      mkPoint({ set_number: 1, game_number: 1, point_number: 4, winner_pair: 1 }),
      mkPoint({ set_number: 1, game_number: 2, point_number: 4, winner_pair: 1 }),
      mkPoint({ set_number: 1, game_number: 3, point_number: 4, winner_pair: 2 }),
      mkPoint({ set_number: 1, game_number: 4, point_number: 4, winner_pair: 2 }),
      // set 1, game 5 is the latest (in-progress) — its winner is irrelevant
      mkPoint({ set_number: 2, game_number: 1, point_number: 1, winner_pair: 1 }),
    ]
    const result = derivedSetScores(points)
    // Set 1: 2-2, and because set 2 has started, set 1 is "done" → tie-break-free
    // winner is whichever pair has more games. In this synthetic case, both 2.
    // Implementation: winner = pair1Games > pair2Games ? 1 : 2 → pair2 when tied.
    expect(result.get(1)).toEqual({ pair1Games: 2, pair2Games: 2, winner: 'pair2' })
  })

  it('handles a real-world off-by-one scenario (padelgod missed the winning point)', () => {
    // Set 1: padelgod captured 7 games; last game's last point is won by pair1
    // (who was at "Ad"). Game 7 counts as pair1's win. pair1=6 games, pair2=1.
    // Set 2 has started, so set 1 is "done".
    const points: ShadowPointRow[] = []
    for (let g = 1; g <= 6; g++) {
      points.push(mkPoint({ set_number: 1, game_number: g, point_number: 4, winner_pair: 1 }))
    }
    points.push(mkPoint({ set_number: 1, game_number: 7, point_number: 7, winner_pair: 2, score_after: 'Ad-40' }))
    points.push(mkPoint({ set_number: 2, game_number: 1, point_number: 1, winner_pair: 1 }))
    const result = derivedSetScores(points)
    expect(result.get(1)?.pair1Games).toBe(6)
    expect(result.get(1)?.pair2Games).toBe(1)
    expect(result.get(1)?.winner).toBe('pair1')
  })
})

describe('composeSets', () => {
  it('returns empty array when no sets and no points', () => {
    expect(composeSets([], [])).toEqual([])
  })

  it('prefers shadow_sets counts over points-derived (real-world padelgod data has sparse point captures)', () => {
    // shadow_sets says 6-4 (valid final, no correction needed).
    // points-derived would say something way off because many games have only
    // 1-3 points captured and "last captured point winner" is wrong. We trust
    // the running counter — closer to truth — and treat points as a fallback.
    const sets = [mkSet({ set_number: 1, pair1_games: 6, pair2_games: 4 })]
    const points: ShadowPointRow[] = []
    // Simulate 10 games played, last-captured-point winners landing 3-7 the "wrong" way
    for (let g = 1; g <= 3; g++) {
      points.push(mkPoint({ set_number: 1, game_number: g, point_number: 3, winner_pair: 1 }))
    }
    for (let g = 4; g <= 10; g++) {
      points.push(mkPoint({ set_number: 1, game_number: g, point_number: 3, winner_pair: 2 }))
    }
    // Set 2 has started, so set 1 should be "done" with winner from shadow_sets counts.
    points.push(mkPoint({ set_number: 2, game_number: 1, point_number: 1, winner_pair: 1 }))
    const result = composeSets(sets, points)
    expect(result[0]).toEqual({ setNumber: 1, pair1Games: 6, pair2Games: 4, winner: 'pair1', isCurrent: false })
  })

  it('falls back to points-derived when a set is missing from shadow_sets', () => {
    // shadow_sets only has set 1. Set 2 exists in points only — use derived counts.
    const sets = [mkSet({ set_number: 1, pair1_games: 6, pair2_games: 3 })]
    const points: ShadowPointRow[] = [
      mkPoint({ set_number: 1, game_number: 1, point_number: 4, winner_pair: 1 }),
      mkPoint({ set_number: 2, game_number: 1, point_number: 4, winner_pair: 2 }),
      mkPoint({ set_number: 2, game_number: 2, point_number: 1, winner_pair: 2 }),
    ]
    const result = composeSets(sets, points)
    // Set 1: shadow_sets primary (6-3), winner derived from counts (pair1 wins)
    expect(result[0]).toEqual({ setNumber: 1, pair1Games: 6, pair2Games: 3, winner: 'pair1', isCurrent: false })
    // Set 2: no shadow_sets row → derived fallback (pair2=1), current
    expect(result[1]).toEqual({ setNumber: 2, pair1Games: 0, pair2Games: 1, winner: null, isCurrent: true })
  })

  it('returns shadow_sets values even when no points are available', () => {
    const sets = [mkSet({ set_number: 1, pair1_games: 6, pair2_games: 3 })]
    const result = composeSets(sets, [])
    expect(result).toEqual([{ setNumber: 1, pair1Games: 6, pair2Games: 3, winner: null, isCurrent: true }])
  })

  it('includes the in-progress set with isCurrent=true even if it has 0 completed games', () => {
    const points: ShadowPointRow[] = [
      mkPoint({ set_number: 1, game_number: 1, point_number: 4, winner_pair: 1 }),
      mkPoint({ set_number: 2, game_number: 1, point_number: 2, winner_pair: 1 }),
    ]
    const result = composeSets([], points)
    expect(result.length).toBe(2)
    expect(result[0]).toEqual({ setNumber: 1, pair1Games: 1, pair2Games: 0, winner: 'pair1', isCurrent: false })
    expect(result[1]).toEqual({ setNumber: 2, pair1Games: 0, pair2Games: 0, winner: null, isCurrent: true })
  })

  it('corrects impossible 6-5 final to 7-5 (padelgod missed the set-closing game)', () => {
    // Set 1 per shadow_sets: 6-5 (mathematically invalid as a final under
    // FIP rules — needs 2-game lead or 7-6 tiebreak). Set 2 has a point, so
    // set 1 is done → bump leader to 7.
    const sets = [
      mkSet({ set_number: 1, pair1_games: 6, pair2_games: 5 }),
      mkSet({ set_number: 2, pair1_games: 0, pair2_games: 1 }),
    ]
    const points = [mkPoint({ set_number: 2, game_number: 1, point_number: 1, winner_pair: 2 })]
    const result = composeSets(sets, points)
    expect(result[0]).toEqual({ setNumber: 1, pair1Games: 7, pair2Games: 5, winner: 'pair1', isCurrent: false })
    expect(result[1]).toEqual({ setNumber: 2, pair1Games: 0, pair2Games: 1, winner: null, isCurrent: true })
  })

  it('mirrors the correction for 5-6 (pair2 leading)', () => {
    const sets = [
      mkSet({ set_number: 1, pair1_games: 5, pair2_games: 6 }),
      mkSet({ set_number: 2, pair1_games: 1, pair2_games: 0 }),
    ]
    const points = [mkPoint({ set_number: 2, game_number: 1, point_number: 1, winner_pair: 1 })]
    const result = composeSets(sets, points)
    expect(result[0]).toEqual({ setNumber: 1, pair1Games: 5, pair2Games: 7, winner: 'pair2', isCurrent: false })
  })

  it('leaves the CURRENT set unchanged even when score reads 6-5 (it may still be ongoing)', () => {
    // A mid-set observation at 6-5 is normal (next game will decide). Don't
    // bump the current set — only finalise non-current sets.
    const sets = [mkSet({ set_number: 1, pair1_games: 6, pair2_games: 5 })]
    const result = composeSets(sets, [])
    expect(result[0]).toEqual({ setNumber: 1, pair1Games: 6, pair2Games: 5, winner: null, isCurrent: true })
  })

  it('leaves valid finals (6-4, 7-6) unchanged', () => {
    const sets = [
      mkSet({ set_number: 1, pair1_games: 6, pair2_games: 4 }),
      mkSet({ set_number: 2, pair1_games: 7, pair2_games: 6 }),
      mkSet({ set_number: 3, pair1_games: 1, pair2_games: 0 }),
    ]
    const points = [mkPoint({ set_number: 3, game_number: 1, point_number: 1, winner_pair: 1 })]
    const result = composeSets(sets, points)
    expect(result[0].pair1Games).toBe(6)
    expect(result[0].pair2Games).toBe(4)
    expect(result[0].winner).toBe('pair1')
    expect(result[1].pair1Games).toBe(7)
    expect(result[1].pair2Games).toBe(6)
    expect(result[1].winner).toBe('pair1')
  })
})

describe('computeMatchTiming', () => {
  const now = Date.parse('2026-04-21T12:30:00.000Z')

  it('returns null/null when no points', () => {
    expect(computeMatchTiming([], now, true)).toEqual({ startedAt: null, durationSec: null })
  })

  it('computes live duration against now', () => {
    const points = [
      mkPoint({ created_at: '2026-04-21T11:00:00.000Z' }), // 90 min ago
      mkPoint({ created_at: '2026-04-21T12:29:00.000Z' }), // 1 min ago (latest)
    ]
    const result = computeMatchTiming(points, now, true)
    expect(result.startedAt).toBe('2026-04-21T11:00:00.000Z')
    expect(result.durationSec).toBe(90 * 60) // 90 min = 5400s
  })

  it('computes finished duration against last point', () => {
    const points = [
      mkPoint({ created_at: '2026-04-21T11:00:00.000Z' }),
      mkPoint({ created_at: '2026-04-21T12:15:00.000Z' }), // 75 min after start
    ]
    const result = computeMatchTiming(points, now, false)
    expect(result.startedAt).toBe('2026-04-21T11:00:00.000Z')
    expect(result.durationSec).toBe(75 * 60)
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
  it('builds a live card with null server when points are empty', () => {
    const card = buildLiveCard(baseMatch, 'Brussels P2 2026', [], [])
    expect(card.status).toBe('live')
    expect(card.currentGame.server).toBeNull()
    expect(card.currentGame).toEqual({ pair1Score: '0', pair2Score: '0', isGoldenPoint: false, server: null })
    expect(card.sets).toEqual([])
    expect(card.points).toEqual([])
    expect(card.startedAt).toBeNull()
    expect(card.durationSec).toBeNull()
    expect(card.tournamentName).toBe('Brussels P2 2026')
    expect(card.pair1.player1).toEqual({ name: 'Coello', country: 'ESP' })
  })

  it('nests the server inside currentGame (no top-level servingTeam)', () => {
    const points: ShadowPointRow[] = [
      mkPoint({ set_number: 1, game_number: 1, point_number: 1, score_after: '15-0', server_team: 1 }),
      mkPoint({ set_number: 1, game_number: 2, point_number: 3, score_after: '30-40', server_team: 2 }),
    ]
    const card = buildLiveCard(baseMatch, 'Brussels P2 2026', [], points)
    expect(card.currentGame.server).toBe('pair2')
    expect(card.currentGame.pair1Score).toBe('30')
    expect(card.currentGame.pair2Score).toBe('40')
    expect('servingTeam' in card).toBe(false)
  })

  it('orders points oldest-first regardless of input order', () => {
    const points: ShadowPointRow[] = [
      mkPoint({ set_number: 1, game_number: 2, point_number: 3, created_at: '2026-04-21T11:02:00.000Z' }),
      mkPoint({ set_number: 1, game_number: 1, point_number: 1, created_at: '2026-04-21T11:01:00.000Z' }),
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
    expect(card.points[0].pt).toBe(11)
    expect(card.points[49].pt).toBe(60)
  })

  it('hides server for finished matches', () => {
    const match: MatchRow = { ...baseMatch, status: 'finished' }
    const points = [mkPoint({ server_team: 1 })]
    const card = buildLiveCard(match, 'T', [], points)
    expect(card.status).toBe('finished')
    expect(card.currentGame.server).toBeNull()
  })

  it('normalises status "ended" to "finished"', () => {
    const match: MatchRow = { ...baseMatch, status: 'ended' }
    const card = buildLiveCard(match, 'T', [], [])
    expect(card.status).toBe('finished')
  })

  it('passes scheduled status through untouched when no points', () => {
    const match: MatchRow = { ...baseMatch, status: 'scheduled' }
    const card = buildLiveCard(match, 'T', [], [])
    expect(card.status).toBe('scheduled')
    expect(card.currentGame.server).toBeNull()
    expect(card.startedAt).toBeNull()
    expect(card.durationSec).toBeNull()
  })

  it('treats a "scheduled" match with RECENT shadow activity as live', () => {
    const now = Date.parse('2026-04-21T12:00:00.000Z')
    const match: MatchRow = { ...baseMatch, status: 'scheduled' }
    const points = [mkPoint({
      server_team: 2,
      score_after: '40-30',
      created_at: '2026-04-21T11:59:00.000Z',
    })]
    const card = buildLiveCard(match, 'T', [], points, now)
    expect(card.status).toBe('live')
    expect(card.currentGame.server).toBe('pair2')
    expect(card.currentGame.pair1Score).toBe('40')
    expect(card.currentGame.pair2Score).toBe('30')
  })

  it('leaves a "scheduled" match with STALE shadow activity as scheduled', () => {
    const now = Date.parse('2026-04-21T12:00:00.000Z')
    const match: MatchRow = { ...baseMatch, status: 'scheduled' }
    const points = [mkPoint({
      server_team: 1,
      created_at: '2026-04-21T11:40:00.000Z',
    })]
    const card = buildLiveCard(match, 'T', [], points, now)
    expect(card.status).toBe('scheduled')
    expect(card.currentGame.server).toBeNull()
  })

  it('does NOT resurrect a finished match even with recent activity', () => {
    const now = Date.parse('2026-04-21T12:00:00.000Z')
    const match: MatchRow = { ...baseMatch, status: 'finished' }
    const points = [mkPoint({
      server_team: 1,
      created_at: '2026-04-21T11:59:00.000Z',
    })]
    const card = buildLiveCard(match, 'T', [], points, now)
    expect(card.status).toBe('finished')
    expect(card.currentGame.server).toBeNull()
  })

  it('populates startedAt and durationSec from captured points', () => {
    const now = Date.parse('2026-04-21T12:00:00.000Z')
    const match: MatchRow = { ...baseMatch, status: 'live' }
    const points = [
      mkPoint({ set_number: 1, game_number: 1, point_number: 1, created_at: '2026-04-21T11:30:00.000Z' }),
      mkPoint({ set_number: 1, game_number: 1, point_number: 2, created_at: '2026-04-21T11:58:00.000Z' }),
    ]
    const card = buildLiveCard(match, 'T', [], points, now)
    expect(card.startedAt).toBe('2026-04-21T11:30:00.000Z')
    expect(card.durationSec).toBe(30 * 60) // 30 min
  })

  it('marks set winners from shadow_sets counts when a later set has started', () => {
    // shadow_sets reports pair1=6, pair2=3 for set 1; set 2 started (has point)
    // → set 1 is done, winner derived from counts as pair 1.
    const shadowSets: ShadowSetRow[] = [mkSet({ set_number: 1, pair1_games: 6, pair2_games: 3 })]
    const points: ShadowPointRow[] = [
      mkPoint({ set_number: 2, game_number: 1, point_number: 1, winner_pair: 1 }),
    ]
    const match: MatchRow = { ...baseMatch, status: 'live' }
    const card = buildLiveCard(match, 'T', shadowSets, points)
    const set1 = card.sets.find(s => s.setNumber === 1)!
    expect(set1.pair1Games).toBe(6)
    expect(set1.pair2Games).toBe(3)
    expect(set1.winner).toBe('pair1')
    expect(set1.isCurrent).toBe(false)
  })
})

describe('isRecentlyActive', () => {
  const now = Date.parse('2026-04-21T12:00:00.000Z')

  it('returns false for empty points array', () => {
    expect(isRecentlyActive([], now)).toBe(false)
  })

  it('returns true when the latest point is within the window', () => {
    const points = [
      mkPoint({ created_at: '2026-04-21T11:50:00.000Z' }),
      mkPoint({ created_at: '2026-04-21T11:58:00.000Z' }),
    ]
    expect(isRecentlyActive(points, now)).toBe(true)
  })

  it('returns false when even the latest point is outside the window', () => {
    const points = [mkPoint({ created_at: '2026-04-21T11:54:00.000Z' })]
    expect(isRecentlyActive(points, now)).toBe(false)
  })

  it('respects a custom window', () => {
    const points = [mkPoint({ created_at: '2026-04-21T11:54:00.000Z' })]
    expect(isRecentlyActive(points, now, 10 * 60 * 1000)).toBe(true)
    expect(isRecentlyActive(points, now, 60 * 1000)).toBe(false)
  })

  it('exposes the default window as 5 minutes', () => {
    expect(LIVE_ACTIVITY_WINDOW_MS).toBe(5 * 60 * 1000)
  })
})

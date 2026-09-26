import { describe, it, expect } from 'vitest'
import { sideOf, viewTie, viewTies, totalsFrom, type TieInput } from '../ppl-team'

// The flip is the dangerous part. Storage is home-first for the winner code,
// the player lists AND the set scores; a franchise page shows roughly half
// its ties from the away side. A partial flip does not throw — it prints a
// loss as a win, or our players beside their score.

const tie = (over: Partial<TieInput> = {}): TieInput => ({
  tieId: 't1',
  tournamentId: 'ev1',
  stage: 'Group Stage',
  scheduledAt: '2026-08-13T23:00:00.000Z',
  homeSeasonId: 'HOME',
  awaySeasonId: 'AWAY',
  matches: [
    {
      matchId: 'm-men',
      category: 'men',
      winnerPair: 1,
      homePlayerIds: ['h1', 'h2'],
      awayPlayerIds: ['a1', 'a2'],
      sets: [{ home: 6, away: 3 }, { home: 6, away: 4 }],
    },
    {
      matchId: 'm-women',
      category: 'women',
      winnerPair: 2,
      homePlayerIds: ['h3', 'h4'],
      awayPlayerIds: ['a3', 'a4'],
      sets: [{ home: 2, away: 6 }, { home: 4, away: 6 }],
    },
  ],
  ...over,
})

describe('sideOf', () => {
  it('finds the season on either side', () => {
    expect(sideOf(tie(), 'HOME')).toBe('home')
    expect(sideOf(tie(), 'AWAY')).toBe('away')
  })

  it('returns null for a season on neither side, rather than defaulting', () => {
    // A default of 'home' would render someone else's tie under our badge.
    expect(sideOf(tie(), 'SOMEONE-ELSE')).toBeNull()
  })
})

describe('viewTie — the home side', () => {
  const v = viewTie(tie(), 'HOME')!

  it('keeps everything as stored', () => {
    expect(v.side).toBe('home')
    expect(v.opponentSeasonId).toBe('AWAY')
    expect(v.ourCourts).toBe(1)
    expect(v.theirCourts).toBe(1)
    expect(v.result).toBe('D')
  })

  it('keeps our players and our set scores first', () => {
    expect(v.courts[0].ourPlayerIds).toEqual(['h1', 'h2'])
    expect(v.courts[0].sets).toEqual([{ ours: 6, theirs: 3 }, { ours: 6, theirs: 4 }])
  })
})

describe('viewTie — the away side', () => {
  const v = viewTie(tie(), 'AWAY')!

  it('inverts the result', () => {
    // Same stored tie: home won the men's, away won the women's.
    expect(v.courts[0].result).toBe('L')
    expect(v.courts[1].result).toBe('W')
  })

  it('inverts the players', () => {
    expect(v.courts[0].ourPlayerIds).toEqual(['a1', 'a2'])
    expect(v.courts[0].theirPlayerIds).toEqual(['h1', 'h2'])
  })

  it('inverts the set scores IN STEP with the players', () => {
    // The specific failure this guards: our players beside their games. The
    // men's court was 6-3 6-4 to home, so from away it must read 3-6 4-6.
    expect(v.courts[0].sets).toEqual([{ ours: 3, theirs: 6 }, { ours: 4, theirs: 6 }])
    expect(v.courts[1].sets).toEqual([{ ours: 6, theirs: 2 }, { ours: 6, theirs: 4 }])
  })

  it('names the opponent as the other side', () => {
    expect(v.opponentSeasonId).toBe('HOME')
  })
})

describe('viewTie — results', () => {
  const winners = (a: 1 | 2 | null, b: 1 | 2 | null) =>
    tie({ matches: tie().matches.map((m, i) => ({ ...m, winnerPair: i === 0 ? a : b })) })

  it('is a win when we take more courts', () => {
    expect(viewTie(winners(1, 1), 'HOME')!.result).toBe('W')
    expect(viewTie(winners(1, 1), 'AWAY')!.result).toBe('L')
  })

  it('is a draw at one court each — the common PPL shape', () => {
    expect(viewTie(winners(1, 2), 'HOME')!.result).toBe('D')
    expect(viewTie(winners(1, 2), 'AWAY')!.result).toBe('D')
  })

  it('has NO result when nothing is decided — not a draw', () => {
    // An upcoming fixture must not render as already drawn.
    const v = viewTie(winners(null, null), 'HOME')!
    expect(v.result).toBeNull()
    expect(v.ourCourts).toBe(0)
  })

  it('decides on the played courts when a tie is half-finished', () => {
    expect(viewTie(winners(1, null), 'HOME')!.result).toBe('W')
  })

  it('returns null for a tie we are not in', () => {
    expect(viewTie(tie(), 'OTHER')).toBeNull()
  })
})

describe('viewTies', () => {
  it('drops ties the franchise is not part of', () => {
    const mine = tie({ tieId: 'mine' })
    const theirs = tie({ tieId: 'theirs', homeSeasonId: 'X', awaySeasonId: 'Y' })
    expect(viewTies([mine, theirs], 'HOME').map(v => v.tieId)).toEqual(['mine'])
  })

  it('orders newest first', () => {
    const older = tie({ tieId: 'older', scheduledAt: '2026-07-09T17:00:00.000Z' })
    const newer = tie({ tieId: 'newer', scheduledAt: '2026-08-13T17:00:00.000Z' })
    expect(viewTies([older, newer], 'HOME').map(v => v.tieId)).toEqual(['newer', 'older'])
  })

  it('sorts undated ties last, not first', () => {
    // An undated tie is usually a podium slot whose pairing is not yet known.
    // String-comparing a null date would hoist it above every played tie.
    const dated = tie({ tieId: 'dated' })
    const undated = tie({ tieId: 'undated', scheduledAt: null })
    expect(viewTies([undated, dated], 'HOME').map(v => v.tieId)).toEqual(['dated', 'undated'])
  })
})

describe('totalsFrom', () => {
  it('counts only decided ties', () => {
    const played = tie({ tieId: 'p' })
    const upcoming = tie({
      tieId: 'u',
      matches: tie().matches.map(m => ({ ...m, winnerPair: null })),
    })
    const t = totalsFrom(viewTies([played, upcoming], 'HOME'))
    expect(t.tiesPlayed).toBe(1)
  })

  it('agrees with the rows it was derived from', () => {
    // The point of deriving totals rather than reading team_seasons: the
    // strip and the list below it cannot disagree on screen.
    const views = viewTies([
      tie({ tieId: 'a', matches: tie().matches.map(m => ({ ...m, winnerPair: 1 })) }),
      tie({ tieId: 'b', matches: tie().matches.map(m => ({ ...m, winnerPair: 2 })) }),
    ], 'HOME')
    const t = totalsFrom(views)
    expect(t).toEqual({ tiesPlayed: 2, tiesWon: 1, courtsWon: 2, courtsLost: 2 })
    expect(t.courtsWon).toBe(views.reduce((n, v) => n + v.ourCourts, 0))
  })

  it('is all zeroes for a franchise with nothing played', () => {
    expect(totalsFrom([])).toEqual({ tiesPlayed: 0, tiesWon: 0, courtsWon: 0, courtsLost: 0 })
  })
})

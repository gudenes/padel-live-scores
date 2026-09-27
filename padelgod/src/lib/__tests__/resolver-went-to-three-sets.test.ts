import { describe, it, expect } from 'vitest'
import { matchWentToThreeSets } from '../market-resolvers/went-to-three-sets.js'
import type { ResolverContext } from '../market-resolvers/types.js'

interface SetRow {
  set_number: number
  pair1_games: number | null
  pair2_games: number | null
  set_score?: string | null
}

/** matches → maybeSingle(); sets → order() awaited directly. */
function stubSupabase(match: Record<string, unknown> | null, sets: SetRow[]) {
  const from = (table: string) => {
    if (table === 'matches') {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: match, error: null }),
      }
      return chain
    }
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: async () => ({ data: sets, error: null }),
    }
    return chain
  }
  return { from } as never
}

function ctx(status: string | null, sets: SetRow[], matchExists = true): ResolverContext {
  return {
    supabase: stubSupabase(matchExists ? { status } : null, sets),
    marketId: 'm1',
    matchId: 'match-1',
    tournamentId: null,
    category: 'women',
    tokens: {},
    now: new Date('2026-09-26T20:00:00Z'),
  }
}

const set = (n: number, a: number | null, b: number | null, score?: string | null): SetRow => ({
  set_number: n, pair1_games: a, pair2_games: b, set_score: score ?? null,
})

describe('match.went_to_three_sets', () => {
  it('resolves YES on a completed three-setter', async () => {
    const r = await matchWentToThreeSets(
      ctx('finished', [set(1, 6, 4), set(2, 3, 6), set(3, 6, 2)]), {},
    )
    expect(r.state).toBe('decided')
    if (r.state === 'decided') {
      expect(r.outcome).toBe(true)
      expect(r.evidence.decider_set).toBe(3)
    }
  })

  it('resolves NO on a straight-sets win', async () => {
    const r = await matchWentToThreeSets(ctx('finished', [set(1, 6, 4), set(2, 6, 2)]), {})
    expect(r.state).toBe('decided')
    if (r.state === 'decided') {
      expect(r.outcome).toBe(false)
      expect(r.evidence.decider_set).toBeNull()
    }
  })

  it('counts by set NUMBER, so a missing set-2 row cannot hide a decider', async () => {
    const r = await matchWentToThreeSets(ctx('finished', [set(1, 6, 4), set(3, 6, 2)]), {})
    expect(r.state).toBe('decided')
    if (r.state === 'decided') expect(r.outcome).toBe(true)
  })

  it('is undecided while the match is still being played', async () => {
    expect(await matchWentToThreeSets(ctx('live', [set(1, 6, 4), set(2, 4, 5)]), {}))
      .toEqual({ state: 'undecided' })
    expect(await matchWentToThreeSets(ctx('on_court', [set(1, 2, 1)]), {}))
      .toEqual({ state: 'undecided' })
    // 'ended' is transitional — the scoreline can still be rewritten.
    expect(await matchWentToThreeSets(ctx('ended', [set(1, 6, 4), set(2, 6, 1)]), {}))
      .toEqual({ state: 'undecided' })
  })

  it('does not count a 0-0 third-set placeholder as a decider', async () => {
    // The live poller upserts the current set the instant it becomes current.
    const r = await matchWentToThreeSets(
      ctx('finished', [set(1, 6, 4), set(2, 6, 2), set(3, 0, 0)]), {},
    )
    expect(r.state).toBe('decided')
    if (r.state === 'decided') expect(r.outcome).toBe(false)
  })

  // ── The truncation rule ─────────────────────────────────────────────
  //
  // Reaching a third set is a fact a retirement cannot undo. NOT reaching one
  // is only a fact about a match that was allowed to finish — which is why a
  // retirement in set 2 is NOT the same event as a straight-sets win.

  it('DECIDES YES when the retirement happened INSIDE the third set', async () => {
    const r = await matchWentToThreeSets(
      ctx('retired', [set(1, 6, 4), set(2, 3, 6), set(3, 2, 1)]), {},
    )
    expect(r.state).toBe('decided')
    if (r.state === 'decided') {
      expect(r.outcome).toBe(true)
      expect(r.evidence.status).toBe('retired')
    }
  })

  it('VOIDS a retirement in set 2 rather than settling NO', async () => {
    // A third set was still a live possibility when play stopped. Settling NO
    // would hand NO-holders a win the match never tested.
    const r = await matchWentToThreeSets(ctx('retired', [set(1, 6, 4), set(2, 2, 1)]), {})
    expect(r.state).toBe('void')
    if (r.state === 'void') expect(r.reason).toMatch(/retired/)
  })

  it('VOIDS a retirement in set 1', async () => {
    expect((await matchWentToThreeSets(ctx('retired', [set(1, 3, 2)]), {})).state).toBe('void')
  })

  it('VOIDS a walkover — nobody played a set at all', async () => {
    expect((await matchWentToThreeSets(ctx('walkover', []), {})).state).toBe('void')
  })

  it('VOIDS a cancelled match', async () => {
    expect((await matchWentToThreeSets(ctx('cancelled', []), {})).state).toBe('void')
  })

  it('voids when the match row has vanished', async () => {
    expect((await matchWentToThreeSets(ctx('finished', [], false), {})).state).toBe('void')
  })

  // ── Incomplete data must never become a NO ──────────────────────────

  it('is undecided when a finished match has no set rows yet', async () => {
    expect(await matchWentToThreeSets(ctx('finished', []), {})).toEqual({ state: 'undecided' })
  })

  it('is undecided when only one set has landed on a finished match', async () => {
    expect(await matchWentToThreeSets(ctx('finished', [set(1, 6, 4)]), {}))
      .toEqual({ state: 'undecided' })
  })

  it('is undecided on a 1-1 split with no third set row', async () => {
    // Two sets, one each. A best-of-three cannot END there — the decider row is
    // missing from the table, not from the match. Answering NO would be wrong
    // in exactly the cases this market cares about most.
    expect(await matchWentToThreeSets(ctx('finished', [set(1, 6, 4), set(2, 3, 6)]), {}))
      .toEqual({ state: 'undecided' })
  })

  it('still decides YES from an incomplete scoreline that already shows a set 3', async () => {
    // The completeness guard only protects the NO answer.
    const r = await matchWentToThreeSets(ctx('finished', [set(3, 6, 2)]), {})
    expect(r.state).toBe('decided')
    if (r.state === 'decided') expect(r.outcome).toBe(true)
  })
})

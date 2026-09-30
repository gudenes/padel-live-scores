import { describe, it, expect } from 'vitest'
import { matchAnySetBagel } from '../market-resolvers/any-set-bagel.js'
import type { ResolverContext } from '../market-resolvers/types.js'

interface SetRow {
  set_number: number
  pair1_games: number | null
  pair2_games: number | null
  set_score?: string | null
}

/**
 * Supabase stub serving two different shapes:
 *   matches → .select().eq().maybeSingle()
 *   sets    → .select().eq().order()   (awaited directly)
 */
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
    category: 'men',
    tokens: {},
    now: new Date('2026-09-26T20:00:00Z'),
  }
}

const set = (n: number, a: number | null, b: number | null, score?: string | null): SetRow => ({
  set_number: n, pair1_games: a, pair2_games: b, set_score: score ?? null,
})

describe('match.any_set_bagel', () => {
  it('resolves YES when a set finished 6-0', async () => {
    const r = await matchAnySetBagel(ctx('finished', [set(1, 6, 0), set(2, 6, 3)]), {})
    expect(r.state).toBe('decided')
    if (r.state === 'decided') {
      expect(r.outcome).toBe(true)
      expect(r.evidence.bagel_sets).toEqual([1])
    }
  })

  it('resolves YES on a 0-6 too — either side being bagelled counts', async () => {
    const r = await matchAnySetBagel(ctx('finished', [set(1, 4, 6), set(2, 0, 6)]), {})
    if (r.state === 'decided') expect(r.outcome).toBe(true)
    else throw new Error(`expected decided, got ${r.state}`)
  })

  it('resolves NO on a completed match with no bagel', async () => {
    const r = await matchAnySetBagel(ctx('finished', [set(1, 6, 4), set(2, 7, 5)]), {})
    expect(r.state).toBe('decided')
    if (r.state === 'decided') expect(r.outcome).toBe(false)
  })

  it('resolves NO across a full three-setter with no bagel', async () => {
    const r = await matchAnySetBagel(
      ctx('finished', [set(1, 6, 4), set(2, 3, 6), set(3, 7, 6, '7-6(4)')]), {},
    )
    expect(r.state).toBe('decided')
    if (r.state === 'decided') expect(r.outcome).toBe(false)
  })

  it('prefers set_score over pair*_games — the live poller loses closing ticks', async () => {
    // A real 6-0 left at 5-0 by a dropped tick, with the results writer's
    // authoritative text in place. Reading games first would answer NO.
    const r = await matchAnySetBagel(ctx('finished', [set(1, 5, 0, '6-0'), set(2, 6, 2)]), {})
    expect(r.state).toBe('decided')
    if (r.state === 'decided') expect(r.outcome).toBe(true)
  })

  it('is undecided while the match is still being played', async () => {
    expect(await matchAnySetBagel(ctx('live', [set(1, 6, 0), set(2, 0, 0)]), {}))
      .toEqual({ state: 'undecided' })
    expect(await matchAnySetBagel(ctx('on_court', [set(1, 0, 0)]), {}))
      .toEqual({ state: 'undecided' })
    // 'ended' is the transitional status; the score may still be rewritten.
    expect(await matchAnySetBagel(ctx('ended', [set(1, 6, 0), set(2, 6, 1)]), {}))
      .toEqual({ state: 'undecided' })
  })

  it('does not read a 0-0 placeholder set as a bagel', async () => {
    // The live poller upserts the current set from 0-0 upwards.
    const r = await matchAnySetBagel(ctx('finished', [set(1, 6, 4), set(2, 6, 2), set(3, 0, 0)]), {})
    expect(r.state).toBe('decided')
    if (r.state === 'decided') expect(r.outcome).toBe(false)
  })

  it('does not read an abandoned 3-0 set as a bagel', async () => {
    // Retired mid-set-2 at 3-0. No set FINISHED 6-0.
    const r = await matchAnySetBagel(ctx('retired', [set(1, 6, 4), set(2, 3, 0)]), {})
    expect(r.state).toBe('void')
  })

  // ── The truncation rule ─────────────────────────────────────────────
  //
  // YES is a fact a retirement cannot undo; NO is only a fact about a match
  // that was allowed to finish.

  it('DECIDES YES on a retirement when the bagel already happened', async () => {
    const r = await matchAnySetBagel(ctx('retired', [set(1, 6, 0), set(2, 2, 1)]), {})
    expect(r.state).toBe('decided')
    if (r.state === 'decided') {
      expect(r.outcome).toBe(true)
      expect(r.evidence.status).toBe('retired')
    }
  })

  it('VOIDS a retirement with no bagel — the unplayed sets never got a chance', async () => {
    const r = await matchAnySetBagel(ctx('retired', [set(1, 6, 4), set(2, 2, 1)]), {})
    expect(r.state).toBe('void')
    if (r.state === 'void') expect(r.reason).toMatch(/retired/)
  })

  it('VOIDS a walkover — nobody played a set at all', async () => {
    expect((await matchAnySetBagel(ctx('walkover', []), {})).state).toBe('void')
  })

  it('VOIDS a cancelled match', async () => {
    expect((await matchAnySetBagel(ctx('cancelled', []), {})).state).toBe('void')
  })

  it('voids when the match row has vanished', async () => {
    expect((await matchAnySetBagel(ctx('finished', [], false), {})).state).toBe('void')
  })

  // ── Incomplete data must never become a NO ──────────────────────────

  it('is undecided when a finished match has no set rows yet', async () => {
    // The results writers fill `sets` AFTER matches.status flips to finished.
    expect(await matchAnySetBagel(ctx('finished', []), {})).toEqual({ state: 'undecided' })
  })

  it('is undecided when only one set has landed on a finished match', async () => {
    expect(await matchAnySetBagel(ctx('finished', [set(1, 6, 4)]), {}))
      .toEqual({ state: 'undecided' })
  })

  it('is undecided on a 1-1 split with no third set row — the row is missing', async () => {
    // Two sets, one each, and no decider recorded. That is a half-written
    // scoreline, not a straight-sets win; answering NO here could settle wrong.
    expect(await matchAnySetBagel(ctx('finished', [set(1, 6, 4), set(2, 3, 6)]), {}))
      .toEqual({ state: 'undecided' })
  })

  it('still decides YES from a half-written scoreline that already shows a 6-0', async () => {
    // The completeness guard only protects the NO answer.
    const r = await matchAnySetBagel(ctx('finished', [set(1, 6, 0)]), {})
    expect(r.state).toBe('decided')
    if (r.state === 'decided') expect(r.outcome).toBe(true)
  })

  it('ignores a set row whose game counts are null', async () => {
    const r = await matchAnySetBagel(ctx('finished', [set(1, null, null), set(2, 6, 0)]), {})
    expect(r.state).toBe('decided')
    if (r.state === 'decided') expect(r.outcome).toBe(true)
  })
})

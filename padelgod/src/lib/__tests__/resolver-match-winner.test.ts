import { describe, it, expect } from 'vitest'
import { matchWinnerIsPair } from '../market-resolvers/match-winner.js'
import type { ResolverContext } from '../market-resolvers/types.js'

/** Minimal Supabase stub: supports .select().eq().maybeSingle() */
function stubSupabase(row: Record<string, unknown> | null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: row, error: null }),
  }
  return { from: () => chain } as never
}

function ctx(row: Record<string, unknown> | null): ResolverContext {
  return {
    supabase: stubSupabase(row),
    marketId: 'm1',
    matchId: 'match-1',
    tournamentId: null,
    category: 'men',
    tokens: {},
    now: new Date('2026-09-23T18:00:00Z'),
  }
}

describe('match.winner_is_pair', () => {
  it('resolves YES when the bound pair won', async () => {
    const r = await matchWinnerIsPair(ctx({ status: 'finished', winner_pair: 1 }), { pair: 1 })
    expect(r).toEqual({
      state: 'decided',
      outcome: true,
      evidence: { status: 'finished', winner_pair: 1, asked_pair: 1 },
    })
  })

  it('resolves NO when the other pair won', async () => {
    const r = await matchWinnerIsPair(ctx({ status: 'finished', winner_pair: 2 }), { pair: 1 })
    expect(r.state).toBe('decided')
    if (r.state === 'decided') expect(r.outcome).toBe(false)
  })

  it('is undecided while the match is still live', async () => {
    const r = await matchWinnerIsPair(ctx({ status: 'live', winner_pair: null }), { pair: 1 })
    expect(r).toEqual({ state: 'undecided' })
  })

  it('is undecided when finished but the winner has not landed yet', async () => {
    const r = await matchWinnerIsPair(ctx({ status: 'finished', winner_pair: null }), { pair: 1 })
    expect(r).toEqual({ state: 'undecided' })
  })

  it('voids a walkover — nobody played, so no pick was meaningful', async () => {
    const r = await matchWinnerIsPair(ctx({ status: 'walkover', winner_pair: 1 }), { pair: 1 })
    expect(r.state).toBe('void')
  })

  it('DECIDES a retirement — a retired match has a real winner', async () => {
    const r = await matchWinnerIsPair(ctx({ status: 'retired', winner_pair: 2 }), { pair: 2 })
    expect(r.state).toBe('decided')
    if (r.state === 'decided') expect(r.outcome).toBe(true)
  })

  it('voids when the match row has vanished', async () => {
    const r = await matchWinnerIsPair(ctx(null), { pair: 1 })
    expect(r.state).toBe('void')
  })

  it('throws on a malformed pair param rather than guessing', async () => {
    await expect(
      matchWinnerIsPair(ctx({ status: 'finished', winner_pair: 1 }), { pair: 3 }),
    ).rejects.toThrow(/pair/i)
  })
})

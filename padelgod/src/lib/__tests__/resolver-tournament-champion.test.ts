import { describe, it, expect } from 'vitest'
import { tournamentChampionIsPair } from '../market-resolvers/tournament-champion.js'
import type { ResolverContext } from '../market-resolvers/types.js'

/** Stub returning a list from .select().eq().eq().eq() then awaited. */
function stubSupabase(rows: Record<string, unknown>[]) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    then: (res: (v: unknown) => unknown) => res({ data: rows, error: null }),
  }
  return { from: () => chain } as never
}

function ctx(rows: Record<string, unknown>[]): ResolverContext {
  return {
    supabase: stubSupabase(rows),
    marketId: 'm1',
    matchId: null,
    tournamentId: 'tour-1',
    category: 'men',
    tokens: { pair_key: 'p1::p2' },
    now: new Date('2026-09-23T18:00:00Z'),
  }
}

const PAIR = { player1Id: 'p1', player2Id: 'p2' }

describe('tournament.champion_is_pair', () => {
  it('is undecided while no final exists yet', async () => {
    expect(await tournamentChampionIsPair(ctx([]), PAIR)).toEqual({ state: 'undecided' })
  })

  it('is undecided when the final exists but has no winner', async () => {
    const r = await tournamentChampionIsPair(ctx([{
      id: 'f1', status: 'live', winner_pair: null,
      pair1_player1_id: 'p1', pair1_player2_id: 'p2',
      pair2_player1_id: 'p3', pair2_player2_id: 'p4',
    }]), PAIR)
    expect(r).toEqual({ state: 'undecided' })
  })

  it('resolves YES when the bound pair won the final', async () => {
    const r = await tournamentChampionIsPair(ctx([{
      id: 'f1', status: 'finished', winner_pair: 1,
      pair1_player1_id: 'p1', pair1_player2_id: 'p2',
      pair2_player1_id: 'p3', pair2_player2_id: 'p4',
    }]), PAIR)
    expect(r.state).toBe('decided')
    if (r.state === 'decided') expect(r.outcome).toBe(true)
  })

  it('matches a pair regardless of player order within the pair', async () => {
    const r = await tournamentChampionIsPair(ctx([{
      id: 'f1', status: 'finished', winner_pair: 2,
      pair1_player1_id: 'p3', pair1_player2_id: 'p4',
      pair2_player1_id: 'p2', pair2_player2_id: 'p1',
    }]), PAIR)
    expect(r.state).toBe('decided')
    if (r.state === 'decided') expect(r.outcome).toBe(true)
  })

  it('resolves NO when a different pair won', async () => {
    const r = await tournamentChampionIsPair(ctx([{
      id: 'f1', status: 'finished', winner_pair: 1,
      pair1_player1_id: 'p3', pair1_player2_id: 'p4',
      pair2_player1_id: 'p5', pair2_player2_id: 'p6',
    }]), PAIR)
    expect(r.state).toBe('decided')
    if (r.state === 'decided') expect(r.outcome).toBe(false)
  })

  it('voids when more than one final is present — the draw is ambiguous', async () => {
    const final = {
      status: 'finished', winner_pair: 1,
      pair1_player1_id: 'p1', pair1_player2_id: 'p2',
      pair2_player1_id: 'p3', pair2_player2_id: 'p4',
    }
    const r = await tournamentChampionIsPair(ctx([{ id: 'f1', ...final }, { id: 'f2', ...final }]), PAIR)
    expect(r.state).toBe('void')
  })

  it('throws when the pair params are missing', async () => {
    await expect(tournamentChampionIsPair(ctx([]), {})).rejects.toThrow(/player/i)
  })
})

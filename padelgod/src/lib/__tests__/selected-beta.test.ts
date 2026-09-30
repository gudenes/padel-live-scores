import { describe, it, expect } from 'vitest'
import { pairReachesRound, otherPairWinsTournament, pairTitleCount, playerReachesRanking } from '../market-resolvers/selected-beta.js'
import type { ResolverContext } from '../market-resolvers/types.js'
const p = { player1Id: 'a', player2Id: 'b', voidAfter: '2026-12-08T00:00:00Z' }
const final = { id: 'f', tournament_id: 't1', round_canonical: 'F', status: 'finished', winner_pair: 1,
  pair1_player1_id: 'b', pair1_player2_id: 'a', pair2_player1_id: 'c', pair2_player2_id: 'd' }
function ctx(rows: object[], now = '2026-12-01T00:00:00Z', error: string | null = null): ResolverContext {
  const chain: Record<string, unknown> = {}
  for (const key of ['select', 'in', 'eq', 'gte', 'lte', 'limit']) chain[key] = () => chain
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: error && { message: error } })
  return { supabase: { from: () => chain } as never, marketId: 'm', matchId: null,
    tournamentId: 't1', category: 'men', tokens: {}, now: new Date(now) }
}
describe('selected beta settlement', () => {
  it('does not treat a scheduled semifinal or walkover as participation', async () => {
    for (const status of ['scheduled', 'walkover']) expect(await pairReachesRound(ctx([{ ...final, round_canonical: 'SF', status }]), { ...p, round: 'SF' })).toEqual({ state: 'undecided' })
  })
  it('recognises a reversed pair once the target round starts', async () => {
    expect(await pairReachesRound(ctx([{ ...final, round_canonical: 'SF', status: 'live' }]), { ...p, round: 'SF' })).toMatchObject({ state: 'decided', outcome: true })
  })
  it('settles elimination before the target round as NO', async () => {
    expect(await pairReachesRound(ctx([{ ...final, round_canonical: 'QF', winner_pair: 2 }]), { ...p, round: 'SF' })).toMatchObject({ state: 'decided', outcome: false })
  })
  it('does not choose between conflicting advancement and elimination evidence', async () => {
    expect(await pairReachesRound(ctx([final, { ...final, id: 'q', round_canonical: 'QF', winner_pair: 2 }]), { ...p, round: 'SF' })).toEqual({ state: 'undecided' })
  })
  it('inverts only a known final winner', async () => {
    expect(await otherPairWinsTournament(ctx([final]), p)).toMatchObject({ outcome: false })
    expect(await otherPairWinsTournament(ctx([{ ...final, winner_pair: 2 }]), p)).toMatchObject({ outcome: true })
    expect(await otherPairWinsTournament(ctx([{ ...final, pair1_player1_id: null }]), p)).toEqual({ state: 'undecided' })
  })
  const season = { ...p, tournamentIds: ['t1', 't2', 't3'], titles: 2, minimumStarts: 3, endsAt: '2026-11-30T23:59:59Z' }
  it('counts distinct tournament titles and resolves YES early', async () => {
    expect(await pairTitleCount(ctx([final, { ...final, id: 'f2', tournament_id: 't2' }]), season)).toMatchObject({ outcome: true })
  })
  it('does not count duplicate finals as two titles', async () => {
    expect(await pairTitleCount(ctx([final, { ...final, id: 'duplicate' }]), season)).toEqual({ state: 'undecided' })
  })
  it('requires all event results and minimum participation before NO', async () => {
    expect(await pairTitleCount(ctx([final]), season)).toEqual({ state: 'undecided' })
    const rows = ['t1', 't2', 't3'].map(tournament_id => ({ ...final, id: tournament_id, tournament_id, winner_pair: 2 }))
    expect(await pairTitleCount(ctx(rows), season)).toMatchObject({ outcome: false })
    expect(await pairTitleCount(ctx(rows, '2026-11-01T00:00:00Z'), season)).toEqual({ state: 'undecided' })
  })
  it('refunds unresolved scope after the review deadline', async () => {
    expect(await pairTitleCount(ctx([], '2026-12-09T00:00:00Z'), season)).toMatchObject({ state: 'void' })
  })
  const ranking = { playerId: 'javi', rank: 12, startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-11-30T23:59:59Z', voidAfter: p.voidAfter }
  it('settles a recorded ranking hit and rejects conflicting snapshots', async () => {
    const row = { ranking_date: '2026-10-05', ranking: 12 }
    expect(await playerReachesRanking(ctx([row]), ranking)).toMatchObject({ outcome: true })
    expect(await playerReachesRanking(ctx([row, { ...row, ranking: 15 }]), ranking)).toEqual({ state: 'undecided' })
  })
  it('requires every weekly ranking snapshot for NO', async () => {
    const dates = ['2026-10-05','2026-10-12','2026-10-19','2026-10-26','2026-11-02','2026-11-09','2026-11-16','2026-11-23','2026-11-30']
    const rows = dates.map(ranking_date => ({ ranking_date, ranking: 15 }))
    expect(await playerReachesRanking(ctx(rows), ranking)).toMatchObject({ outcome: false })
    expect(await playerReachesRanking(ctx(rows.slice(1)), ranking)).toEqual({ state: 'undecided' })
    expect(await playerReachesRanking(ctx([{ ranking_date: dates[0], ranking: 0 }]), ranking)).toEqual({ state: 'undecided' })
  })
  it('surfaces database errors instead of manufacturing a result', async () => {
    await expect(pairTitleCount(ctx([], undefined, 'offline'), season)).rejects.toThrow('offline')
  })
  it('rejects malformed or duplicate scopes', async () => {
    await expect(pairTitleCount(ctx([]), { ...season, tournamentIds: ['t1','t1'] })).rejects.toThrow('distinct')
    await expect(pairReachesRound(ctx([]), { ...p, player2Id: 'a', round: 'SF' })).rejects.toThrow('different')
  })
})

import { SELECTED_BETA_MARKETS, publicationBlockers } from '../selected-beta-markets.js'
import { getResolver } from '../market-resolvers/index.js'
describe('approved shortlist and publication preflight', () => {
  const ready = { locksAt: '2026-10-01T00:00:00Z', now: new Date('2026-09-29T12:00:00Z'),
    playerIds: ['11111111-1111-1111-1111-111111111111'], expectedPlayers: 1,
    probability: .4, probabilitySource: 'Calibrated ranking model, 29 Sep', scopeVerified: true,
    outcomeAlreadyKnown: false, remainingCapacity: 7 }
  it('contains precisely the seven selected sheet IDs with callable resolvers', () => {
    expect(SELECTED_BETA_MARKETS.map(m => m.sheetId)).toEqual([23,24,25,26,29,30,37])
    for (const market of SELECTED_BETA_MARKETS) expect(typeof getResolver(market.resolverKey)).toBe('function')
  })
  it('rejects stale, unpriced, incomplete or already determined markets', () => {
    expect(publicationBlockers(ready)).toEqual([])
    expect(publicationBlockers({ ...ready, locksAt: '2026-09-01', probability: null,
      scopeVerified: false, outcomeAlreadyKnown: true, remainingCapacity: 0 })).toHaveLength(5)
  })
})

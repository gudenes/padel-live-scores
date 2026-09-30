import { describe, it, expect } from 'vitest'
import { tournamentBagelCountAtLeast } from '../market-resolvers/bagel-count.js'
import type { ResolverContext } from '../market-resolvers/types.js'

interface SetRow { set_number: number; pair1_games: number | null; pair2_games: number | null; set_score?: string | null }
interface MatchRow {
  id: string; status: string | null; round_canonical: string | null; sets: SetRow[]
  scheduled_at?: string | null; pair1_player1_id?: string | null; pair2_player1_id?: string | null
}

/** Stub for `.from('matches').select().eq().eq()` — awaited directly. */
function stub(rows: MatchRow[], error: { message: string } | null = null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    then: (resolve: (v: unknown) => void) => resolve({ data: error ? null : rows, error }),
  }
  return { from: () => chain } as never
}

function ctx(rows: MatchRow[]): ResolverContext {
  return {
    supabase: stub(rows),
    marketId: 'm1',
    matchId: null,
    tournamentId: 'tour-1',
    category: 'women',
    tokens: {},
    now: new Date('2026-10-04T20:00:00Z'),
  }
}

const s = (n: number, a: number, b: number): SetRow => ({ set_number: n, pair1_games: a, pair2_games: b })
const P = { pair1_player1_id: 'p1', pair2_player1_id: 'p2' }
const bagelMatch = (id: string, round = 'R32', status = 'finished'): MatchRow =>
  ({ id, status, round_canonical: round, sets: [s(1, 6, 0), s(2, 6, 3)], ...P })
const plainMatch = (id: string, round = 'R32', status = 'finished'): MatchRow =>
  ({ id, status, round_canonical: round, sets: [s(1, 6, 4), s(2, 7, 5)], scheduled_at: '2026-10-04T16:00:00Z', ...P })

describe('tournament.bagel_count_at_least_v1', () => {
  it('throws without a usable line — a market must never settle against an undefined threshold', async () => {
    await expect(tournamentBagelCountAtLeast(ctx([]), {})).rejects.toThrow(/line/)
    await expect(tournamentBagelCountAtLeast(ctx([]), { line: 0 })).rejects.toThrow(/line/)
  })

  it('is undecided when the draw has no main-draw rows yet', async () => {
    const r = await tournamentBagelCountAtLeast(ctx([]), { line: 2 })
    expect(r.state).toBe('undecided')
  })

  it('settles YES as soon as completed matches reach the line, mid-tournament', async () => {
    const rows = [bagelMatch('a'), bagelMatch('b'), plainMatch('c', 'QF', 'scheduled')]
    const r = await tournamentBagelCountAtLeast(ctx(rows), { line: 2 })
    expect(r.state).toBe('decided')
    if (r.state === 'decided') {
      expect(r.outcome).toBe(true)
      expect(r.evidence.bagel_count).toBe(2)
      expect(r.evidence.line).toBe(2)
    }
  })

  it('counts every 6-0 set, including two in the same match and 0-6', async () => {
    const double: MatchRow = { id: 'd', status: 'finished', round_canonical: 'R16', sets: [s(1, 6, 0), s(2, 0, 6), s(3, 6, 2)] }
    const r = await tournamentBagelCountAtLeast(ctx([double, plainMatch('e', 'F', 'scheduled')]), { line: 2 })
    expect(r.state === 'decided' && r.outcome).toBe(true)
  })

  it('ignores qualifying — the line is about the main draw', async () => {
    const rows = [bagelMatch('q1', 'Q1'), bagelMatch('q2', 'Q2'), plainMatch('f', 'F')]
    const r = await tournamentBagelCountAtLeast(ctx(rows), { line: 1 })
    expect(r.state === 'decided' && r.outcome).toBe(false)
  })

  it('ignores rows with no canonical round rather than guessing which draw they belong to', async () => {
    const rows = [bagelMatch('x', null as unknown as string), plainMatch('f', 'F')]
    const r = await tournamentBagelCountAtLeast(ctx(rows), { line: 1 })
    expect(r.state === 'decided' && r.outcome).toBe(false)
  })

  it('does not count a 6-0 from a match still in play — the reconciler can still rewrite it', async () => {
    const live: MatchRow = { id: 'l', status: 'live', round_canonical: 'SF', sets: [s(1, 6, 0)] }
    const r = await tournamentBagelCountAtLeast(ctx([live, plainMatch('f', 'F', 'scheduled')]), { line: 1 })
    expect(r.state).toBe('undecided')
  })

  it('counts a bagel already played in a retired match', async () => {
    const retired: MatchRow = { id: 'r', status: 'retired', round_canonical: 'R32', sets: [s(1, 6, 0), s(2, 2, 1)] }
    const r = await tournamentBagelCountAtLeast(ctx([retired, plainMatch('f', 'F', 'scheduled')]), { line: 1 })
    expect(r.state === 'decided' && r.outcome).toBe(true)
  })

  it('settles NO only once every main-draw match, final included, is over', async () => {
    const rows = [bagelMatch('a'), plainMatch('b', 'SF'), plainMatch('f', 'F')]
    const r = await tournamentBagelCountAtLeast(ctx(rows), { line: 2 })
    expect(r.state).toBe('decided')
    if (r.state === 'decided') {
      expect(r.outcome).toBe(false)
      expect(r.evidence.bagel_count).toBe(1)
    }
  })

  it('stays undecided below the line while matches remain', async () => {
    const rows = [bagelMatch('a'), plainMatch('f', 'F', 'scheduled')]
    const r = await tournamentBagelCountAtLeast(ctx(rows), { line: 2 })
    expect(r.state).toBe('undecided')
  })

  it('ignores an empty slot stuck at scheduled after the final (a bye, measured on Pretoria/Malaga 2026)', async () => {
    const bye: MatchRow = { id: 'bye', status: 'scheduled', round_canonical: 'R64', sets: [], pair1_player1_id: null, pair2_player1_id: null }
    const r = await tournamentBagelCountAtLeast(ctx([bye, plainMatch('f', 'F')]), { line: 1 })
    expect(r.state === 'decided' && r.outcome).toBe(false)
  })

  it('waits for a real match whose result never landed, then voids instead of guessing NO (Paris Major women 2026)', async () => {
    const stuck: MatchRow = { id: 'stuck', status: 'scheduled', round_canonical: 'R32', sets: [], ...P }
    const rows = [stuck, plainMatch('f', 'F')] // final at 2026-10-04T16:00Z
    const within = await tournamentBagelCountAtLeast(ctx(rows), { line: 1 }) // now = 2026-10-04T20:00Z
    expect(within.state).toBe('undecided')
    const late = await tournamentBagelCountAtLeast({ ...ctx(rows), now: new Date('2026-10-07T00:00:00Z') }, { line: 1 })
    expect(late.state).toBe('void')
  })

  it('still settles YES early even with a result missing — a counted bagel is a fact', async () => {
    const stuck: MatchRow = { id: 'stuck', status: 'scheduled', round_canonical: 'R32', sets: [], ...P }
    const r = await tournamentBagelCountAtLeast(ctx([stuck, bagelMatch('a')]), { line: 1 })
    expect(r.state === 'decided' && r.outcome).toBe(true)
  })

  it('stays undecided while the final itself is not over', async () => {
    const r = await tournamentBagelCountAtLeast(ctx([plainMatch('a'), plainMatch('f', 'F', 'live')]), { line: 1 })
    expect(r.state).toBe('undecided')
  })

  it('stays undecided when every row is over but the final row does not exist yet', async () => {
    const rows = [bagelMatch('a'), plainMatch('b', 'SF')]
    const r = await tournamentBagelCountAtLeast(ctx(rows), { line: 2 })
    expect(r.state).toBe('undecided')
  })

  it('refuses NO while a finished match has not had its scoreline written yet', async () => {
    const hollow: MatchRow = { id: 'h', status: 'finished', round_canonical: 'R16', sets: [] }
    const r = await tournamentBagelCountAtLeast(ctx([hollow, plainMatch('f', 'F')]), { line: 1 })
    expect(r.state).toBe('undecided')
  })

  it('does not wait on a walkover — no sets is the complete record of one', async () => {
    const wo: MatchRow = { id: 'w', status: 'walkover', round_canonical: 'R16', sets: [] }
    const r = await tournamentBagelCountAtLeast(ctx([wo, plainMatch('f', 'F')]), { line: 1 })
    expect(r.state === 'decided' && r.outcome).toBe(false)
  })

  it('voids on more than one final — multi-draw events cannot be counted as one draw', async () => {
    const rows = [plainMatch('f1', 'F'), plainMatch('f2', 'F')]
    const r = await tournamentBagelCountAtLeast(ctx(rows), { line: 1 })
    expect(r.state).toBe('void')
  })

  it('throws on a query error rather than reading it as an empty draw', async () => {
    const c = { ...ctx([]), supabase: stub([], { message: 'boom' }) }
    await expect(tournamentBagelCountAtLeast(c, { line: 1 })).rejects.toThrow(/boom/)
  })
})

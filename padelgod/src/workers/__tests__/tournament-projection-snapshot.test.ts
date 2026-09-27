import { describe, it, expect } from 'vitest';
import {
  buildResultByMatchup,
  collapseToFrontier,
  buildDoneProjections,
  buildSnapshotRows,
  fillQualifierSlots,
  isQualifierStandIn,
  type FrontierMatchRow,
} from '../tournament-projection-snapshot.js';
import { matchupKey, type FrontierEntrant } from '../../lib/bracket-projection.js';

describe('buildResultByMatchup', () => {
  it('keys decided matches by matchup → winner pairKey, ignoring unfinished', () => {
    const rows: FrontierMatchRow[] = [
      { id: 'm', widget_id_composite: null, draw_position: null, status: 'finished', winner_pair: 2,
        pair1_player1_id: 'a', pair1_player2_id: 'b', pair2_player1_id: 'c', pair2_player2_id: 'd', pair1_seed: null, pair2_seed: null },
      { id: 'm2', widget_id_composite: null, draw_position: null, status: 'scheduled', winner_pair: null,
        pair1_player1_id: 'e', pair1_player2_id: 'f', pair2_player1_id: 'g', pair2_player2_id: 'h', pair1_seed: null, pair2_seed: null },
    ]
    const map = buildResultByMatchup(rows)
    expect(map.get(matchupKey('a::b', 'c::d'))).toBe('c::d')
    expect(map.size).toBe(1)
  })
})

describe('collapseToFrontier', () => {
  const E = (k: string): FrontierEntrant => { const [a, b] = k.split('::'); return { pairKey: k, playerIds: [a!, b!], teamElo: 1500 } }

  it('pre-tournament (no results) returns the leaves unchanged', () => {
    const leaves = [E('a::b'), E('c::d'), E('e::f'), E('g::h')]
    expect(collapseToFrontier(leaves, new Map())).toEqual(leaves)
  })

  it('advances decided rounds to the frontier', () => {
    const leaves = [E('a::b'), E('c::d'), E('e::f'), E('g::h')]
    // Both first-round matches decided → frontier is the 2-team final.
    const results = new Map<string, string>([
      [matchupKey('a::b', 'c::d'), 'a::b'],
      [matchupKey('e::f', 'g::h'), 'g::h'],
    ])
    const out = collapseToFrontier(leaves, results)
    expect(out.map((e) => e?.pairKey)).toEqual(['a::b', 'g::h'])
  })
})

describe('buildDoneProjections', () => {
  it('reconstructs an eliminated pair factually (champion 0, real rounds, win/loss)', () => {
    const rows = [
      { id: 'r32', round: 'R32', round_canonical: 'R32', widget_id_composite: null, draw_position: null, status: 'finished', winner_pair: 1,
        pair1_player1_id: 'a1', pair1_player2_id: 'a2', pair2_player1_id: 'x1', pair2_player2_id: 'x2', pair1_seed: null, pair2_seed: null },
      { id: 'r16', round: 'R16', round_canonical: 'R16', widget_id_composite: null, draw_position: null, status: 'finished', winner_pair: 1,
        pair1_player1_id: 'y1', pair1_player2_id: 'y2', pair2_player1_id: 'a1', pair2_player2_id: 'a2', pair1_seed: null, pair2_seed: null },
    ] as Array<FrontierMatchRow & { round: string | null; round_canonical: string | null }>
    const done = buildDoneProjections(rows)
    const a = done.find((d) => d.pairKey === 'a1::a2')!
    expect(a.status).toBe('eliminated')
    expect(a.eliminatedRound).toBe('R16')   // won R32, lost R16
    expect(a.championProb).toBe(0)
    expect(a.rounds.map((r) => r.round)).toEqual(['R32', 'R16'])
    expect(a.rounds[0].opponents[0].winProb).toBe(1) // won R32
    expect(a.rounds[1].opponents[0].winProb).toBe(0) // lost R16
    // x1::x2 lost R32 → eliminated@R32
    expect(done.find((d) => d.pairKey === 'x1::x2')!.eliminatedRound).toBe('R32')
  })

  it('flags the final winner as champion (100%) and excludes still-active pairs', () => {
    const rows = [
      { id: 'f', round: 'F', round_canonical: 'F', widget_id_composite: null, draw_position: null, status: 'finished', winner_pair: 1,
        pair1_player1_id: 'c1', pair1_player2_id: 'c2', pair2_player1_id: 'd1', pair2_player2_id: 'd2', pair1_seed: null, pair2_seed: null },
      { id: 'sf-open', round: 'SF', round_canonical: 'SF', widget_id_composite: null, draw_position: null, status: 'scheduled', winner_pair: null,
        pair1_player1_id: 'e1', pair1_player2_id: 'e2', pair2_player1_id: 'g1', pair2_player2_id: 'g2', pair1_seed: null, pair2_seed: null },
    ] as Array<FrontierMatchRow & { round: string | null; round_canonical: string | null }>
    const done = buildDoneProjections(rows)
    expect(done.find((d) => d.pairKey === 'c1::c2')!.status).toBe('champion')
    expect(done.find((d) => d.pairKey === 'c1::c2')!.championProb).toBe(1)
    expect(done.find((d) => d.pairKey === 'd1::d2')!.eliminatedRound).toBe('F') // lost final
    // e/g are in an undecided SF → not "done"
    expect(done.find((d) => d.pairKey === 'e1::e2')).toBeUndefined()
  })
})

describe('buildSnapshotRows', () => {
  it('maps each projection to a snapshot row with the run timestamp', () => {
    const projections = new Map([
      ['a::b', { pairKey: 'a::b', playerIds: ['a','b'] as [string,string], championProb: 0.22, finalistProb: 0.4, semifinalProb: 0.7, rounds: [] }],
    ])
    const rows = buildSnapshotRows(projections, 't1', 'men', '2026-06-06T10:00:00.000Z')
    expect(rows).toEqual([{
      tournament_id: 't1', category: 'men', pair_key: 'a::b',
      champion_prob: '0.2200', finalist_prob: '0.4000', semifinal_prob: '0.7000',
      computed_at: '2026-06-06T10:00:00.000Z',
    }])
  })
})

describe('buildPlayedRounds', () => {
  it('tags each played round with the actual result and tracks the deepest round', async () => {
    const { buildPlayedRounds } = await import('../tournament-projection-snapshot.js')
    const rows = [
      { id: 'r32', round: 'R32', round_canonical: 'R32', widget_id_composite: null, draw_position: null, status: 'finished', winner_pair: 1,
        pair1_player1_id: 'a1', pair1_player2_id: 'a2', pair2_player1_id: 'x1', pair2_player2_id: 'x2', pair1_seed: null, pair2_seed: null },
      { id: 'r16', round: 'R16', round_canonical: 'R16', widget_id_composite: null, draw_position: null, status: 'finished', winner_pair: 1,
        pair1_player1_id: 'y1', pair1_player2_id: 'y2', pair2_player1_id: 'a1', pair2_player2_id: 'a2', pair1_seed: null, pair2_seed: null },
    ] as Array<FrontierMatchRow & { round: string | null; round_canonical: string | null }>
    const played = buildPlayedRounds(rows)
    const a = played.get('a1::a2')!
    expect(a.rounds.map((r) => r.round)).toEqual(['R32', 'R16'])
    expect(a.rounds[0].opponents[0].result).toBe('won')
    expect(a.rounds[1].opponents[0].result).toBe('lost')
    expect(a.lostRound).toBe('R16')
    // lastPlayedIdx points at R16 in PROJ_ROUND_ORDER (R64,R32,R16,QF,SF,F → idx 2)
    expect(a.lastPlayedIdx).toBe(2)
  })
})

describe('fillQualifierSlots', () => {
  // A `null` leaf means "bye OR not-yet-known" and the simulator advances it
  // for free. Correct for a true bye; wrong for a pair waiting on a qualifier.
  const row = (o: Partial<FrontierMatchRow & { round: string | null; round_canonical: string | null }>) => ({
    id: 'x', widget_id_composite: null, draw_position: null, status: 'scheduled',
    winner_pair: null, pair1_player1_id: null, pair1_player2_id: null,
    pair2_player1_id: null, pair2_player2_id: null, pair1_seed: null, pair2_seed: null,
    round: 'R16', round_canonical: 'R16',
    ...o,
  }) as FrontierMatchRow & { round: string | null; round_canonical: string | null }

  const E = (k: string): FrontierEntrant => {
    const [a, b] = k.split('::'); return { pairKey: k, playerIds: [a!, b!], teamElo: 1500 }
  }

  it('substitutes a stand-in for the empty side of a pair-vs-qualifier cell', () => {
    // R16 draw → 8 first-round cells → 16 leaf slots. WD008 is cell 0.
    const rows = [row({
      id: 'q1', widget_id_composite: 'T:WD008', round: 'R16', round_canonical: 'R16',
      pair1_player1_id: 'a', pair1_player2_id: 'b',
    })]
    const leaves: (FrontierEntrant | null)[] = new Array(16).fill(null)
    leaves[0] = E('a::b')

    const n = fillQualifierSlots(leaves, rows, new Map(), new Map())

    expect(n).toBe(1)
    expect(leaves[1]).not.toBeNull()
    expect(isQualifierStandIn(leaves[1]!.pairKey)).toBe(true)
  })

  it('leaves a true bye alone — no first-round row, so the seed keeps its free pass', () => {
    // Seed lifted into the leaves from the next-round cell: there is no
    // first-round row at all, so nothing should be substituted.
    const rows = [row({
      id: 'r16', widget_id_composite: 'T:WD004', round: 'QF', round_canonical: 'QF',
      pair1_player1_id: 'a', pair1_player2_id: 'b',
    })]
    const leaves: (FrontierEntrant | null)[] = new Array(16).fill(null)
    leaves[0] = E('a::b')

    const n = fillQualifierSlots(leaves, rows, new Map(), new Map())

    expect(n).toBe(0)
    expect(leaves[1]).toBeNull()
  })

  it('ignores cells where both sides are known', () => {
    const rows = [row({
      id: 'full', widget_id_composite: 'T:WD008', round: 'R16', round_canonical: 'R16',
      pair1_player1_id: 'a', pair1_player2_id: 'b',
      pair2_player1_id: 'c', pair2_player2_id: 'd',
    })]
    const leaves: (FrontierEntrant | null)[] = new Array(16).fill(null)
    leaves[0] = E('a::b'); leaves[1] = E('c::d')

    expect(fillQualifierSlots(leaves, rows, new Map(), new Map())).toBe(0)
  })

  it('prices the stand-in off the qualifying field, not the main draw', () => {
    const elo = new Map<string, number>([
      ['a', 2000], ['b', 2000], ['q1', 1200], ['q2', 1200], ['q3', 1300], ['q4', 1300],
    ])
    const rows = [
      row({ id: 'q', widget_id_composite: 'T:WD008', round: 'R16', round_canonical: 'R16',
        pair1_player1_id: 'a', pair1_player2_id: 'b' }),
      row({ id: 'qual', widget_id_composite: 'T:WQ001', round: 'Q1', round_canonical: 'Q1',
        pair1_player1_id: 'q1', pair1_player2_id: 'q2',
        pair2_player1_id: 'q3', pair2_player2_id: 'q4' }),
    ]
    const leaves: (FrontierEntrant | null)[] = new Array(16).fill(null)
    leaves[0] = { pairKey: 'a::b', playerIds: ['a', 'b'], teamElo: 2000 }

    fillQualifierSlots(leaves, rows, elo, new Map())

    // Qualifying pairs average (1200+1300)/1 → 1250, well below the 2000 main-draw pair.
    expect(leaves[1]!.teamElo).toBeCloseTo(1250, 5)
    expect(leaves[1]!.teamElo).toBeLessThan(2000)
  })
})

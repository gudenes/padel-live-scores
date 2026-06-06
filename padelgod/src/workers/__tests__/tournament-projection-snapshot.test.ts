import { describe, it, expect } from 'vitest';
import {
  buildFrontierEntrants,
  pickFrontierRound,
  buildDoneProjections,
  buildSnapshotRows,
  type FrontierMatchRow,
} from '../tournament-projection-snapshot.js';
import type { ProjRound } from '../../lib/bracket-projection.js';

describe('buildFrontierEntrants', () => {
  it('collapses a finished frontier match to [winner, null]', () => {
    const rows: FrontierMatchRow[] = [
      { widget_id_composite: 'X:MD002', draw_position: null, id: 'm2', winner_pair: 1, status: 'finished',
        pair1_player1_id: 'p1', pair1_player2_id: 'p2', pair2_player1_id: 'p3', pair2_player2_id: 'p4', pair1_seed: 1, pair2_seed: null },
    ]
    const e = buildFrontierEntrants(rows, 'F', new Map([['p1',1900],['p2',1900],['p3',1700],['p4',1700]]), new Map())
    expect(e[0]?.pairKey).toBe('p1::p2')
    expect(e[1]).toBeNull()
  })
})

describe('pickFrontierRound', () => {
  it('returns the earliest round with an unfinished assigned match', () => {
    const byRound = new Map<ProjRound, FrontierMatchRow[]>([
      ['R16', [{ id: 'a', widget_id_composite: null, draw_position: 0, status: 'finished', winner_pair: 1,
        pair1_player1_id: 'p1', pair1_player2_id: 'p2', pair2_player1_id: 'p3', pair2_player2_id: 'p4', pair1_seed: null, pair2_seed: null }]],
      ['QF', [{ id: 'b', widget_id_composite: null, draw_position: 0, status: 'scheduled', winner_pair: null,
        pair1_player1_id: 'p1', pair1_player2_id: 'p2', pair2_player1_id: 'w1', pair2_player2_id: 'w2', pair1_seed: null, pair2_seed: null }]],
    ])
    expect(pickFrontierRound(byRound)).toBe('QF')
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

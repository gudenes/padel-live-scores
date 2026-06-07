import { describe, it, expect } from 'vitest';
import {
  buildResultByMatchup,
  collapseToFrontier,
  buildDoneProjections,
  buildSnapshotRows,
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

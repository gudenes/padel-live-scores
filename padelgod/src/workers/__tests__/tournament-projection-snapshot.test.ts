import { describe, it, expect } from 'vitest';
import {
  buildFullFieldEntrants,
  pickEntryRound,
  deriveStatuses,
  type FrontierMatchRow,
} from '../tournament-projection-snapshot.js';
import type { ProjRound } from '../../lib/bracket-projection.js';

describe('buildFullFieldEntrants', () => {
  it('emits BOTH competitors of every match (losers retained), heap-ordered', () => {
    const rows: FrontierMatchRow[] = [
      { widget_id_composite: 'X:MD003', draw_position: null, id: 'm3', winner_pair: 1, status: 'finished',
        pair1_player1_id: 'p3', pair1_player2_id: 'p4', pair2_player1_id: 'w1', pair2_player2_id: 'w2', pair1_seed: null, pair2_seed: null },
      { widget_id_composite: 'X:MD002', draw_position: null, id: 'm2', winner_pair: null, status: 'scheduled',
        pair1_player1_id: 'p1', pair1_player2_id: 'p2', pair2_player1_id: 'p3', pair2_player2_id: 'p4', pair1_seed: 1, pair2_seed: null },
    ]
    const e = buildFullFieldEntrants(rows, new Map([['p1',1900],['p2',1900],['p3',1700],['p4',1700],['w1',1850],['w2',1850]]), new Map())
    expect(e.map(x => x?.pairKey)).toEqual(['p1::p2', 'p3::p4', 'p3::p4', 'w1::w2'])
  })
})

describe('pickEntryRound', () => {
  it('returns the shallowest round with an assigned match (even if finished)', () => {
    const byRound = new Map<ProjRound, FrontierMatchRow[]>([
      ['R16', [{ id: 'a', widget_id_composite: null, draw_position: 0, status: 'finished', winner_pair: 1,
        pair1_player1_id: 'p1', pair1_player2_id: 'p2', pair2_player1_id: 'p3', pair2_player2_id: 'p4', pair1_seed: null, pair2_seed: null }]],
      ['QF', [{ id: 'b', widget_id_composite: null, draw_position: 0, status: 'scheduled', winner_pair: null,
        pair1_player1_id: 'p1', pair1_player2_id: 'p2', pair2_player1_id: 'w1', pair2_player2_id: 'w2', pair1_seed: null, pair2_seed: null }]],
    ])
    expect(pickEntryRound(byRound)).toBe('R16')
  })
})

describe('deriveStatuses', () => {
  it('flags losers as eliminated at their round and the final winner as champion', () => {
    const rows: Array<FrontierMatchRow & { round: string | null; round_canonical: string | null }> = [
      { id: 'sf', round: 'SF', round_canonical: 'SF', widget_id_composite: null, draw_position: null, status: 'finished', winner_pair: 1,
        pair1_player1_id: 'a1', pair1_player2_id: 'a2', pair2_player1_id: 'b1', pair2_player2_id: 'b2', pair1_seed: null, pair2_seed: null },
      { id: 'f', round: 'F', round_canonical: 'F', widget_id_composite: null, draw_position: null, status: 'finished', winner_pair: 2,
        pair1_player1_id: 'a1', pair1_player2_id: 'a2', pair2_player1_id: 'c1', pair2_player2_id: 'c2', pair1_seed: null, pair2_seed: null },
    ]
    const st = deriveStatuses(rows)
    expect(st.get('b1::b2')).toEqual({ status: 'eliminated', eliminatedRound: 'SF' })
    expect(st.get('a1::a2')).toEqual({ status: 'eliminated', eliminatedRound: 'F' })
    expect(st.get('c1::c2')).toEqual({ status: 'champion', eliminatedRound: null })
  })
})

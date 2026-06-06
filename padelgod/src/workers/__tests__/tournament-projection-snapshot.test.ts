import { describe, it, expect } from 'vitest';
import {
  buildFrontierEntrants,
  type FrontierMatchRow,
} from '../tournament-projection-snapshot.js';

const elo = new Map<string, number>([
  ['p1', 1900], ['p2', 1900], ['p3', 1700], ['p4', 1700],
  ['w1', 1850], ['w2', 1850],
]);

describe('buildFrontierEntrants', () => {
  it('orders by widget heap number and expands matches into competitor slots', () => {
    // SF round: 2 matches, heap numbers MD002 (slot0) and MD003 (slot1).
    const rows: FrontierMatchRow[] = [
      { widget_id_composite: 'X:MD003', draw_position: null, id: 'm3',
        winner_pair: null, status: 'scheduled',
        pair1_player1_id: 'p3', pair1_player2_id: 'p4',
        pair2_player1_id: 'w1', pair2_player2_id: 'w2',
        pair1_seed: null, pair2_seed: null },
      { widget_id_composite: 'X:MD002', draw_position: null, id: 'm2',
        winner_pair: null, status: 'scheduled',
        pair1_player1_id: 'p1', pair1_player2_id: 'p2',
        pair2_player1_id: 'p3', pair2_player2_id: 'p4',
        pair1_seed: 1, pair2_seed: null },
    ];
    const entrants = buildFrontierEntrants(rows, 'SF', elo, new Map());
    // MD002 first → its pair1 (p1/p2) at slot 0, pair2 (p3/p4) at slot 1;
    // MD003 → slots 2,3.
    expect(entrants.map(e => e?.pairKey)).toEqual([
      'p1::p2', 'p3::p4', 'p3::p4', 'w1::w2',
    ].map(k => k)); // ids already sorted lexically here
    expect(entrants[0]!.teamElo).toBe(1900);
  });

  it('represents a finished frontier match as [winner, null] (bye-advance)', () => {
    const rows: FrontierMatchRow[] = [
      { widget_id_composite: 'X:MD002', draw_position: null, id: 'm2',
        winner_pair: 1, status: 'finished',
        pair1_player1_id: 'p1', pair1_player2_id: 'p2',
        pair2_player1_id: 'p3', pair2_player2_id: 'p4',
        pair1_seed: 1, pair2_seed: null },
    ];
    const entrants = buildFrontierEntrants(rows, 'F', elo, new Map());
    expect(entrants[0]!.pairKey).toBe('p1::p2');
    expect(entrants[1]).toBeNull();
  });
});

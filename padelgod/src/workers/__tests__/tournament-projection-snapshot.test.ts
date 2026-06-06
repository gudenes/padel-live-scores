import { describe, it, expect } from 'vitest';
import {
  buildFrontierEntrants,
  pickFrontierRound,
  type FrontierMatchRow,
} from '../tournament-projection-snapshot.js';
import type { ProjRound } from '../../lib/bracket-projection.js';

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

describe('pickFrontierRound', () => {
  it('returns the earliest round that still has an unfinished assigned match', () => {
    // R16 fully finished, QF has an unfinished match -> frontier = QF.
    const byRound = new Map<ProjRound, FrontierMatchRow[]>([
      ['R16', [{ id: 'a', widget_id_composite: null, draw_position: 0, status: 'finished', winner_pair: 1,
        pair1_player1_id: 'p1', pair1_player2_id: 'p2', pair2_player1_id: 'p3', pair2_player2_id: 'p4',
        pair1_seed: null, pair2_seed: null }]],
      ['QF', [{ id: 'b', widget_id_composite: null, draw_position: 0, status: 'scheduled', winner_pair: null,
        pair1_player1_id: 'p1', pair1_player2_id: 'p2', pair2_player1_id: 'w1', pair2_player2_id: 'w2',
        pair1_seed: null, pair2_seed: null }]],
    ]);
    expect(pickFrontierRound(byRound)).toBe('QF');
  });

  it('returns null when every present round is fully finished', () => {
    const byRound = new Map<ProjRound, FrontierMatchRow[]>([
      ['F', [{ id: 'f', widget_id_composite: null, draw_position: 0, status: 'finished', winner_pair: 1,
        pair1_player1_id: 'p1', pair1_player2_id: 'p2', pair2_player1_id: 'p3', pair2_player2_id: 'p4',
        pair1_seed: null, pair2_seed: null }]],
    ]);
    expect(pickFrontierRound(byRound)).toBeNull();
  });

  it('skips a present-but-unassigned round in favour of a later assigned one', () => {
    // QF exists but its only match has TBD pairs (not yet propagated); the
    // SF has a real assigned, unfinished match -> frontier = SF, not QF.
    const byRound = new Map<ProjRound, FrontierMatchRow[]>([
      ['QF', [{ id: 'q', widget_id_composite: null, draw_position: 0, status: 'scheduled', winner_pair: null,
        pair1_player1_id: null, pair1_player2_id: null, pair2_player1_id: null, pair2_player2_id: null,
        pair1_seed: null, pair2_seed: null }]],
      ['SF', [{ id: 's', widget_id_composite: null, draw_position: 0, status: 'scheduled', winner_pair: null,
        pair1_player1_id: 'p1', pair1_player2_id: 'p2', pair2_player1_id: 'w1', pair2_player2_id: 'w2',
        pair1_seed: null, pair2_seed: null }]],
    ]);
    expect(pickFrontierRound(byRound)).toBe('SF');
  });
});

// padelgod/src/db/__tests__/player-profile-queue.test.ts
import { describe, it, expect } from 'vitest';
import {
  tierRank,
  pickBestTier,
  computeRetryCutoffIso,
  rankAndSliceByTier,
  type QueueRow,
} from '../player-profile-queue.js';

describe('tierRank', () => {
  it('orders premier highest, then gold/silver/bronze, with unknown last', () => {
    expect(tierRank('premier')).toBeLessThan(tierRank('fip_gold'));
    expect(tierRank('fip_gold')).toBeLessThan(tierRank('fip_silver'));
    expect(tierRank('fip_silver')).toBeLessThan(tierRank('fip_bronze'));
    expect(tierRank('fip_bronze')).toBeLessThan(tierRank('something_else'));
    expect(tierRank(null)).toBe(tierRank('something_else'));
  });
});

describe('pickBestTier', () => {
  it('returns the lowest (= best) tier rank seen for each fip_id', () => {
    const tierByTournament = new Map<string, number>([
      ['t1', 1], // premier
      ['t2', 3], // silver
      ['t3', 4], // bronze
    ]);
    const snapshots = [
      { fip_id: 'P1', tournament_id: 't1' }, // premier
      { fip_id: 'P1', tournament_id: 't3' }, // bronze
      { fip_id: 'P2', tournament_id: 't2' }, // silver
      { fip_id: 'P2', tournament_id: 't3' }, // bronze
      { fip_id: 'P3', tournament_id: 't3' }, // bronze only
    ];
    const result = pickBestTier(snapshots, tierByTournament);
    expect(result.get('P1')).toBe(1); // premier wins over bronze
    expect(result.get('P2')).toBe(3); // silver wins over bronze
    expect(result.get('P3')).toBe(4);
  });
});

describe('computeRetryCutoffIso', () => {
  it('returns an ISO string N days before the given reference time', () => {
    const ref = new Date('2026-05-09T12:00:00Z').getTime();
    expect(computeRetryCutoffIso(30, ref)).toBe('2026-04-09T12:00:00.000Z');
    expect(computeRetryCutoffIso(7, ref)).toBe('2026-05-02T12:00:00.000Z');
  });
});

describe('rankAndSliceByTier', () => {
  it('sorts by tier rank, then attempt_at NULLS FIRST, then slices to limit', () => {
    const rows: QueueRow[] = [
      { id: 'a', fip_id: 'P1', profile_attempt_at: '2026-04-01' },
      { id: 'b', fip_id: 'P2', profile_attempt_at: null },
      { id: 'c', fip_id: 'P3', profile_attempt_at: '2026-03-01' },
      { id: 'd', fip_id: 'P4', profile_attempt_at: null },
    ];
    const tierByFipId = new Map<string, number>([
      ['P1', 1], // premier — should come first
      ['P2', 3], // silver — second tier
      ['P3', 1], // premier — alongside P1
      ['P4', 2], // gold
    ]);
    const sorted = rankAndSliceByTier(rows, tierByFipId, 10);
    // Expected order: P3 (tier 1, oldest attempt), P1 (tier 1, attempted 2026-04-01),
    //                 P4 (tier 2, null attempt = front), P2 (tier 3, null attempt)
    expect(sorted.map(r => r.fip_id)).toEqual(['P3', 'P1', 'P4', 'P2']);
  });

  it('puts NULL attempt_at before any non-null within the same tier', () => {
    const rows: QueueRow[] = [
      { id: 'a', fip_id: 'P1', profile_attempt_at: '2026-04-01' },
      { id: 'b', fip_id: 'P2', profile_attempt_at: null },
    ];
    const tier = new Map([['P1', 1], ['P2', 1]]);
    expect(rankAndSliceByTier(rows, tier, 10).map(r => r.fip_id)).toEqual(['P2', 'P1']);
  });

  it('respects the limit', () => {
    const rows: QueueRow[] = Array.from({ length: 50 }, (_, i) => ({
      id: `x${i}`,
      fip_id: `P${i}`,
      profile_attempt_at: null,
    }));
    const tier = new Map(rows.map(r => [r.fip_id, 1] as [string, number]));
    expect(rankAndSliceByTier(rows, tier, 10)).toHaveLength(10);
  });
});

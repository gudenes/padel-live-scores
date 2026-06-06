import { describe, it, expect } from 'vitest';
import { projectPairs, type FrontierEntrant } from '../bracket-projection.js';

// Deterministic RNG (mulberry32) so MC results are reproducible.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pair(key: string, elo: number): FrontierEntrant {
  return { pairKey: key, playerIds: [`${key}-a`, `${key}-b`], teamElo: elo };
}

describe('projectPairs', () => {
  it('gives ~equal champion odds to 4 equal-Elo pairs over an SF/F bracket', () => {
    const entrants = [pair('A', 1800), pair('B', 1800), pair('C', 1800), pair('D', 1800)];
    const res = projectPairs({ entrants, runs: 20000, rng: mulberry32(42) });
    for (const k of ['A', 'B', 'C', 'D']) {
      expect(res.get(k)!.championProb).toBeGreaterThan(0.20);
      expect(res.get(k)!.championProb).toBeLessThan(0.30);
    }
    // Round labels for 4 entrants are SF then F.
    expect(res.get('A')!.rounds.map(r => r.round)).toEqual(['SF', 'F']);
  });

  it('reports the analytic conditional win prob against each SF opponent', () => {
    // A is much stronger; B/C/D equal. In SF A meets its bracket neighbor
    // (index 0 vs 1 => A vs B). winProb is analytic.
    const entrants = [pair('A', 2000), pair('B', 1600), pair('C', 1800), pair('D', 1800)];
    const res = projectPairs({ entrants, runs: 5000, rng: mulberry32(7) });
    const aSF = res.get('A')!.rounds.find(r => r.round === 'SF')!;
    const oppB = aSF.opponents.find(o => o.pairKey === 'B')!;
    // pairWinProbability(2000,1600) = 1/(1+10^(-400/400)) = 0.909...
    expect(oppB.winProb).toBeCloseTo(0.9090909, 4);
    // A always meets B in the SF (fixed bracket neighbor), so reachProb≈1.
    expect(oppB.reachProb).toBeGreaterThan(0.99);
  });
});

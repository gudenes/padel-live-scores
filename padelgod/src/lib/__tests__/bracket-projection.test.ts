import { describe, it, expect } from 'vitest';
import { projectPairs, matchupKey, type FrontierEntrant } from '../bracket-projection.js';
import { buildFirstRoundLeaves } from '../bracket-builder.js';

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

describe('projectPairs — byes and invariants', () => {
  it('a pair with a bye reaches the next round with prob 1', () => {
    // 4 slots, slot 1 is null => A (slot 0) gets a bye into the F.
    const entrants = [pair('A', 1800), null, pair('C', 1800), pair('D', 1800)];
    const res = projectPairs({ entrants, runs: 4000, rng: mulberry32(99) });
    const aF = res.get('A')!.rounds.find(r => r.round === 'F')!;
    expect(aF.reachProb).toBeCloseTo(1, 5); // A always reaches the final
    // A has no SF opponent (bye), so its SF opponents list is empty.
    const aSF = res.get('A')!.rounds.find(r => r.round === 'SF')!;
    expect(aSF.opponents.length).toBe(0);
  });

  it('champion probabilities across all pairs sum to ~1', () => {
    const entrants = [pair('A', 1900), pair('B', 1700), pair('C', 1850), pair('D', 1750)];
    const res = projectPairs({ entrants, runs: 20000, rng: mulberry32(5) });
    const total = [...res.values()].reduce((s, p) => s + p.championProb, 0);
    expect(total).toBeCloseTo(1, 2);
  });

  it('throws on non-power-of-2 entrant counts', () => {
    expect(() => projectPairs({ entrants: [pair('A', 1800), pair('B', 1800), pair('C', 1800)], runs: 10 }))
      .toThrow(/power of 2/);
  });
});

describe('projectPairs — forced (decided) results', () => {
  it('forces the known winner and gives the loser champion 0', () => {
    const entrants = [pair('A', 1800), pair('B', 1800), pair('C', 1800), pair('D', 1800)]
    const decided = new Map<string, string>([
      [matchupKey('A', 'B'), 'A'],
      [matchupKey('C', 'D'), 'C'],
      [matchupKey('A', 'C'), 'A'],
    ])
    const res = projectPairs({ entrants, runs: 2000, rng: mulberry32(1), decided })
    expect(res.get('A')!.championProb).toBe(1)
    expect(res.get('B')!.championProb).toBe(0)
    expect(res.get('C')!.finalistProb).toBe(1)
    expect(res.get('D')!.championProb).toBe(0)
    const bSF = res.get('B')!.rounds.find(r => r.round === 'SF')!
    expect(bSF.reachProb).toBe(1)
    expect(bSF.opponents.map(o => o.pairKey)).toEqual(['A'])
    expect(res.get('B')!.rounds.find(r => r.round === 'F')!.reachProb).toBe(0)
  })

  it('mixes forced past with sampled future (one SF decided, the other open)', () => {
    const entrants = [pair('A', 2000), pair('B', 1600), pair('C', 1800), pair('D', 1800)]
    const decided = new Map<string, string>([[matchupKey('A', 'B'), 'A']])
    const res = projectPairs({ entrants, runs: 8000, rng: mulberry32(3), decided })
    expect(res.get('A')!.rounds.find(r => r.round === 'F')!.reachProb).toBe(1)
    expect(res.get('B')!.championProb).toBe(0)
    expect(res.get('C')!.finalistProb).toBeGreaterThan(0)
    expect(res.get('D')!.finalistProb).toBeGreaterThan(0)
  })

  it('matchupKey is order-independent', () => {
    expect(matchupKey('x', 'y')).toBe(matchupKey('y', 'x'))
  })
})

// ---------------------------------------------------------------------------
// Regression: a gap in the next round must not evict unrelated seeds.
// Rotterdam P2 2026 women — WD013 (a lucky loser the entry list didn't carry)
// was never ingested, and the positional next-round lookup then dropped seed 5
// (WD014) and seed 2 (WD015) from the bracket as collateral.
// ---------------------------------------------------------------------------
describe('buildFirstRoundLeaves — next-round gaps are local', () => {
  const cell = (
    heap: number, round: 'R32' | 'R16',
    p1: string | null, p2: string | null, s1: number | null, s2: number | null,
  ) => ({
    id: `m-${heap}`, round, round_canonical: round,
    widget_id_composite: `T:WD${String(heap).padStart(3, '0')}`,
    winner_pair: null,
    pair1_player1_id: p1, pair1_player2_id: p1 ? `${p1}b` : null,
    pair2_player1_id: p2, pair2_player2_id: p2 ? `${p2}b` : null,
    pair1_seed: s1, pair2_seed: s2,
  })
  const mk = (a: string, b: string) => ({ pairKey: `${a}::${b}`, playerIds: [a, b] as [string, string], teamElo: 1500 })
  const keysOf = (leaves: any[]) => leaves.filter(Boolean).map((l: any) => String(l.pairKey).split('::')[0])
  const has = (leaves: any[], id: string) => keysOf(leaves).includes(id)

  // Rotterdam P2 2026 women's draw, exactly: first round R32 (heap 16..31),
  // next round R16 (heap 8..15). The real R32 cells matter — they occupy the
  // positions a mis-shifted bye-lift would otherwise land on, which is what
  // turned "seed appears at the wrong slot" into "seed disappears entirely".
  const r32 = [
    cell(17, 'R32', 'a', 'b', null, null), cell(18, 'R32', 'c', 'd', null, null),
    cell(21, 'R32', 'e', 'f', null, null), cell(22, 'R32', 'g', 'h', null, null),
    cell(25, 'R32', 'i', 'j', null, null), cell(26, 'R32', 'k', 'l', null, null),
    cell(29, 'R32', 'm', 'n', null, null), cell(30, 'R32', 'o', 'p', null, null),
  ]
  // Seeds alternate sides exactly as FIP publishes them.
  const r16 = [
    cell(8, 'R16', 's1', null, 1, null), cell(9, 'R16', null, 's7', null, 7),
    cell(10, 'R16', 's6', null, 6, null), cell(11, 'R16', null, 's3', null, 3),
    cell(12, 'R16', 's4', null, 4, null), cell(13, 'R16', null, 's8', null, 8),
    cell(14, 'R16', 's5', null, 5, null), cell(15, 'R16', null, 's2', null, 2),
  ]

  it('lifts every byed seed when the next round is complete', () => {
    const leaves = buildFirstRoundLeaves([...r32, ...r16] as any, mk)
    for (const s of ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'])
      expect(has(leaves, s)).toBe(true)
  })

  it('loses ONLY the missing cell when one next-round row is absent', () => {
    // Drop WD013 (seed 8) — the exact Rotterdam shape.
    const withGap = [...r32, ...r16.filter(m => !m.widget_id_composite.endsWith('WD013'))]
    const leaves = buildFirstRoundLeaves(withGap as any, mk)
    expect(has(leaves, 's8')).toBe(false) // its own cell is genuinely gone
    // ...but the seeds positioned AFTER the gap must be untouched. With the
    // array-index lookup these two silently vanished.
    expect(has(leaves, 's5')).toBe(true)  // WD014
    expect(has(leaves, 's2')).toBe(true)  // WD015
    // and the ones before the gap are unaffected either way
    expect(has(leaves, 's1')).toBe(true)
  })
})

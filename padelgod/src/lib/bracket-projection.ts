// Pure, bracket-structure-aware Monte-Carlo projection engine.
// Unlike model-prediction-snapshot's monteCarlo() (which reshuffles pairs each
// run), this simulates the REAL remaining draw so we can report, per pair and
// per round: the probability of reaching the round, the distribution of
// opponents met there, and the analytic win prob against each.
//
// No dependency on the Next app's bracket-builder or @/types/match. The caller
// supplies frontier entrants already ordered in bracket order (index 2k vs
// 2k+1 are first-round opponents). Length must be a power of two; null = bye/TBD.

import { pairWinProbability } from './elo-model.js';

/** Order-independent key for a matchup between two pairKeys. */
export function matchupKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export type ProjRound = 'R64' | 'R32' | 'R16' | 'QF' | 'SF' | 'F';
export const PROJ_ROUND_ORDER: ProjRound[] = ['R64', 'R32', 'R16', 'QF', 'SF', 'F'];

export interface FrontierEntrant {
  pairKey: string;
  playerIds: [string, string];
  teamElo: number;
}

export interface ProjectionInput {
  /** Bracket-ordered competitors entering the frontier round. Power-of-2
   *  length; null = bye or not-yet-known. Index 2k vs 2k+1 are opponents. */
  entrants: (FrontierEntrant | null)[];
  runs: number;
  /** Injectable for deterministic tests. Defaults to Math.random. */
  rng?: () => number;
  /** Matchup → winner pairKey. When a simulated match is in this map, the
   *  winner is forced (no rng draw). Key via matchupKey(aKey, bKey). Used to
   *  pin already-played results so the sim reflects reality + projects forward. */
  decided?: Map<string, string>;
}

export interface OpponentChance {
  pairKey: string;
  playerIds: [string, string];
  /** Unconditional P(tracked pair reaches this round AND faces this opponent). */
  reachProb: number;
  /** Analytic P(tracked beats this opponent | they meet). */
  winProb: number;
}

export interface PairRound {
  round: ProjRound;
  /** P(tracked pair competes in this round). */
  reachProb: number;
  opponents: OpponentChance[];
}

export interface PairProjection {
  pairKey: string;
  playerIds: [string, string];
  championProb: number;
  finalistProb: number;
  semifinalProb: number;
  rounds: PairRound[];
}

function isPow2(n: number): boolean {
  return n >= 1 && (n & (n - 1)) === 0;
}

export function projectPairs(input: ProjectionInput): Map<string, PairProjection> {
  const { entrants, runs, decided } = input;
  const rng = input.rng ?? Math.random;
  if (!isPow2(entrants.length)) {
    throw new Error(`entrants.length must be a power of 2, got ${entrants.length}`);
  }

  const numRounds = Math.log2(entrants.length);
  const roundLabels = PROJ_ROUND_ORDER.slice(PROJ_ROUND_ORDER.length - numRounds);

  // Per-pair tallies.
  type Tally = {
    entrant: FrontierEntrant;
    reach: number[];                          // reach[roundIdx] = count
    champ: number;
    opp: Map<number, Map<string, number>>;    // roundIdx -> oppKey -> meet count
  };
  const tally = new Map<string, Tally>();
  for (const e of entrants) {
    if (e) {
      tally.set(e.pairKey, {
        entrant: e,
        reach: new Array(numRounds).fill(0),
        champ: 0,
        opp: new Map(),
      });
    }
  }

  const noteOpp = (t: Tally, roundIdx: number, oppKey: string) => {
    let m = t.opp.get(roundIdx);
    if (!m) { m = new Map(); t.opp.set(roundIdx, m); }
    m.set(oppKey, (m.get(oppKey) ?? 0) + 1);
  };

  for (let run = 0; run < runs; run++) {
    let level: (FrontierEntrant | null)[] = entrants;
    for (let r = 0; r < numRounds; r++) {
      // Record reach for everyone alive at the start of this round.
      for (const e of level) if (e) { const t2 = tally.get(e.pairKey)!; t2.reach[r] = (t2.reach[r] ?? 0) + 1; }
      const next: (FrontierEntrant | null)[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const a = level[i] ?? null;
        const b = level[i + 1] ?? null;
        if (a && b) {
          noteOpp(tally.get(a.pairKey)!, r, b.pairKey);
          noteOpp(tally.get(b.pairKey)!, r, a.pairKey);
          const forced = decided?.get(matchupKey(a.pairKey, b.pairKey));
          if (forced) {
            next.push(forced === a.pairKey ? a : b);
          } else {
            const pA = pairWinProbability(a.teamElo, b.teamElo);
            next.push(rng() < pA ? a : b);
          }
        } else {
          next.push(a ?? b); // bye (or null vs null)
        }
      }
      level = next;
    }
    const champ = level[0];
    if (champ) tally.get(champ.pairKey)!.champ++;
  }

  const fIdx = roundLabels.indexOf('F');
  const sfIdx = roundLabels.indexOf('SF');

  const out = new Map<string, PairProjection>();
  for (const [key, t] of tally) {
    const rounds: PairRound[] = roundLabels.map((round, rIdx) => {
      const oppMap = t.opp.get(rIdx) ?? new Map<string, number>();
      const opponents: OpponentChance[] = [...oppMap.entries()]
        .map(([oppKey, count]) => {
          const opp = tally.get(oppKey)!.entrant;
          return {
            pairKey: oppKey,
            playerIds: opp.playerIds,
            reachProb: count / runs,
            winProb: pairWinProbability(t.entrant.teamElo, opp.teamElo),
          };
        })
        .sort((x, y) => y.reachProb - x.reachProb);
      return { round, reachProb: (t.reach[rIdx] ?? 0) / runs, opponents };
    });
    out.set(key, {
      pairKey: key,
      playerIds: t.entrant.playerIds,
      championProb: t.champ / runs,
      finalistProb: fIdx >= 0 ? (t.reach[fIdx] ?? 0) / runs : 0,
      semifinalProb: sfIdx >= 0 ? (t.reach[sfIdx] ?? 0) / runs : 0,
      rounds,
    });
  }
  return out;
}

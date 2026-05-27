// Pure-function module for the Elo + Monte Carlo odds model.
// See docs/superpowers/specs/2026-05-27-elo-odds-model-design.md for full methodology.
// All math is shared between scripts/simulate-elo-tournaments.ts and the
// padelgod workers (model-prediction-snapshot, prediction-scorer).

export const MODEL_VERSION = 'v0-td180-fip-prior';

// ─── Cold-start prior ────────────────────────────────────────────────────────
//   rank 1   → 2200
//   rank 10  → ~1950
//   rank 50  → ~1675
//   rank 200 → ~1225
//   floored at 1100 for very-low-ranked / unranked-but-given-a-number cases
//   defaults to 1300 for null / 0 / negative
export function fipPriorElo(ranking: number | null | undefined): number {
  if (!ranking || ranking <= 0) return 1300;
  return Math.max(1100, 2200 - 250 * Math.log10(ranking));
}

// ─── K-factor by tournament tier ─────────────────────────────────────────────
export function kFactor(level: string | null | undefined): number {
  const l = (level ?? '').toLowerCase();
  if (l === 'major' || l === 'p1' || l === 'premier_p1') return 36;
  if (l === 'p2' || l === 'premier_p2' || l === 'fip_platinum') return 30;
  if (l === 'fip_gold') return 24;
  if (l === 'fip_silver') return 20;
  if (l === 'fip_bronze' || l === 'fip_beyond' || l === 'fip_promises') return 14;
  return 18;
}

// ─── Time decay ──────────────────────────────────────────────────────────────
// K_effective = K_tier × 0.5 ^ (ageDays / halflifeDays). Negative ages
// (defensive — shouldn't happen given asOf anchoring) are clamped to 0.
export function decayWeight(ageDays: number, halflifeDays: number): number {
  const age = Math.max(0, ageDays);
  return Math.pow(0.5, age / halflifeDays);
}

// ─── Per-match win probability ───────────────────────────────────────────────
// Standard Elo logistic. Pair Elo expected to be the arithmetic mean of the
// two players' individual Elos — caller's responsibility.
export function pairWinProbability(eloPair1: number, eloPair2: number): number {
  return 1 / (1 + Math.pow(10, (eloPair2 - eloPair1) / 400));
}

// ─── Odds conversions ────────────────────────────────────────────────────────
// All operate on fair probabilities (no vig). Reading guide for outputs:
//   decimal 1.84   → bet $1, win $0.84 profit
//   american -119  → bet $119 to win $100 profit (favourite)
//   american +217  → bet $100 to win $217 profit (underdog)

export function toDecimal(p: number): number {
  if (p <= 0) return 999.99;
  return 1 / p;
}

export function toAmerican(p: number): number {
  if (p >= 0.5) return -Math.round((100 * p) / (1 - p));
  return Math.round((100 * (1 - p)) / p);
}

export function toFractional(p: number): string {
  if (p <= 0) return '999/1';
  if (p >= 1) return '1/999';
  const ratio = (1 - p) / p;
  if (ratio < 1) {
    const denom = Math.round(1 / ratio);
    return `1/${denom}`;
  }
  // Pick the nicest denominator from 1..6
  const candidates: Array<[number, number]> = [];
  for (let d = 1; d <= 6; d++) {
    const n = Math.round(ratio * d);
    if (n >= 1) candidates.push([n, d]);
  }
  let best = candidates[0]!;
  let bestErr = Infinity;
  for (const [n, d] of candidates) {
    const err = Math.abs(ratio - n / d);
    if (err < bestErr) {
      bestErr = err;
      best = [n, d];
    }
  }
  return `${best[0]}/${best[1]}`;
}

// ─── Calibration scoring ─────────────────────────────────────────────────────
// brierScore: predictedProb is the prob assigned to the side that ACTUALLY
//             won. actual is always 1 in this caller pattern (we pass the
//             prob-for-winner, not prob-for-pair1). Lower is better, perfect=0.
export function brierScore(predictedProbWinner: number, actual: 0 | 1): number {
  return Math.pow(predictedProbWinner - actual, 2);
}

// logLoss: clamped near 0 to avoid +Infinity from numerical edge cases.
export function logLoss(predictedProbWinner: number): number {
  const clamped = Math.max(1e-6, predictedProbWinner);
  return -Math.log(clamped);
}

// ─── Elo training ────────────────────────────────────────────────────────────
// Trains per-player Elo over chronologically-ordered matches.
// asOfIso anchors the time-decay weight so backtests and live use the same
// formula without "now()" drift.

export interface TrainingMatch {
  id: string;
  tournament_id: string | null;
  finished_at: string | null;
  scheduled_at: string | null;
  pair1_player1_id: string | null;
  pair1_player2_id: string | null;
  pair2_player1_id: string | null;
  pair2_player2_id: string | null;
  winner_pair: number | null;
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  ranking: number | null;
  category: string | null;
}

export interface TrainResult {
  elo: Map<string, number>;
  eloFormStart: Map<string, number>;
  halflifeDays: number;
  trainedCount: number;
}

export const FORM_WINDOW_DAYS = 30;

export function trainElo(
  matches: TrainingMatch[],
  players: Map<string, PlayerSnapshot>,
  tournamentLevels: Map<string, string>,
  asOfIso: string,
  halflifeDays: number,
): TrainResult {
  const elo = new Map<string, number>();
  const asOfMs = new Date(asOfIso).getTime();
  const formSnapshotCutoffMs = asOfMs - FORM_WINDOW_DAYS * 86_400_000;
  let eloFormStart: Map<string, number> | null = null;

  const getR = (pid: string): number => {
    let r = elo.get(pid);
    if (r == null) {
      r = fipPriorElo(players.get(pid)?.ranking ?? null);
      elo.set(pid, r);
    }
    return r;
  };

  let trained = 0;
  for (const m of matches) {
    if (
      !m.pair1_player1_id || !m.pair1_player2_id ||
      !m.pair2_player1_id || !m.pair2_player2_id ||
      (m.winner_pair !== 1 && m.winner_pair !== 2)
    ) {
      continue;
    }
    const matchMs = new Date(m.scheduled_at ?? m.finished_at ?? asOfIso).getTime();
    if (!eloFormStart && matchMs >= formSnapshotCutoffMs) {
      eloFormStart = new Map(elo);
    }
    const r1a = getR(m.pair1_player1_id);
    const r1b = getR(m.pair1_player2_id);
    const r2a = getR(m.pair2_player1_id);
    const r2b = getR(m.pair2_player2_id);
    const t1 = (r1a + r1b) / 2;
    const t2 = (r2a + r2b) / 2;
    const expected1 = pairWinProbability(t1, t2);
    const actual1 = m.winner_pair === 1 ? 1 : 0;
    const kBase = kFactor(tournamentLevels.get(m.tournament_id ?? '') ?? null);
    const ageDays = Math.max(0, (asOfMs - matchMs) / 86_400_000);
    const k = kBase * decayWeight(ageDays, halflifeDays);
    const delta = k * (actual1 - expected1);
    elo.set(m.pair1_player1_id, r1a + delta);
    elo.set(m.pair1_player2_id, r1b + delta);
    elo.set(m.pair2_player1_id, r2a - delta);
    elo.set(m.pair2_player2_id, r2b - delta);
    trained++;
  }
  if (!eloFormStart) eloFormStart = new Map(elo);
  return { elo, eloFormStart, halflifeDays, trainedCount: trained };
}

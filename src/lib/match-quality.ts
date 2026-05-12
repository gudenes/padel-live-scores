// src/lib/match-quality.ts
//
// Pure scoring function for upcoming padel matches.
// 0–100 integer score blending player ranking parity, star presence,
// tournament tier and round multipliers. Internal-only — drives the
// ops highlight picker; feed-ranking integration deferred.
// See docs/superpowers/specs/2026-05-12-match-quality-score-design.md.

export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))

/** Elo-style expected win for pair A vs pair B (using effective pair ranks). */
export const pWin = (pA: number, pB: number): number =>
  1 / (1 + 10 ** ((pA - pB) / 400))

/** Parity: 1.0 = perfectly even, 0.0 = certain blowout. */
export const parity = (pWinA: number): number => 1 - 2 * Math.abs(pWinA - 0.5)

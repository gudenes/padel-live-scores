/**
 * Pure resolver: map a webtuga feed row to one of our pre-existing draw matches
 * by surname-token overlap, scoped to the tournament's matches + mapped category.
 *
 * webtuga's player names are abbreviated ("A. Garcia") and occasionally carry
 * the wrong first name ("Inés Caño" for our "Vega Cano Ortin"), so we match on
 * SURNAME tokens only and rely on pair context (both teams) for confidence.
 * Verified 2026-06-16: 16/16 live+upcoming matches resolved, 0 ambiguous.
 */
import type { ResolvedPlayers } from './point-reconstruction.js';
import type { WebtugaFeedRow } from './webtuga-types.js';

export interface CandidateMatch {
  id: string;
  category: 'men' | 'women';
  pair1Player1Id: string | null;
  pair1Player2Id: string | null;
  pair2Player1Id: string | null;
  pair2Player2Id: string | null;
  pair1Player1Name: string | null;
  pair1Player2Name: string | null;
  pair2Player1Name: string | null;
  pair2Player2Name: string | null;
}

export type ResolveResult =
  | { matchId: string; orientation: 'AB' | 'BA'; resolvedPlayers: ResolvedPlayers }
  | { ambiguous: true }
  | null;

const CATEGORY_MAP: Record<string, 'men' | 'women'> = {
  Femininos: 'women',
  Masculinos: 'men',
};

function strip(s: string | null): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Surname tokens = tokens of length >= 3 (drops single-letter initials). */
function surnameTokens(full: string | null): Set<string> {
  return new Set(strip(full).split(' ').filter((t) => t.length >= 3));
}

/**
 * Count how many of a webtuga team's surname tokens appear in a DB pair.
 *
 * The webtuga side is a LIST, not a Set: a same-surname pair (e.g.
 * "M. Para / J. Para") must count both members, so deduping the token would
 * silently halve the score. The DB side stays a Set — we want "how many of
 * webtuga's tokens are present in the pair", not a cross-multiplied count.
 */
function teamScore(webTeam: string, dbA: string | null, dbB: string | null): number {
  const webTokens = strip(webTeam.replace('/', ' '))
    .split(' ')
    .filter((t) => t.length >= 3);
  const db = new Set([...surnameTokens(dbA), ...surnameTokens(dbB)]);
  let hit = 0;
  for (const t of webTokens) if (db.has(t)) hit++;
  return hit;
}

const MIN_SCORE = 2;

export function resolveWebtugaMatch(
  row: WebtugaFeedRow,
  candidates: CandidateMatch[],
): ResolveResult {
  const cat = CATEGORY_MAP[row.category];

  const scored = candidates
    .filter((m) => !cat || m.category === cat)
    .map((m) => {
      const ab = teamScore(row.teamA, m.pair1Player1Name, m.pair1Player2Name)
        + teamScore(row.teamB, m.pair2Player1Name, m.pair2Player2Name);
      const ba = teamScore(row.teamA, m.pair2Player1Name, m.pair2Player2Name)
        + teamScore(row.teamB, m.pair1Player1Name, m.pair1Player2Name);
      const orientation: 'AB' | 'BA' = ab >= ba ? 'AB' : 'BA';
      return { m, ab, ba, score: Math.max(ab, ba), orientation };
    })
    .filter((x) => x.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (!top) return null;
  if (scored[1] && scored[1].score === top.score) return { ambiguous: true };
  // Orientation coin-flip: when AB and BA score identically the orientation is
  // undetermined, and orientation drives which player each point is credited to.
  // Treat as ambiguous (skip + counter) rather than risk a silent misassignment.
  if (top.ab === top.ba) return { ambiguous: true };

  return {
    matchId: top.m.id,
    orientation: top.orientation,
    resolvedPlayers: {
      pair1Player1Id: top.m.pair1Player1Id,
      pair1Player2Id: top.m.pair1Player2Id,
      pair2Player1Id: top.m.pair2Player1Id,
      pair2Player2Id: top.m.pair2Player2Id,
    },
  };
}

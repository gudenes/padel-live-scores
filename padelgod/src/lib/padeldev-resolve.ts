/**
 * Pure resolver: map a padeldev tournament entry onto one of our pre-existing
 * matches, by surname-token overlap scoped to the tournament + category.
 *
 * Deliberately does NOT use court, even though padeldev supplies one. The court
 * names genuinely disagree between sources — padeldev says "Piste 2" where our
 * Crionet-sourced rows say "PISTE 2 AUVERGNE RHONES ALPES" — so matching on it
 * would add a failure mode without adding discrimination that surnames don't
 * already provide.
 *
 * The name handling mirrors webtuga-resolve.ts, which was verified 16/16 on a
 * live event. padeldev needs the same tolerances:
 *   - abbreviated given names ("S. Merah")   → match on surname tokens only
 *   - truncated surnames ("M. Delgado" for our "Marta Delgado Medina")
 *   - pair order differs between the two feeds → score both orientations
 *
 * Fails CLOSED: an unmatched or tied entry returns null / {ambiguous} and the
 * caller skips it. Never attaches points to a best guess.
 */
import type { ResolvedPlayers } from './point-reconstruction.js';
import type { PadeldevTournamentMatch } from './padeldev-types.js';

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

/**
 * padeldev categories read "Women - Round of 32" / "Men Q1" — gender is the
 * leading token. Anything else (e.g. a mixed draw) returns null, which the
 * caller treats as "don't filter" rather than "no match".
 */
export function padeldevCategory(raw: string): 'men' | 'women' | null {
  const first = (raw ?? '').trim().toLowerCase().split(/[\s-]+/)[0];
  if (first === 'women' || first === 'woman') return 'women';
  if (first === 'men' || first === 'man') return 'men';
  return null;
}

function strip(s: string | null): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Surname tokens = tokens of length >= 3, which drops single-letter initials. */
function surnameTokens(full: string | null): Set<string> {
  return new Set(strip(full).split(' ').filter((t) => t.length >= 3));
}

/**
 * How many of a padeldev team's surname tokens appear in one of our pairs.
 *
 * The padeldev side stays a LIST, not a Set: a same-surname pair ("M. Para /
 * J. Para") must count both members, and deduping the token would silently
 * halve the score. The DB side is a Set — the question is "how many of
 * padeldev's tokens are present in this pair", not a cross-product.
 */
function teamScore(
  names: Array<string | null>,
  dbA: string | null,
  dbB: string | null,
): number {
  const webTokens = names.flatMap((n) => strip(n).split(' ').filter((t) => t.length >= 3));
  const db = new Set([...surnameTokens(dbA), ...surnameTokens(dbB)]);
  let hit = 0;
  for (const t of webTokens) if (db.has(t)) hit++;
  return hit;
}

const MIN_SCORE = 2;

export function resolvePadeldevMatch(
  entry: PadeldevTournamentMatch,
  candidates: CandidateMatch[],
): ResolveResult {
  const cat = padeldevCategory(entry.category);
  const teamA = [entry.playername1, entry.playername2];
  const teamB = [entry.playername3, entry.playername4];

  const scored = candidates
    .filter((m) => !cat || m.category === cat)
    .map((m) => {
      // Score each team independently per orientation. BOTH teams must
      // contribute at least one surname for an orientation to be valid —
      // otherwise a single shared pair appearing in an unrelated entry could
      // hijack the wrong match.
      const abA = teamScore(teamA, m.pair1Player1Name, m.pair1Player2Name);
      const abB = teamScore(teamB, m.pair2Player1Name, m.pair2Player2Name);
      const baA = teamScore(teamA, m.pair2Player1Name, m.pair2Player2Name);
      const baB = teamScore(teamB, m.pair1Player1Name, m.pair1Player2Name);
      const ab = abA + abB;
      const ba = baA + baB;
      const abValid = abA >= 1 && abB >= 1;
      const baValid = baA >= 1 && baB >= 1;

      let orientation: 'AB' | 'BA' | null = null;
      let score = 0;
      if (abValid && baValid) {
        orientation = ab >= ba ? 'AB' : 'BA';
        score = Math.max(ab, ba);
      } else if (abValid) {
        orientation = 'AB';
        score = ab;
      } else if (baValid) {
        orientation = 'BA';
        score = ba;
      }
      return { m, ab, ba, score, orientation, bothValid: abValid && baValid };
    })
    .filter((x) => x.orientation !== null && x.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (!top) return null;
  if (scored[1] && scored[1].score === top.score) return { ambiguous: true };
  // Orientation coin-flip: if both orientations are valid AND tie, orientation
  // is undetermined — and it decides which player each point is credited to.
  // Treat as ambiguous rather than risk a silent misassignment.
  if (top.bothValid && top.ab === top.ba) return { ambiguous: true };

  return {
    matchId: top.m.id,
    orientation: top.orientation as 'AB' | 'BA',
    resolvedPlayers: {
      pair1Player1Id: top.m.pair1Player1Id,
      pair1Player2Id: top.m.pair1Player2Id,
      pair2Player1Id: top.m.pair2Player1Id,
      pair2Player2Id: top.m.pair2Player2Id,
    },
  };
}

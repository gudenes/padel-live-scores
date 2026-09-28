import { describe, it, expect } from 'vitest';
import { resolvePadeldevMatch, padeldevCategory } from '../../lib/padeldev-resolve.js';
import type { CandidateMatch } from '../../lib/padeldev-resolve.js';
import type { PadeldevTournamentMatch } from '../../lib/padeldev-types.js';

function entry(over: Partial<PadeldevTournamentMatch> = {}): PadeldevTournamentMatch {
  return {
    url: 'https://x/?id=vcfqri.json',
    idlocal: 0, idwatch: 0,
    category: 'Women - Round of 32',
    scheduled: '20260923173000000',
    playername1: 'S. Merah', nationality1: 'FR',
    playername2: 'C. Soubrie', nationality2: 'FR',
    playername3: 'G. Rosi', nationality3: 'IT',
    playername4: 'M. Delgado', nationality4: 'ES',
    isfinished: 0, winningteam: 0, retiredteam: 0,
    score: '30-40 1/0 3/6 0/0 0/0',
    ...over,
  };
}

function cand(over: Partial<CandidateMatch> = {}): CandidateMatch {
  return {
    id: 'm-1',
    category: 'women',
    pair1Player1Id: 'p1', pair1Player2Id: 'p2',
    pair2Player1Id: 'p3', pair2Player2Id: 'p4',
    pair1Player1Name: 'Sarah Merah',
    pair1Player2Name: 'Celine Soubrie',
    pair2Player1Name: 'Marta Delgado Medina',
    pair2Player2Name: 'Giulia Rosi',
    ...over,
  };
}

describe('padeldevCategory', () => {
  it('reads gender from the leading token', () => {
    expect(padeldevCategory('Women - Round of 32')).toBe('women');
    expect(padeldevCategory('Men Q1')).toBe('men');
    expect(padeldevCategory('Men - Quarterfinals')).toBe('men');
  });
  it('returns null for an unrecognised category rather than guessing', () => {
    expect(padeldevCategory('Mixed - Final')).toBeNull();
    expect(padeldevCategory('')).toBeNull();
  });
});

describe('resolvePadeldevMatch', () => {
  it('resolves despite truncated surnames and swapped pair order', () => {
    // padeldev says "M. Delgado"; our DB has "Marta Delgado Medina".
    // padeldev lists Rosi before Delgado; our DB has them the other way round.
    const r = resolvePadeldevMatch(entry(), [cand()]);
    expect(r).not.toBeNull();
    expect(r).not.toHaveProperty('ambiguous');
    if (r && !('ambiguous' in r)) {
      expect(r.matchId).toBe('m-1');
      expect(r.orientation).toBe('AB');
      expect(r.resolvedPlayers.pair1Player1Id).toBe('p1');
    }
  });

  it('detects BA orientation when our pair1 is padeldev team B', () => {
    const flipped = cand({
      pair1Player1Name: 'Marta Delgado Medina',
      pair1Player2Name: 'Giulia Rosi',
      pair2Player1Name: 'Sarah Merah',
      pair2Player2Name: 'Celine Soubrie',
    });
    const r = resolvePadeldevMatch(entry(), [flipped]);
    if (r && !('ambiguous' in r)) expect(r.orientation).toBe('BA');
    else throw new Error('expected a resolution');
  });

  it('ignores candidates in the other category', () => {
    expect(resolvePadeldevMatch(entry(), [cand({ category: 'men' })])).toBeNull();
  });

  it('returns null when nothing matches rather than guessing', () => {
    const other = cand({
      pair1Player1Name: 'Ana Lopez', pair1Player2Name: 'Eva Ruiz',
      pair2Player1Name: 'Nuria Vega', pair2Player2Name: 'Pilar Diaz',
    });
    expect(resolvePadeldevMatch(entry(), [other])).toBeNull();
  });

  it('requires BOTH teams to contribute, so one shared pair cannot hijack', () => {
    // Merah/Soubrie are right, but the opposing pair belongs to another match.
    const halfMatch = cand({
      id: 'm-wrong',
      pair2Player1Name: 'Ana Lopez', pair2Player2Name: 'Eva Ruiz',
    });
    expect(resolvePadeldevMatch(entry(), [halfMatch])).toBeNull();
  });

  it('flags a tie between two equally-scoring candidates as ambiguous', () => {
    const a = cand({ id: 'm-a' });
    const b = cand({ id: 'm-b' });
    expect(resolvePadeldevMatch(entry(), [a, b])).toEqual({ ambiguous: true });
  });

  it('counts a same-surname pair twice instead of deduping it away', () => {
    const e = entry({
      playername1: 'M. Para', playername2: 'J. Para',
      playername3: 'G. Rosi', playername4: 'M. Delgado',
    });
    const c = cand({
      pair1Player1Name: 'Miguel Para', pair1Player2Name: 'Juan Para',
    });
    const r = resolvePadeldevMatch(e, [c]);
    expect(r).not.toBeNull();
    expect(r).not.toHaveProperty('ambiguous');
  });
});

import { describe, it, expect } from 'vitest';
import { resolveWebtugaMatch, type CandidateMatch } from '../../lib/webtuga-resolve.js';

const garciaMatch: CandidateMatch = {
  id: 'uuid-garcia',
  category: 'women',
  pair1Player1Id: 'p-aitana',
  pair1Player2Id: 'p-cayetana',
  pair2Player1Id: 'p-vega',
  pair2Player2Id: 'p-carla',
  pair1Player1Name: 'Aitana Garcia Roman',
  pair1Player2Name: 'Cayetana Sanchez Vera',
  pair2Player1Name: 'Vega Cano Ortin',
  pair2Player2Name: 'Carla Aguila Tello',
};

const arteagaMatch: CandidateMatch = {
  id: 'uuid-arteaga',
  category: 'women',
  pair1Player1Id: 'p-mariaa',
  pair1Player2Id: 'p-nerea',
  pair2Player1Id: 'p-mgarin',
  pair2Player2Id: 'p-mfernandes',
  pair1Player1Name: 'Maria Arteaga Vilches',
  pair1Player2Name: 'Nerea Gomez Blazquez',
  pair2Player1Name: 'Maria Garin',
  pair2Player2Name: 'Margarida Fernandes',
};

function feed(over: Partial<any> = {}) {
  return {
    id: 2,
    category: 'Femininos',
    teamA: 'A. Garcia / C. Sánchez',
    teamB: 'I. Caño / C. Aguila',
    ...over,
  } as any;
}

describe('resolveWebtugaMatch', () => {
  it('resolves the Garcia match in AB orientation despite first-name drift (Inés vs Vega Caño)', () => {
    const r = resolveWebtugaMatch(feed(), [garciaMatch, arteagaMatch]);
    expect(r && 'matchId' in r ? r.matchId : null).toBe('uuid-garcia');
    expect(r && 'orientation' in r ? r.orientation : null).toBe('AB');
    expect(r && 'resolvedPlayers' in r ? r.resolvedPlayers.pair1Player1Id : null).toBe('p-aitana');
  });

  it('detects BA orientation when webtuga team A maps to our pair2', () => {
    const r = resolveWebtugaMatch(
      feed({ teamA: 'I. Caño / C. Aguila', teamB: 'A. Garcia / C. Sánchez' }),
      [garciaMatch],
    );
    expect(r && 'orientation' in r ? r.orientation : null).toBe('BA');
  });

  it('returns null when no candidate shares enough surnames', () => {
    const r = resolveWebtugaMatch(
      feed({ teamA: 'X. Unknown / Y. Stranger', teamB: 'Z. Nobody / W. Nadie' }),
      [garciaMatch, arteagaMatch],
    );
    expect(r).toBeNull();
  });

  it('only considers matches of the mapped category', () => {
    const menMatch = { ...garciaMatch, id: 'uuid-men', category: 'men' as const };
    const r = resolveWebtugaMatch(feed(), [menMatch]);
    expect(r).toBeNull();
  });

  it('flags ambiguity when two candidates tie on the top score', () => {
    const dup = { ...garciaMatch, id: 'uuid-garcia-2' };
    const r = resolveWebtugaMatch(feed(), [garciaMatch, dup]);
    expect(r && 'ambiguous' in r ? r.ambiguous : false).toBe(true);
  });

  it('flags ambiguity on a symmetric AB/BA orientation tie', () => {
    // Both pairs share the same two surnames, so AB and BA score identically —
    // orientation is a coin-flip and must not be guessed.
    const symmetric: CandidateMatch = {
      id: 'uuid-symmetric',
      category: 'women',
      pair1Player1Id: 'a', pair1Player2Id: 'b',
      pair2Player1Id: 'c', pair2Player2Id: 'd',
      pair1Player1Name: 'Ana Lopez', pair1Player2Name: 'Bea Garcia',
      pair2Player1Name: 'Cris Lopez', pair2Player2Name: 'Dora Garcia',
    };
    const r = resolveWebtugaMatch(
      feed({ teamA: 'X. Lopez / Y. Garcia', teamB: 'Z. Lopez / W. Garcia' }),
      [symmetric],
    );
    expect(r && 'ambiguous' in r ? r.ambiguous : false).toBe(true);
  });

  it('rejects a single-pair partial match (only one team overlaps)', () => {
    // Real Lusitania false-positive: feed #20 (Santos/Azcoitia vs Melo/Roman)
    // shares ONLY the Melo/Roman pair with the Bragança/Teixeira-vs-Melo/Roman
    // match. One team overlapping must NOT resolve — both teams are required.
    const braganca: CandidateMatch = {
      id: 'uuid-br',
      category: 'women',
      pair1Player1Id: 'a', pair1Player2Id: 'b',
      pair2Player1Id: 'c', pair2Player2Id: 'd',
      pair1Player1Name: 'Francisca Bragança', pair1Player2Name: 'Maria Leonor Araujo Teixeira',
      pair2Player1Name: 'Patricia Roman Aldea', pair2Player2Name: 'Bruna Albuquerque Melo',
    };
    const r = resolveWebtugaMatch(
      feed({ teamA: 'C. Santos / C. Azcoitia', teamB: 'B. Melo / P. Roman' }),
      [braganca],
    );
    expect(r).toBeNull();
  });

  it('counts both members of a same-surname pair (Para / Para)', () => {
    // Real id-8 Lusitania case. With a Set on the webtuga side this pair would
    // score 1 instead of 2; the list-based count keeps it resolvable.
    const para: CandidateMatch = {
      id: 'uuid-para',
      category: 'women',
      pair1Player1Id: 'a', pair1Player2Id: 'b',
      pair2Player1Id: 'c', pair2Player2Id: 'd',
      pair1Player1Name: 'Constanca Gorito', pair1Player2Name: 'Maria Francisca Santos',
      pair2Player1Name: 'Micaela Para', pair2Player2Name: 'Micaela Para',
    };
    const r = resolveWebtugaMatch(
      feed({ teamA: 'C. Gorito / F. Santos', teamB: 'M. Para / J. Para' }),
      [para],
    );
    expect(r && 'matchId' in r ? r.matchId : null).toBe('uuid-para');
    expect(r && 'orientation' in r ? r.orientation : null).toBe('AB');
  });
});

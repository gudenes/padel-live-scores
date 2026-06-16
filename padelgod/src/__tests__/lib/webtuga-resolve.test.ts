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
});

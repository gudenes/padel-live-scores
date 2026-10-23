import { describe, it, expect } from 'vitest';
import {
  buildTournamentDictionary,
  resolveShortName,
} from '../../lib/tournament-dictionary.js';

const PLAYERS = [
  { fipId: 'P001', name: 'Juan Lebron', country: 'ESP', partnerFipId: 'P002', partnerName: 'Federico Chingotto' },
  { fipId: 'P002', name: 'Federico Chingotto', country: 'ARG', partnerFipId: 'P001', partnerName: 'Juan Lebron' },
  { fipId: 'P003', name: 'Mario Lebron', country: 'ESP', partnerFipId: 'P004', partnerName: 'Other Partner' },
  { fipId: 'P004', name: 'Other Partner', country: 'ESP', partnerFipId: 'P003', partnerName: 'Mario Lebron' },
];

describe('buildTournamentDictionary + resolveShortName', () => {
  it('resolves a short name to single match (exact)', () => {
    const dict = buildTournamentDictionary(PLAYERS);
    const result = resolveShortName(dict, 'F. Chingotto');
    expect(result.fipId).toBe('P002');
    expect(result.confidence).toBe('exact');
  });

  it('disambiguates by partner when ambiguous', () => {
    const dict = buildTournamentDictionary(PLAYERS);
    const result = resolveShortName(dict, 'Lebron', 'F. Chingotto');
    expect(result.fipId).toBe('P001');
    expect(result.confidence).toBe('pair_disambiguated');
  });

  it('returns unresolved when ambiguous and no partner hint', () => {
    const dict = buildTournamentDictionary(PLAYERS);
    const result = resolveShortName(dict, 'Lebron');
    expect(result.fipId).toBeNull();
    expect(result.confidence).toBe('unresolved');
    expect(result.candidates).toEqual(expect.arrayContaining(['P001', 'P003']));
  });

  it('returns unresolved when nothing matches', () => {
    const dict = buildTournamentDictionary(PLAYERS);
    const result = resolveShortName(dict, 'XYZNotAName');
    expect(result.fipId).toBeNull();
    expect(result.confidence).toBe('unresolved');
  });
});

describe('October 2026 duplicate-player regressions', () => {
  it.each([
    ['Miguel Deus', 'Nuno Deus', 'M. Deus', 'N. Deus'],
    ['Mathias Hviid', 'Lasse Hviid', 'M. Hviid', 'L. Hviid'],
    ['Jose Nino', 'Diego Nino', 'J. Nino', 'D. Nino'],
    ['Micaela Para', 'Jessica Para', 'M. Para', 'J. Para'],
  ])('keeps %s and %s separate, regardless of roster order', (a, b, shortA, shortB) => {
    const players = [
      { fipId: 'A', name: a, country: null, partnerFipId: 'B', partnerName: b },
      { fipId: 'B', name: b, country: null, partnerFipId: 'A', partnerName: a },
    ];
    for (const roster of [players, [...players].reverse()]) {
      const dict = buildTournamentDictionary(roster);
      expect(resolveShortName(dict, shortA, shortB).fipId).toBe('A');
      expect(resolveShortName(dict, shortB, shortA).fipId).toBe('B');
    }
    // A missing sibling must never fall back to the only shared surname.
    expect(resolveShortName(buildTournamentDictionary([players[0]!]), shortB, shortA).fipId).toBeNull();
  });

  it('does not choose the first player when partner names are also ambiguous', () => {
    const dict = buildTournamentDictionary([
      { fipId: 'A', name: 'Miguel Deus', country: null, partnerName: 'Nuno Deus' },
      { fipId: 'B', name: 'Manuel Deus', country: null, partnerName: 'Nicolas Deus' },
    ]);
    expect(resolveShortName(dict, 'M. Deus', 'N. Deus').fipId).toBeNull();
  });

  it('does not discard a contradictory full given name', () => {
    const dict = buildTournamentDictionary(PLAYERS);
    expect(resolveShortName(dict, 'Miguel Lebron', 'Federico Chingotto').fipId).toBeNull();
  });

  it('deduplicates repeated snapshot identities before testing ambiguity', () => {
    const dict = buildTournamentDictionary([...PLAYERS, ...PLAYERS]);
    expect(resolveShortName(dict, 'J. Lebron').fipId).toBe('P001');
  });
});

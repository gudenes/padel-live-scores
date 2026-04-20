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

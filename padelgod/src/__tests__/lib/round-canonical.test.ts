import { describe, it, expect } from 'vitest';
import { roundCanonical } from '../../lib/round-canonical.js';

describe('roundCanonical', () => {
  it('maps short forms', () => {
    expect(roundCanonical('R64')).toBe('R64');
    expect(roundCanonical('R32')).toBe('R32');
    expect(roundCanonical('R16')).toBe('R16');
    expect(roundCanonical('QF')).toBe('QF');
    expect(roundCanonical('SF')).toBe('SF');
    expect(roundCanonical('F')).toBe('F');
    expect(roundCanonical('Q1')).toBe('Q1');
  });

  it('maps verbose forms', () => {
    expect(roundCanonical('Round of 64')).toBe('R64');
    expect(roundCanonical('Round of 32')).toBe('R32');
    expect(roundCanonical('Round of 16')).toBe('R16');
    expect(roundCanonical('Quarterfinals')).toBe('QF');
    expect(roundCanonical('Semifinals')).toBe('SF');
    expect(roundCanonical('Finals')).toBe('F');
    expect(roundCanonical('Final')).toBe('F');
  });

  it('case- and whitespace-insensitive', () => {
    expect(roundCanonical('r64')).toBe('R64');
    expect(roundCanonical(' R64 ')).toBe('R64');
    expect(roundCanonical('ROUND OF 16')).toBe('R16');
  });

  it('returns null for unrecognized / empty / null input', () => {
    expect(roundCanonical(null)).toBeNull();
    expect(roundCanonical(undefined)).toBeNull();
    expect(roundCanonical('')).toBeNull();
    expect(roundCanonical('   ')).toBeNull();
    expect(roundCanonical('MD002')).toBeNull();
    expect(roundCanonical('1st ROUND')).toBeNull();
  });
});

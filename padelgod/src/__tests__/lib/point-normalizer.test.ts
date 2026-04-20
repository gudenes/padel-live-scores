import { describe, it, expect } from 'vitest';
import {
  normalizePadelapiPoint,
  normalizePadelgodPoint,
  pointEq,
} from '../../lib/point-normalizer.js';

describe('normalizePadelapiPoint', () => {
  it('parses 0:0', () => {
    expect(normalizePadelapiPoint('0:0')).toEqual({ kind: 'regular', team1: 0, team2: 0 });
  });
  it('parses 15:30', () => {
    expect(normalizePadelapiPoint('15:30')).toEqual({ kind: 'regular', team1: 15, team2: 30 });
  });
  it('parses 40:40 → deuce', () => {
    expect(normalizePadelapiPoint('40:40')).toEqual({ kind: 'deuce' });
  });
  it('parses AD:40 → advantage side 1', () => {
    expect(normalizePadelapiPoint('AD:40')).toEqual({ kind: 'advantage', side: 1 });
  });
  it('parses 40:AD → advantage side 2', () => {
    expect(normalizePadelapiPoint('40:AD')).toEqual({ kind: 'advantage', side: 2 });
  });
  it('parses lowercase ad:40 case-insensitively', () => {
    expect(normalizePadelapiPoint('ad:40')).toEqual({ kind: 'advantage', side: 1 });
  });
  it('parses tiebreak numeric scores when insideTiebreak=true', () => {
    expect(normalizePadelapiPoint('7:5', { insideTiebreak: true })).toEqual({
      kind: 'tiebreak',
      team1: 7,
      team2: 5,
    });
  });
  it('throws on garbage input', () => {
    expect(() => normalizePadelapiPoint('banana')).toThrow();
  });
});

describe('normalizePadelgodPoint', () => {
  it('parses 15-0', () => {
    expect(normalizePadelgodPoint('15-0')).toEqual({ kind: 'regular', team1: 15, team2: 0 });
  });
  it('parses Deuce', () => {
    expect(normalizePadelgodPoint('Deuce')).toEqual({ kind: 'deuce' });
  });
  it('parses deuce (lowercase)', () => {
    expect(normalizePadelgodPoint('deuce')).toEqual({ kind: 'deuce' });
  });
  it('parses AD-40', () => {
    expect(normalizePadelgodPoint('AD-40')).toEqual({ kind: 'advantage', side: 1 });
  });
  it('parses 40-AD', () => {
    expect(normalizePadelgodPoint('40-AD')).toEqual({ kind: 'advantage', side: 2 });
  });
  it('parses GP → golden_point', () => {
    expect(normalizePadelgodPoint('GP')).toEqual({ kind: 'golden_point' });
  });
  it('parses tiebreak 5-3 when insideTiebreak=true', () => {
    expect(normalizePadelgodPoint('5-3', { insideTiebreak: true })).toEqual({
      kind: 'tiebreak',
      team1: 5,
      team2: 3,
    });
  });
  it('parses tiebreak by score-magnitude heuristic (any side > 40)', () => {
    // Real widget format for tiebreak: padelgod stores score_after like "7-5" and "5-3".
    // The heuristic: if either side exceeds 40, must be tiebreak. (Regular points are
    // always ≤40.) For low numbers like "5-3" the caller must pass insideTiebreak.
    expect(normalizePadelgodPoint('42-41')).toEqual({ kind: 'tiebreak', team1: 42, team2: 41 });
  });
  it('throws on garbage input', () => {
    expect(() => normalizePadelgodPoint('banana')).toThrow();
  });
});

describe('pointEq', () => {
  it('treats deuce and golden_point as equivalent', () => {
    expect(pointEq({ kind: 'deuce' }, { kind: 'golden_point' })).toBe(true);
    expect(pointEq({ kind: 'golden_point' }, { kind: 'deuce' })).toBe(true);
  });
  it('regular matches regular with same scores', () => {
    expect(
      pointEq({ kind: 'regular', team1: 15, team2: 30 }, { kind: 'regular', team1: 15, team2: 30 })
    ).toBe(true);
  });
  it('regular does NOT match with different scores', () => {
    expect(
      pointEq({ kind: 'regular', team1: 15, team2: 30 }, { kind: 'regular', team1: 30, team2: 15 })
    ).toBe(false);
  });
  it('advantage side must match', () => {
    expect(pointEq({ kind: 'advantage', side: 1 }, { kind: 'advantage', side: 2 })).toBe(false);
    expect(pointEq({ kind: 'advantage', side: 1 }, { kind: 'advantage', side: 1 })).toBe(true);
  });
  it('regular and deuce are not equal', () => {
    expect(
      pointEq({ kind: 'regular', team1: 40, team2: 40 }, { kind: 'deuce' })
    ).toBe(false);
  });
  it('tiebreak matches when both team scores equal', () => {
    expect(
      pointEq({ kind: 'tiebreak', team1: 5, team2: 3 }, { kind: 'tiebreak', team1: 5, team2: 3 })
    ).toBe(true);
    expect(
      pointEq({ kind: 'tiebreak', team1: 5, team2: 3 }, { kind: 'tiebreak', team1: 3, team2: 5 })
    ).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import {
  isInScopeTier,
  isMainDrawRound,
} from '../model-prediction-snapshot.js';

describe('isInScopeTier', () => {
  it('major / p1 / p2 → true', () => {
    expect(isInScopeTier('major')).toBe(true);
    expect(isInScopeTier('p1')).toBe(true);
    expect(isInScopeTier('p2')).toBe(true);
  });
  it('fip_platinum / fip_gold → true', () => {
    expect(isInScopeTier('fip_platinum')).toBe(true);
    expect(isInScopeTier('fip_gold')).toBe(true);
  });
  it('fip_silver / fip_bronze / fip_promises → false', () => {
    expect(isInScopeTier('fip_silver')).toBe(false);
    expect(isInScopeTier('fip_bronze')).toBe(false);
    expect(isInScopeTier('fip_promises')).toBe(false);
  });
  it('null / unknown → false', () => {
    expect(isInScopeTier(null)).toBe(false);
    expect(isInScopeTier('something_weird')).toBe(false);
  });
});

describe('isMainDrawRound', () => {
  it('R32 / R16 / QF / SF / F → true', () => {
    expect(isMainDrawRound('R32')).toBe(true);
    expect(isMainDrawRound('R16')).toBe(true);
    expect(isMainDrawRound('QF')).toBe(true);
    expect(isMainDrawRound('SF')).toBe(true);
    expect(isMainDrawRound('F')).toBe(true);
  });
  it('Q1 / Q2 / Q3 → false', () => {
    expect(isMainDrawRound('Q1')).toBe(false);
    expect(isMainDrawRound('Q2')).toBe(false);
    expect(isMainDrawRound('Q3')).toBe(false);
  });
  it('Round of 32 / Round of 16 (raw form) → true (case-insensitive)', () => {
    expect(isMainDrawRound('Round of 32')).toBe(true);
    expect(isMainDrawRound('Round of 16')).toBe(true);
  });
  it('null / empty / unknown → false', () => {
    expect(isMainDrawRound(null)).toBe(false);
    expect(isMainDrawRound('')).toBe(false);
    expect(isMainDrawRound('group_a')).toBe(false);
  });
});

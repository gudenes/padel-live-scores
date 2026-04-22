import { describe, it, expect } from 'vitest';
import {
  computeBackstampedStartedAt,
  computeFinishedAtFallback,
  formatDurationHHMM,
  parseDurationHHMM,
} from '../../lib/match-time-stamps.js';

describe('computeBackstampedStartedAt', () => {
  // 2026-04-22T05:46:20Z — an arbitrary fixed wall-clock we can reason about.
  const NOW_MS = Date.parse('2026-04-22T05:46:20Z');

  it('subtracts duration minutes from now to reconstruct the start time', () => {
    // A match that has been running for 80 minutes at NOW.
    expect(computeBackstampedStartedAt(80, NOW_MS)).toBe('2026-04-22T04:26:20.000Z');
  });

  it('returns now itself when duration is 0 (brand-new match)', () => {
    expect(computeBackstampedStartedAt(0, NOW_MS)).toBe('2026-04-22T05:46:20.000Z');
  });

  it('returns null when duration is null (widget did not emit an elapsed value)', () => {
    expect(computeBackstampedStartedAt(null, NOW_MS)).toBeNull();
  });

  it('clamps negative duration to 0 instead of computing a start after now', () => {
    // Defensive: a malformed widget payload should not produce a future start.
    expect(computeBackstampedStartedAt(-5, NOW_MS)).toBe('2026-04-22T05:46:20.000Z');
  });
});

describe('formatDurationHHMM', () => {
  it('pads hours and minutes to two digits', () => {
    expect(formatDurationHHMM(0)).toBe('00:00');
    expect(formatDurationHHMM(5)).toBe('00:05');
    expect(formatDurationHHMM(60)).toBe('01:00');
    expect(formatDurationHHMM(80)).toBe('01:20');
    expect(formatDurationHHMM(134)).toBe('02:14');
  });

  it('handles large durations (>24h gracefully — no wrap)', () => {
    // A 25h match shouldn't actually exist, but we don't want a silent wrap to 01:00.
    expect(formatDurationHHMM(25 * 60)).toBe('25:00');
  });

  it('clamps negatives to 00:00', () => {
    expect(formatDurationHHMM(-10)).toBe('00:00');
  });

  it('truncates fractional minutes (floor behaviour)', () => {
    expect(formatDurationHHMM(80.9)).toBe('01:20');
  });
});

describe('parseDurationHHMM', () => {
  it('parses HH:MM into total minutes', () => {
    expect(parseDurationHHMM('00:00')).toBe(0);
    expect(parseDurationHHMM('00:40')).toBe(40);
    expect(parseDurationHHMM('01:20')).toBe(80);
    expect(parseDurationHHMM('02:14')).toBe(134);
  });

  it('returns null for null or empty input', () => {
    expect(parseDurationHHMM(null)).toBeNull();
    expect(parseDurationHHMM('')).toBeNull();
  });

  it('returns null for malformed strings', () => {
    expect(parseDurationHHMM('01-20')).toBeNull();
    expect(parseDurationHHMM('abc')).toBeNull();
    expect(parseDurationHHMM('1:2:3')).toBeNull();
  });
});

describe('computeFinishedAtFallback', () => {
  it('prefers started_at + duration when both are valid', () => {
    const startedAt = '2026-04-21T15:36:53Z';
    const durationHHMM = '01:17'; // 77 min
    const capturedAt = '2026-04-21T20:00:00Z'; // much later, should be ignored
    // 15:36:53 + 77 min = 16:53:53
    expect(computeFinishedAtFallback(startedAt, durationHHMM, capturedAt)).toBe(
      '2026-04-21T16:53:53.000Z',
    );
  });

  it('falls back to captured_at when started_at is missing', () => {
    const capturedAt = '2026-04-21T20:00:00Z';
    expect(computeFinishedAtFallback(null, '01:17', capturedAt)).toBe(capturedAt);
  });

  it('falls back to captured_at when duration is missing', () => {
    const capturedAt = '2026-04-21T20:00:00Z';
    expect(computeFinishedAtFallback('2026-04-21T15:36:53Z', null, capturedAt)).toBe(
      capturedAt,
    );
  });

  it('falls back to captured_at when duration is malformed', () => {
    const capturedAt = '2026-04-21T20:00:00Z';
    expect(
      computeFinishedAtFallback('2026-04-21T15:36:53Z', 'garbage', capturedAt),
    ).toBe(capturedAt);
  });

  it('falls back to captured_at when started_at is not a parseable date', () => {
    const capturedAt = '2026-04-21T20:00:00Z';
    expect(computeFinishedAtFallback('not-a-date', '01:17', capturedAt)).toBe(
      capturedAt,
    );
  });
});

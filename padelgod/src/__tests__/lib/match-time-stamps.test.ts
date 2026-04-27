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

  describe('day-cursor tier (Tier 2)', () => {
    // Models the FIP Bronze Aquahobby Isla de la Palma 2026 case:
    // tournament starts 2026-04-23, R32 played Day 1 (Apr 23). Pre-fix the
    // cron's late captured_at (Apr 27) was being stamped as finished_at.
    const capturedAt = '2026-04-27T14:55:00Z'; // late cron observation
    const tournamentStartsAt = '2026-04-23T00:00:00Z';

    it('Day 1 → tournament start day at 12:00 UTC', () => {
      expect(
        computeFinishedAtFallback(null, null, capturedAt, {
          dayNumber: 1,
          tournamentStartsAtIso: tournamentStartsAt,
        }),
      ).toBe('2026-04-23T12:00:00.000Z');
    });

    it('Day 3 → tournament start + 2 days', () => {
      expect(
        computeFinishedAtFallback(null, null, capturedAt, {
          dayNumber: 3,
          tournamentStartsAtIso: tournamentStartsAt,
        }),
      ).toBe('2026-04-25T12:00:00.000Z');
    });

    it('handles tournament starts_at with non-midnight time (still uses 12:00 UTC of derived day)', () => {
      expect(
        computeFinishedAtFallback(null, null, capturedAt, {
          dayNumber: 2,
          tournamentStartsAtIso: '2026-04-23T18:30:00Z',
        }),
      ).toBe('2026-04-24T12:00:00.000Z');
    });

    it('truncates fractional dayNumber', () => {
      expect(
        computeFinishedAtFallback(null, null, capturedAt, {
          dayNumber: 2.7,
          tournamentStartsAtIso: tournamentStartsAt,
        }),
      ).toBe('2026-04-24T12:00:00.000Z');
    });

    it('Tier 1 still wins over Tier 2 when started_at + duration are present', () => {
      expect(
        computeFinishedAtFallback('2026-04-25T15:36:53Z', '01:17', capturedAt, {
          dayNumber: 1,
          tournamentStartsAtIso: tournamentStartsAt,
        }),
      ).toBe('2026-04-25T16:53:53.000Z');
    });

    it('falls through to captured_at when dayNumber is null', () => {
      expect(
        computeFinishedAtFallback(null, null, capturedAt, {
          dayNumber: null,
          tournamentStartsAtIso: tournamentStartsAt,
        }),
      ).toBe(capturedAt);
    });

    it('falls through to captured_at when tournamentStartsAtIso is null', () => {
      expect(
        computeFinishedAtFallback(null, null, capturedAt, {
          dayNumber: 1,
          tournamentStartsAtIso: null,
        }),
      ).toBe(capturedAt);
    });

    it('falls through to captured_at when dayNumber is 0 or negative', () => {
      expect(
        computeFinishedAtFallback(null, null, capturedAt, {
          dayNumber: 0,
          tournamentStartsAtIso: tournamentStartsAt,
        }),
      ).toBe(capturedAt);
    });

    it('falls through to captured_at when tournamentStartsAtIso is unparseable', () => {
      expect(
        computeFinishedAtFallback(null, null, capturedAt, {
          dayNumber: 1,
          tournamentStartsAtIso: 'not-a-date',
        }),
      ).toBe(capturedAt);
    });

    it('day-cursor crosses month boundary correctly', () => {
      expect(
        computeFinishedAtFallback(null, null, capturedAt, {
          dayNumber: 5,
          tournamentStartsAtIso: '2026-04-29T00:00:00Z',
        }),
      ).toBe('2026-05-03T12:00:00.000Z');
    });
  });
});

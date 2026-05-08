import { describe, it, expect } from 'vitest';
import { resolveDayOfWeek } from '../../parsers/fip-schedule-notes.js';

describe('resolveDayOfWeek', () => {
  it('returns the first ISO date in [startsAt, endsAt] matching the named weekday', () => {
    // 2026-05-03 is Sunday, 2026-05-10 is Sunday — Asuncion P2 range
    expect(resolveDayOfWeek('Sunday', '2026-05-03', '2026-05-10')).toBe('2026-05-03');
    expect(resolveDayOfWeek('Friday', '2026-05-03', '2026-05-10')).toBe('2026-05-08');
  });

  it('lowercases input and supports en/es/pt/it/fr day names', () => {
    expect(resolveDayOfWeek('SUNDAY', '2026-05-03', '2026-05-10')).toBe('2026-05-03');
    expect(resolveDayOfWeek('domingo', '2026-05-03', '2026-05-10')).toBe('2026-05-03');
    expect(resolveDayOfWeek('domenica', '2026-05-03', '2026-05-10')).toBe('2026-05-03');
    expect(resolveDayOfWeek('dimanche', '2026-05-03', '2026-05-10')).toBe('2026-05-03');
  });

  it('returns null when the named weekday is outside the range', () => {
    // 2026-05-04 (Mon) → 2026-05-06 (Wed): no Sunday
    expect(resolveDayOfWeek('Sunday', '2026-05-04', '2026-05-06')).toBeNull();
  });

  it('returns null for unrecognised day names', () => {
    expect(resolveDayOfWeek('Quintday', '2026-05-03', '2026-05-10')).toBeNull();
    expect(resolveDayOfWeek('', '2026-05-03', '2026-05-10')).toBeNull();
  });

  it('resolves Saturday in Italian and French (multilingual sanity)', () => {
    expect(resolveDayOfWeek('sabato', '2026-05-03', '2026-05-10')).toBe('2026-05-09');
    expect(resolveDayOfWeek('samedi', '2026-05-03', '2026-05-10')).toBe('2026-05-09');
  });
});

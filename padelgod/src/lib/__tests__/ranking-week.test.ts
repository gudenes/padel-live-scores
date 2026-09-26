import { describe, expect, it } from 'vitest';
import { shouldNotifyNewOfficialWeek } from '../ranking-week.js';

describe('shouldNotifyNewOfficialWeek', () => {
  it('fires when there was no previous official week', () => {
    expect(shouldNotifyNewOfficialWeek(null, { year: 2026, week: 34 })).toBe(true);
  });

  it('fires when the week number advances', () => {
    expect(
      shouldNotifyNewOfficialWeek({ year: 2026, week: 33 }, { year: 2026, week: 34 }),
    ).toBe(true);
  });

  it('fires across a year boundary', () => {
    expect(
      shouldNotifyNewOfficialWeek({ year: 2025, week: 52 }, { year: 2026, week: 1 }),
    ).toBe(true);
  });

  it('does not fire on a same-week re-upsert (deploy / daily tick)', () => {
    expect(
      shouldNotifyNewOfficialWeek({ year: 2026, week: 34 }, { year: 2026, week: 34 }),
    ).toBe(false);
  });

  it('does not fire when after is missing', () => {
    expect(shouldNotifyNewOfficialWeek({ year: 2026, week: 34 }, null)).toBe(false);
    expect(shouldNotifyNewOfficialWeek(null, null)).toBe(false);
  });
});

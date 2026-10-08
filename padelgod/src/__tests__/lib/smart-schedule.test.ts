import { describe, expect, it } from 'vitest';
import { computeSmartSchedule, remainingMinutes, historicalPace, localPlayDay, type ScheduleMatch } from '../../lib/smart-schedule.js';
const now = new Date('2026-10-08T10:00:00Z');
function row(id: string, order: number, overrides: Partial<ScheduleMatch> = {}): ScheduleMatch {
  return { id, tournament_id: 't', court: 'Central', court_order: order, status: 'scheduled', scheduled_at: '2026-10-08T10:00:00Z', started_at: null, finished_at: null, duration: null, schedule_label: 'Followed by', updated_at: now.toISOString(), sets: null, tournament: { timezone: 'Europe/Berlin' }, ...overrides };
}
function live(overrides: Partial<ScheduleMatch> = {}) {
  return row('live', 1, { status: 'live', started_at: '2026-10-08T09:00:00Z', duration: '01:00', sets: [
    { set_number: 1, pair1_games: 4, pair2_games: 6, is_current: false, updated_at: now.toISOString() },
    { set_number: 2, pair1_games: 2, pair2_games: 5, is_current: true, updated_at: now.toISOString() },
  ], ...overrides });
}
describe('court queue', () => {
  it('marks one next match per court across genders and unordered input', () => {
    const rows = [row('later', 3, { category: 'men' }), row('next', 2, { category: 'women' }), live(), row('other', 1, { court: '2' })];
    const result = computeSmartSchedule(rows, [], now);
    expect(result.get('next')?.next_to_play).toBe(true);
    expect(result.get('other')?.next_to_play).toBe(true);
    expect(result.get('later')?.next_to_play).toBe(false);
    expect(result.get('live')).toBeNull();
    expect(result.get('next')?.earliest_at).not.toBeNull();
  });
  it('advances the badge after warmup, without predicting warmup duration', () => {
    const result = computeSmartSchedule([live({ status: 'on_court' }), row('next', 2)], [], now);
    expect(result.get('next')?.next_to_play).toBe(true);
    expect(result.get('next')?.earliest_at).toBeNull();
  });
  it.each(['suspended', 'unknown'])('withholds ambiguous queue for %s', (status) => {
    expect(computeSmartSchedule([row('first', 1, { status }), row('next', 2)], [], now).get('next')).toBeNull();
  });
  it.each([
    [row('a', 1), row('b', 1)],
    [row('a', 1, { court_order: null }), row('b', 2)],
    [live(), live({ id: 'second-live', court_order: 2 }), row('b', 3)],
    [row('a', 1, { scheduled_at: null }), row('b', 2)],
  ])('withholds conflicting/incomplete court order', (...rows) => {
    expect([...computeSmartSchedule(rows, [], now).values()].every((v) => v === null)).toBe(true);
  });
  it('does not label tomorrow or invent a timezone', () => {
    const result = computeSmartSchedule([row('tomorrow', 1, { scheduled_at: '2026-10-09T10:00Z' }), row('unknown', 1, { tournament: null })], [], now);
    expect([...result.values()]).toEqual([null, null]);
  });
  it('does not ignore an overnight active predecessor', () => {
    expect(computeSmartSchedule([live({ scheduled_at: '2026-10-07T20:00Z' }), row('next', 2)], [], now).get('next')).toBeNull();
  });
  it('honours not-before session floors', () => {
    const result = computeSmartSchedule([live(), row('next', 2, { scheduled_at: '2026-10-08T16:00Z', schedule_label: 'Not before 6:00 PM' })], [], now).get('next')!;
    expect(Date.parse(result.earliest_at!)).toBeGreaterThanOrEqual(Date.parse('2026-10-08T16:00Z'));
    expect(Date.parse(result.latest_at!)).toBeGreaterThanOrEqual(Date.parse(result.earliest_at!));
  });
  it('does not use a placeholder finish timestamp', () => {
    const result = computeSmartSchedule([row('done', 1, { status: 'finished', finished_at: now.toISOString() }), row('next', 2)], [], now).get('next');
    expect(result?.next_to_play).toBe(true);
    expect(result?.earliest_at).toBeNull();
  });
  it('skips walkovers without consuming another playing slot', () => {
    const result = computeSmartSchedule([live(), row('skip', 2, { status: 'walkover' }), row('next', 3)], [], now).get('next');
    expect(result?.next_to_play).toBe(true);
    expect(result?.predecessor_id).toBe('live');
    expect(result?.earliest_at).not.toBeNull();
  });
  it('propagates progressively later windows for the unlikely-before label', () => {
    const result = computeSmartSchedule([live(), row('next', 2), row('later', 3), row('far', 4)], [], now);
    expect(result.get('later')?.earliest_at).not.toBeNull();
    expect(Date.parse(result.get('far')!.earliest_at!)).toBeGreaterThan(Date.parse(result.get('later')!.earliest_at!));
    expect(result.get('far')?.next_to_play).toBe(false);
  });
  it('uses observed elapsed duration after a finish or retirement', () => {
    for (const status of ['finished', 'retired']) {
      const result = computeSmartSchedule([live({ status, duration: '01:00' }), row('next', 2)], [], now).get('next');
      expect(result?.basis).toBe('observed_finish');
      expect(result?.earliest_at).toBe('2026-10-08T10:10:00.000Z');
    }
  });
  it('stale scores remain stale even if a forecast updates the match timestamp', () => {
    const stale = live(); stale.sets = stale.sets!.map((s) => ({ ...s, updated_at: '2026-10-08T09:50:00Z' }));
    expect(computeSmartSchedule([stale, row('next', 2)], [], now).get('next')?.earliest_at).toBeNull();
  });
  it('uses game timestamps for freshness too', () => {
    const m = live(); m.sets = m.sets!.map((s) => ({ ...s, updated_at: '2026-10-08T09:50Z', games: [{ updated_at: now.toISOString() }] }));
    expect(computeSmartSchedule([m, row('next', 2)], [], now).get('next')?.basis).toBe('live_progress');
  });
  it('uses tournament-local dates rather than UTC dates', () => {
    expect(localPlayDay('2026-10-08T23:30Z', 'Europe/Berlin')).toBe('2026-10-09');
  });
});
describe('remaining play time', () => {
  it('adjusts to progress and a third set, deterministically', () => {
    const near = remainingMinutes(live(), [])!;
    const early = remainingMinutes(live({ duration: '00:20', sets: [{ set_number: 1, pair1_games: 2, pair2_games: 2, is_current: true }] }), [])!;
    expect(early[0]).toBeGreaterThan(near[0]);
    expect(remainingMinutes(live(), [])).toEqual(near);
    const third = remainingMinutes(live({ sets: [
      { set_number: 1, pair1_games: 6, pair2_games: 4, is_current: false },
      { set_number: 2, pair1_games: 4, pair2_games: 6, is_current: false },
      { set_number: 3, pair1_games: 6, pair2_games: 6, is_current: true },
    ] }), []);
    expect(third?.[1]).toBeLessThan(near[1]);
  });
  it('rejects corrupt durations, missing scores, and super-tiebreak formats', () => {
    expect(remainingMinutes(live({ duration: '22:09' }), [])).toBeNull();
    expect(remainingMinutes(live({ sets: null }), [])).toBeNull();
    expect(remainingMinutes(live({ sets: [{ set_number: 1, pair1_games: 10, pair2_games: 8, is_current: true }] }), [])).toBeNull();
  });
  it('does not train on placeholder-only finished matches', () => {
    expect(historicalPace([live({ status: 'finished', started_at: null })])).toEqual([]);
  });
});

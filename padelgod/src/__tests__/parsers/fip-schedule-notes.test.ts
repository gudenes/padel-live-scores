import { describe, it, expect } from 'vitest';
import { resolveDayOfWeek, parseScheduleNotes } from '../../parsers/fip-schedule-notes.js';

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

describe('parseScheduleNotes — Premier structured format', () => {
  it('parses Asuncion P2 main-draw blocks', () => {
    const notes = `QUALIFYING
Men 3-5 May
Q1 Sun 3 Start time : 10.00 am
Q2 Mon 4 Start time : 10.00 am
Q3 Tue 5 Start time : 10.00 am
Women 4-5 May
Q1 Mon 4 Start time : 10.00 am
Q2 Tue 5 Start time : 10.00 am
MAIN DRAW : 1st ROUND
Men 5 – 6 May
Tue 5 Start time : 4.00 pm
Wed 6 Start time : 10.00 am
Women Wed 6 May
Start time : 10.00 am
MAIN DRAW: ROUND OF 16
7 May
Start time : 10.00 am
MAIN DRAW: QUARTER-FINALS
8 May
Start time : 10.00 am
MAIN DRAW: SEMI-FINALS
9 May
Start time : 2.00 pm
MAIN DRAW : FINAL
10 May
Start time : 4.00 pm`;
    const result = parseScheduleNotes(notes, '2026-05-03', '2026-05-10');
    expect(result).toEqual({
      q1: '2026-05-03', // earliest of men=Sun3, women=Mon4
      q2: '2026-05-04',
      q3: '2026-05-05',
      r16: '2026-05-07',
      qf: '2026-05-08',
      sf: '2026-05-09',
      f: '2026-05-10',
    });
  });

  it('handles "FINALS" with trailing S', () => {
    const notes = `MAIN DRAW : FINALS
17 May
Start time : 2.00 pm`;
    const result = parseScheduleNotes(notes, '2026-05-11', '2026-05-17');
    expect(result.f).toBe('2026-05-17');
  });

  it('handles "ROUND OF 32" / "ROUND OF 16" full names', () => {
    const notes = `MAIN DRAW: ROUND OF 32
12 May
MAIN DRAW: ROUND OF 16
14 May`;
    const result = parseScheduleNotes(notes, '2026-05-11', '2026-05-17');
    expect(result.r32).toBe('2026-05-12');
    expect(result.r16).toBe('2026-05-14');
  });

  it('drops entries when the parsed date falls outside the tournament range', () => {
    // FIP schedule_notes can contain typos / stale copy-paste from prior years.
    // Better to drop the entry than emit a December final on a May tournament.
    const notes = `MAIN DRAW : FINAL
15 December
Start time : 4.00 pm`;
    const result = parseScheduleNotes(notes, '2026-05-03', '2026-05-10');
    expect(result.f).toBeUndefined();
  });

  it('handles December-startsAt rollover for qualifying days', () => {
    // Tournament spans Dec 28 → Jan 4. Q1 on Sun = Dec 28; Q2 on Mon = Dec 29.
    // Pre-fix bug: month+1 produced "YYYY-13-DD" strings that slipped past
    // the range gate. Post-fix: month+1 must roll over to next year.
    const notes = `Q1 Sun 28 Start time : 10.00 am
Q2 Mon 29 Start time : 10.00 am`;
    const result = parseScheduleNotes(notes, '2025-12-28', '2026-01-04');
    expect(result.q1).toBe('2025-12-28');
    expect(result.q2).toBe('2025-12-29');
  });

  it('inclusive boundaries: dates exactly at startsAt / endsAt are accepted', () => {
    const notes = `MAIN DRAW : 1st ROUND
3 May
MAIN DRAW : FINAL
10 May`;
    const result = parseScheduleNotes(notes, '2026-05-03', '2026-05-10');
    expect(result.f).toBe('2026-05-10');
  });
});

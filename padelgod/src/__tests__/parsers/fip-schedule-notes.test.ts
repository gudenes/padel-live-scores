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

  it('Portuguese hyphenated day forms ("quinta-feira") match via the short prefix', () => {
    // The line regex in parseDayOfWeekLines stops at the hyphen, so the
    // captured day name is "quinta" — the short form must be in DAY_NAMES.
    expect(resolveDayOfWeek('quinta', '2026-05-04', '2026-05-10')).toBe('2026-05-07');
    expect(resolveDayOfWeek('segunda', '2026-05-04', '2026-05-10')).toBe('2026-05-04');
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

  it('accepts full ISO timestamps as startsAt/endsAt (callers may pass DB timestamps)', () => {
    // Reproducer for the Asuncion P2 production bug — startsAt='2026-05-03T00:00:00+00:00'
    // (full timestamp from DB) instead of '2026-05-03' (date-only) caused
    // string-comparison failures, dropping the tournament-first-day Q1
    // entry. Defensive slice in parseScheduleNotes normalizes both forms.
    const notes = `Q1 Sun 3 Start time : 10.00 am
Q1 Mon 4 Start time : 10.00 am`;
    const result = parseScheduleNotes(
      notes,
      '2026-05-03T00:00:00+00:00',  // full timestamp, not date-only
      '2026-05-10T00:00:00+00:00',
    );
    expect(result.q1).toBe('2026-05-03'); // earliest-wins picks Sunday
  });
});

describe('parseScheduleNotes — day-of-week format', () => {
  it('resolves combined "SF and Finals MD" to a single Sunday date', () => {
    const notes = `* Wednesday – 1st round qualification.
* Thursday – 2nd and 3rd round qualification.
* Friday – 1st round MD.
* Saturday – 2nd round and QF MD.
* Sunday – SF and Finals MD.
Date Finals: 07/06/2026`;
    // FIP Bronze Oporto: Wed 3 → Sun 7 June 2026
    const result = parseScheduleNotes(notes, '2026-06-01', '2026-06-07');
    // Strategy 2 emits qf for Saturday (Jun 6) and sf+f for Sunday (Jun 7).
    // Strategy 3's "Date Finals" override (Task 5) keeps f at Jun 7 too.
    expect(result.qf).toBe('2026-06-06');
    expect(result.sf).toBe('2026-06-07');
    expect(result.q1).toBe('2026-06-03'); // Wed
    expect(result.q2).toBe('2026-06-04'); // Thu
    expect(result.q3).toBe('2026-06-04'); // Thu (combined "2nd and 3rd")
  });

  it('handles colon-separated day-of-week format (Italian-style)', () => {
    const notes = `Tuesday: 1st Qualy
Wednesday: 2nd and 3rd Qualy
Thursday: 1st Round Main Draw
Friday: 2nd Round Main Draw
Saturday: Quarterfinals
Sunday: Semifinals and Finals`;
    // FIP Silver Mediolanum 2026-03-17 → 2026-03-22 (Tue → Sun)
    const result = parseScheduleNotes(notes, '2026-03-17', '2026-03-22');
    expect(result.q1).toBe('2026-03-17');
    expect(result.q2).toBe('2026-03-18');
    expect(result.q3).toBe('2026-03-18');
    expect(result.qf).toBe('2026-03-21');
    expect(result.sf).toBe('2026-03-22');
  });

  it('handles separate "Quarter Finals" / "Semi Finals" / "Finals" days (FIP Beyond)', () => {
    const notes = `Beyond 18-39
– Quarter Finals – 7th, April
– Semi Finals & Finals – 8th, April`;
    // Strategy 1 catches "QUARTER FINAL" / "SEMI FINAL" via labelToKey
    // when followed by a full-month date — this format uses ordinals
    // ("7th") that the strict regex doesn't match. Day-of-week strategy
    // doesn't apply (no day name). Should fall through gracefully.
    // For V1 we accept this is unparsed.
    const result = parseScheduleNotes(notes, '2026-04-06', '2026-04-08');
    // Best-effort: nothing here is required to match. No crash, no entries.
    expect(result.qf ?? null).toBeNull();
  });

  it('emits nothing when no day matches the tournament range', () => {
    // Tournament range Wed-Fri but schedule mentions Sunday
    const notes = '* Sunday – SF and Finals MD.';
    const result = parseScheduleNotes(notes, '2026-05-04', '2026-05-06');
    expect(result.sf ?? null).toBeNull();
    expect(result.f ?? null).toBeNull();
  });
});

describe('parseScheduleNotes — Date Finals override', () => {
  it('overrides any prior `f` entry with explicit Date Finals', () => {
    // Day-of-week strategy would set sf+f to the same Sunday; Date Finals
    // should override f if it points to a different day.
    const notes = `* Saturday – SF MD.
* Sunday – Finals MD.
Date Finals: 06/06/2026`;
    const result = parseScheduleNotes(notes, '2026-06-01', '2026-06-07');
    expect(result.f).toBe('2026-06-06'); // override
    expect(result.sf).toBe('2026-06-06'); // Saturday → Jun 6
  });

  it('sets f when no other strategy did (FIP Bronze Singapore-style)', () => {
    const notes = `Date Finals: 08/03/2026
Time Schedule SF and Finals: 10:00h (local time) and 16:00h (local time)`;
    const result = parseScheduleNotes(notes, '2026-03-04', '2026-03-08');
    expect(result.f).toBe('2026-03-08');
  });

  it('handles single-digit day/month', () => {
    const notes = 'Date Finals: 7/6/2026';
    const result = parseScheduleNotes(notes, '2026-06-01', '2026-06-07');
    expect(result.f).toBe('2026-06-07');
  });

  it('returns {} when notes is empty/null', () => {
    expect(parseScheduleNotes(null, '2026-06-01', '2026-06-07')).toEqual({});
    expect(parseScheduleNotes('', '2026-06-01', '2026-06-07')).toEqual({});
  });
});

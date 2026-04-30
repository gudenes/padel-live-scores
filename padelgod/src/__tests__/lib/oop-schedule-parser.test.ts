import { describe, it, expect } from 'vitest';
import {
  parseOopScheduledAtBatch,
  type OopScheduleRow,
} from '../../lib/oop-schedule-parser.js';

describe('parseOopScheduledAtBatch', () => {
  it('parses "Starting at H:MM PM" to UTC using the tournament timezone', () => {
    // Singapore (UTC+8): 5:00 PM local = 09:00 UTC
    const rows: OopScheduleRow[] = [
      {
        matchWidgetId: 'M8001',
        court: 'Court 1',
        courtPosition: 0,
        scheduledLabel: 'Starting at 5:00 PM',
        dayDate: '2026-04-30',
      },
    ];
    const out = parseOopScheduledAtBatch(rows, 'Asia/Singapore');
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      matchWidgetId: 'M8001',
      scheduledAt: '2026-04-30T09:00:00.000Z',
      scheduleLabel: 'Starting at 5:00 PM',
      approximate: false,
    });
  });

  it('parses "Not before H:MM PM" with approximate=true', () => {
    // Same Singapore tournament: 7:00 PM local = 11:00 UTC
    const rows: OopScheduleRow[] = [
      {
        matchWidgetId: 'M5001',
        court: 'Court 1',
        courtPosition: 2,
        scheduledLabel: 'Not before 7:00 PM',
        dayDate: '2026-04-30',
      },
    ];
    const out = parseOopScheduledAtBatch(rows, 'Asia/Singapore');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      matchWidgetId: 'M5001',
      scheduledAt: '2026-04-30T11:00:00.000Z',
      approximate: true,
    });
  });

  it('chains "Followed by" off the previous match on the same court (+90 min)', () => {
    // Court 1: 5:00 PM → 6:30 PM (Followed by) → 8:00 PM (Followed by)
    // Singapore: those are 09:00, 10:30, 12:00 UTC.
    const rows: OopScheduleRow[] = [
      {
        matchWidgetId: 'M8001',
        court: 'Court 1',
        courtPosition: 0,
        scheduledLabel: 'Starting at 5:00 PM',
        dayDate: '2026-04-30',
      },
      {
        matchWidgetId: 'F1', // women's final after men's final
        court: 'Court 1',
        courtPosition: 1,
        scheduledLabel: 'Followed by',
        dayDate: '2026-04-30',
      },
      {
        matchWidgetId: 'F2',
        court: 'Court 1',
        courtPosition: 2,
        scheduledLabel: 'Followed by',
        dayDate: '2026-04-30',
      },
    ];
    const out = parseOopScheduledAtBatch(rows, 'Asia/Singapore');
    const byId = Object.fromEntries(out.map((r) => [r.matchWidgetId, r]));
    expect(byId.M8001!.scheduledAt).toBe('2026-04-30T09:00:00.000Z');
    expect(byId.F1!.scheduledAt).toBe('2026-04-30T10:30:00.000Z');
    expect(byId.F1!.approximate).toBe(true);
    expect(byId.F2!.scheduledAt).toBe('2026-04-30T12:00:00.000Z');
    expect(byId.F2!.approximate).toBe(true);
  });

  it('chains independently per court', () => {
    // Court 1 chain doesn't poison Court 2's chain.
    const rows: OopScheduleRow[] = [
      {
        matchWidgetId: 'C1A',
        court: 'Court 1',
        courtPosition: 0,
        scheduledLabel: 'Starting at 5:00 PM',
        dayDate: '2026-04-30',
      },
      {
        matchWidgetId: 'C2A',
        court: 'Court 2',
        courtPosition: 0,
        scheduledLabel: 'Starting at 3:00 PM',
        dayDate: '2026-04-30',
      },
      {
        matchWidgetId: 'C2B',
        court: 'Court 2',
        courtPosition: 1,
        scheduledLabel: 'Followed by',
        dayDate: '2026-04-30',
      },
    ];
    const out = parseOopScheduledAtBatch(rows, 'Asia/Singapore');
    const byId = Object.fromEntries(out.map((r) => [r.matchWidgetId, r]));
    expect(byId.C1A!.scheduledAt).toBe('2026-04-30T09:00:00.000Z');
    expect(byId.C2A!.scheduledAt).toBe('2026-04-30T07:00:00.000Z');
    // Court 2 "Followed by" anchors off Court 2's 3:00 PM, not Court 1's 5:00 PM.
    expect(byId.C2B!.scheduledAt).toBe('2026-04-30T08:30:00.000Z');
  });

  it('chains independently per (court, dayDate) — never bleeds across days', () => {
    // Regression for the Mendoza Q2 MQ008 bug: when one court has rows
    // from two different day_dates, the parser used to chain Apr 30's
    // "Followed by" off Apr 29's last absolute time. Now each (court,
    // dayDate) pair has its own chain.
    //
    // Apr 29 chain on Pista Central:
    //   pos 0: "Starting at 5:30 PM" → 17:30 ARG
    //   pos 1: "Not before 7:00 PM"  → 19:00 ARG
    //   pos 2: "Not before 8:45 PM"  → 20:45 ARG  (chain end for Apr 29)
    //
    // Apr 30 chain on Pista Central:
    //   pos 0: "Starting at 12:00 PM"  → 12:00 ARG
    //   pos 1: "Followed by"            → 13:30 ARG
    //   pos 2: "Not before 3:00 PM"     → 15:00 ARG
    //   pos 3: "Followed by"            → 16:30 ARG  (this is MQ008)
    //
    // The bug stored MQ008 at 22:15 ARG (= 20:45 + 90), inheriting the
    // Apr 29 chain. With the fix MQ008 lands at 16:30 ARG.
    const rows: OopScheduleRow[] = [
      // Apr 29 rows
      { matchWidgetId: 'D29-0', court: 'Pista Central', courtPosition: 0, scheduledLabel: 'Starting at 5:30 PM', dayDate: '2026-04-29' },
      { matchWidgetId: 'D29-1', court: 'Pista Central', courtPosition: 1, scheduledLabel: 'Not before 7:00 PM',  dayDate: '2026-04-29' },
      { matchWidgetId: 'D29-2', court: 'Pista Central', courtPosition: 2, scheduledLabel: 'Not before 8:45 PM',  dayDate: '2026-04-29' },
      // Apr 30 rows — same court, positions reset to 0..3
      { matchWidgetId: 'D30-0', court: 'Pista Central', courtPosition: 0, scheduledLabel: 'Starting at 12:00 PM', dayDate: '2026-04-30' },
      { matchWidgetId: 'D30-1', court: 'Pista Central', courtPosition: 1, scheduledLabel: 'Followed by',          dayDate: '2026-04-30' },
      { matchWidgetId: 'D30-2', court: 'Pista Central', courtPosition: 2, scheduledLabel: 'Not before 3:00 PM',   dayDate: '2026-04-30' },
      { matchWidgetId: 'MQ008', court: 'Pista Central', courtPosition: 3, scheduledLabel: 'Followed by',          dayDate: '2026-04-30' },
    ];
    const out = parseOopScheduledAtBatch(rows, 'America/Argentina/Buenos_Aires');
    const byId = Object.fromEntries(out.map((r) => [r.matchWidgetId, r]));
    // ARG = UTC-3, no DST.
    expect(byId['D29-0']!.scheduledAt).toBe('2026-04-29T20:30:00.000Z'); // 17:30 ARG
    expect(byId['D29-2']!.scheduledAt).toBe('2026-04-29T23:45:00.000Z'); // 20:45 ARG
    expect(byId['D30-0']!.scheduledAt).toBe('2026-04-30T15:00:00.000Z'); // 12:00 ARG (resets chain — does NOT chain off Apr 29 20:45)
    expect(byId['D30-1']!.scheduledAt).toBe('2026-04-30T16:30:00.000Z'); // 13:30 ARG = 12:00 + 90
    expect(byId['D30-2']!.scheduledAt).toBe('2026-04-30T18:00:00.000Z'); // 15:00 ARG (absolute, not 13:30 + 90)
    // The critical regression assertion — MQ008 lands at 16:30 ARG, not 22:15.
    expect(byId.MQ008!.scheduledAt).toBe('2026-04-30T19:30:00.000Z'); // 16:30 ARG = 21:30 Madrid CEST
  });

  it('skips rows without a match widget id (cannot link to public.matches)', () => {
    const rows: OopScheduleRow[] = [
      {
        matchWidgetId: null,
        court: 'Court 1',
        courtPosition: 0,
        scheduledLabel: 'Starting at 5:00 PM',
        dayDate: '2026-04-30',
      },
    ];
    expect(parseOopScheduledAtBatch(rows, 'Asia/Singapore')).toHaveLength(0);
  });

  it('skips rows without day_date (no calendar anchor)', () => {
    const rows: OopScheduleRow[] = [
      {
        matchWidgetId: 'M1',
        court: 'Court 1',
        courtPosition: 0,
        scheduledLabel: 'Starting at 5:00 PM',
        dayDate: null,
      },
    ];
    expect(parseOopScheduledAtBatch(rows, 'Asia/Singapore')).toHaveLength(0);
  });

  it('skips "Followed by" rows when no previous match anchors the chain', () => {
    // Defensive: malformed widget output where the very first row of a court
    // is "Followed by". We can't infer a time, so we drop it rather than
    // guess. UI continues to show NULL until the next OOP refresh fixes it.
    const rows: OopScheduleRow[] = [
      {
        matchWidgetId: 'M1',
        court: 'Court 1',
        courtPosition: 0,
        scheduledLabel: 'Followed by',
        dayDate: '2026-04-30',
      },
    ];
    expect(parseOopScheduledAtBatch(rows, 'Asia/Singapore')).toHaveLength(0);
  });

  it('handles AM correctly (midnight + 12-hour conversion)', () => {
    // Singapore: 11:30 AM local = 03:30 UTC.
    const rows: OopScheduleRow[] = [
      {
        matchWidgetId: 'M1',
        court: 'Court 1',
        courtPosition: 0,
        scheduledLabel: 'Starting at 11:30 AM',
        dayDate: '2026-04-30',
      },
    ];
    const out = parseOopScheduledAtBatch(rows, 'Asia/Singapore');
    expect(out[0]!.scheduledAt).toBe('2026-04-30T03:30:00.000Z');
  });

  it('handles 12:00 PM (noon) and 12:00 AM (midnight) correctly', () => {
    // 12:00 PM = 12:00 (no +12). 12:00 AM = 00:00.
    // Asia/Singapore: 12:00 PM = 04:00 UTC, 12:00 AM = 16:00 UTC (prior day).
    const rows: OopScheduleRow[] = [
      {
        matchWidgetId: 'noon',
        court: 'A',
        courtPosition: 0,
        scheduledLabel: 'Starting at 12:00 PM',
        dayDate: '2026-04-30',
      },
      {
        matchWidgetId: 'midnight',
        court: 'B',
        courtPosition: 0,
        scheduledLabel: 'Starting at 12:00 AM',
        dayDate: '2026-04-30',
      },
    ];
    const out = parseOopScheduledAtBatch(rows, 'Asia/Singapore');
    const byId = Object.fromEntries(out.map((r) => [r.matchWidgetId, r]));
    expect(byId.noon!.scheduledAt).toBe('2026-04-30T04:00:00.000Z');
    expect(byId.midnight!.scheduledAt).toBe('2026-04-29T16:00:00.000Z');
  });

  it('respects different timezones (Argentina vs Singapore)', () => {
    // Same local time, different tz → different UTC.
    // Buenos Aires UTC-3: 5:00 PM local = 20:00 UTC
    const rows: OopScheduleRow[] = [
      {
        matchWidgetId: 'M1',
        court: 'X',
        courtPosition: 0,
        scheduledLabel: 'Starting at 5:00 PM',
        dayDate: '2026-04-30',
      },
    ];
    const ar = parseOopScheduledAtBatch(
      rows,
      'America/Argentina/Buenos_Aires',
    );
    expect(ar[0]!.scheduledAt).toBe('2026-04-30T20:00:00.000Z');
  });
});

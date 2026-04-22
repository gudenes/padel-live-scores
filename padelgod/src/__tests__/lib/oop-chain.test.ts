import { describe, it, expect } from 'vitest';
import {
  computeOopChain,
  parseScheduleLabelTime,
  type OopChainEntry,
} from '../../lib/oop-chain.js';

// Fixed tournament-local 11:00 anchor for a single day. Using UTC throughout
// keeps the tests timezone-independent — real callers resolve labels in the
// tournament timezone before passing them in.
const ANCHOR_ISO = '2026-04-22T11:00:00Z';

function entry(
  id: string,
  opts: Partial<OopChainEntry> = {},
): OopChainEntry {
  return {
    matchWidgetId: id,
    status: opts.status ?? 'finished',
    durationMinutes: opts.durationMinutes ?? null,
    notBeforeIso: opts.notBeforeIso ?? null,
  };
}

describe('computeOopChain', () => {
  it('chains three finished matches on one court using duration + default 15-min gap', () => {
    // 11:00 anchor → M1 finishes 12:20 → +15min gap → M2 starts 12:35
    // M2 finishes 13:55 → +15 → M3 starts 14:10
    const out = computeOopChain([
      entry('M1', { notBeforeIso: ANCHOR_ISO, durationMinutes: 80 }),
      entry('M2', { durationMinutes: 80 }),
      entry('M3', { durationMinutes: 60 }),
    ]);

    expect(out).toEqual([
      { matchWidgetId: 'M1', startedAtIso: '2026-04-22T11:00:00.000Z' },
      { matchWidgetId: 'M2', startedAtIso: '2026-04-22T12:35:00.000Z' },
      { matchWidgetId: 'M3', startedAtIso: '2026-04-22T14:10:00.000Z' },
    ]);
  });

  it('respects a "Not before" floor on a later match (chain_end < floor → use floor)', () => {
    // First two matches finish by 13:55, but a 17:00 floor on M3 pushes its
    // start to 17:00 regardless of the chain.
    const out = computeOopChain([
      entry('M1', { notBeforeIso: ANCHOR_ISO, durationMinutes: 80 }),
      entry('M2', { durationMinutes: 80 }),
      entry('M3', {
        durationMinutes: 60,
        notBeforeIso: '2026-04-22T17:00:00Z',
      }),
    ]);

    expect(out[2]!.startedAtIso).toBe('2026-04-22T17:00:00.000Z');
  });

  it('chain_end wins when chain_end > floor (floor already passed)', () => {
    // If matches run long and pass the "Not before" time, we should use the
    // later chain time, not regress to the floor.
    const out = computeOopChain([
      entry('M1', { notBeforeIso: ANCHOR_ISO, durationMinutes: 180 }),
      entry('M2', {
        durationMinutes: 60,
        notBeforeIso: '2026-04-22T13:00:00Z', // 13:00, but chain already at 14:15
      }),
    ]);

    // M1: 11:00 → 14:00 end, +15 gap → M2 starts 14:15 (> 13:00 floor)
    expect(out[1]!.startedAtIso).toBe('2026-04-22T14:15:00.000Z');
  });

  it('breaks the chain at the first match with unknown duration (still emits its own start)', () => {
    // M2's duration is unknown (scheduled match in the middle). We can still
    // emit its start (chain tip from M1) but M3 can't be inferred.
    const out = computeOopChain([
      entry('M1', { notBeforeIso: ANCHOR_ISO, durationMinutes: 80 }),
      entry('M2', { status: 'scheduled', durationMinutes: null }),
      entry('M3', { durationMinutes: 60 }),
    ]);

    expect(out[0]!.startedAtIso).toBe('2026-04-22T11:00:00.000Z');
    expect(out[1]!.startedAtIso).toBe('2026-04-22T12:35:00.000Z');
    expect(out[2]!.startedAtIso).toBeNull();
  });

  it('a "Not before" on a post-break match re-anchors the chain for later matches', () => {
    // M2 is unknown-duration (breaks chain). M3 has a "Not before" floor →
    // picks up there. M4 chains off M3.
    const out = computeOopChain([
      entry('M1', { notBeforeIso: ANCHOR_ISO, durationMinutes: 80 }),
      entry('M2', { status: 'scheduled', durationMinutes: null }),
      entry('M3', {
        durationMinutes: 60,
        notBeforeIso: '2026-04-22T18:00:00Z',
      }),
      entry('M4', { durationMinutes: 45 }),
    ]);

    expect(out[1]!.startedAtIso).toBe('2026-04-22T12:35:00.000Z');
    expect(out[2]!.startedAtIso).toBe('2026-04-22T18:00:00.000Z');
    // M3 ends 19:00, +15 gap → M4 starts 19:15
    expect(out[3]!.startedAtIso).toBe('2026-04-22T19:15:00.000Z');
  });

  it('honors a custom gapMinutes', () => {
    // 5-min gap instead of 15. M1 ends 12:20 → M2 starts 12:25.
    const out = computeOopChain(
      [
        entry('M1', { notBeforeIso: ANCHOR_ISO, durationMinutes: 80 }),
        entry('M2', { durationMinutes: 60 }),
      ],
      { gapMinutes: 5 },
    );

    expect(out[1]!.startedAtIso).toBe('2026-04-22T12:25:00.000Z');
  });

  it('walkover adds gap but no duration (so the next match starts one gap later)', () => {
    const out = computeOopChain([
      entry('M1', { notBeforeIso: ANCHOR_ISO, durationMinutes: 80 }),
      entry('M2', { status: 'walkover', durationMinutes: null }),
      entry('M3', { durationMinutes: 60 }),
    ]);

    // M1 ends 12:20, +15 gap → M2 at 12:35, walkover → +15 → M3 at 12:50.
    expect(out[1]!.startedAtIso).toBe('2026-04-22T12:35:00.000Z');
    expect(out[2]!.startedAtIso).toBe('2026-04-22T12:50:00.000Z');
  });

  it('retired match chains like finished (partial duration is valid)', () => {
    const out = computeOopChain([
      entry('M1', { notBeforeIso: ANCHOR_ISO, durationMinutes: 80 }),
      entry('M2', { status: 'retired', durationMinutes: 20 }), // retired after 20 min
      entry('M3', { durationMinutes: 60 }),
    ]);

    // M1 ends 12:20 → M2 starts 12:35, retired after 20min = 12:55, +15 → M3 at 13:10
    expect(out[1]!.startedAtIso).toBe('2026-04-22T12:35:00.000Z');
    expect(out[2]!.startedAtIso).toBe('2026-04-22T13:10:00.000Z');
  });

  it('returns null when the court has no anchor (neither chain nor floor)', () => {
    // No notBeforeIso on the first entry → nothing to anchor the day with.
    const out = computeOopChain([
      entry('M1', { durationMinutes: 80 }),
      entry('M2', { durationMinutes: 60 }),
    ]);
    expect(out).toEqual([
      { matchWidgetId: 'M1', startedAtIso: null },
      { matchWidgetId: 'M2', startedAtIso: null },
    ]);
  });

  it('empty input → empty output', () => {
    expect(computeOopChain([])).toEqual([]);
  });
});

describe('parseScheduleLabelTime', () => {
  it('parses "Starting at 11:00 AM" to 11:00 in 24h', () => {
    expect(parseScheduleLabelTime('Starting at 11:00 AM')).toEqual({
      hours: 11,
      minutes: 0,
    });
  });

  it('parses "Not before 4:00 PM" to 16:00', () => {
    expect(parseScheduleLabelTime('Not before 4:00 PM')).toEqual({
      hours: 16,
      minutes: 0,
    });
  });

  it('handles 12:00 PM as noon (12) and 12:00 AM as midnight (0)', () => {
    expect(parseScheduleLabelTime('Starting at 12:00 PM')).toEqual({
      hours: 12,
      minutes: 0,
    });
    expect(parseScheduleLabelTime('Starting at 12:00 AM')).toEqual({
      hours: 0,
      minutes: 0,
    });
  });

  it('returns null for labels without an absolute time', () => {
    expect(parseScheduleLabelTime('Followed by')).toBeNull();
    expect(parseScheduleLabelTime('')).toBeNull();
    expect(parseScheduleLabelTime(null)).toBeNull();
  });

  it('handles unusual capitalisation and spacing', () => {
    expect(parseScheduleLabelTime('starting at 4:30pm')).toEqual({
      hours: 16,
      minutes: 30,
    });
  });
});

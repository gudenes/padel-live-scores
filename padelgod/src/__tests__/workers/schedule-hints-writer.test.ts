import { describe, it, expect } from 'vitest';
import type { Logger } from 'pino';
import { runScheduleHintsWriter } from '../../workers/schedule-hints-writer.js';

const SILENT_LOGGER = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Logger;

const NOW = new Date('2026-04-26T17:30:00.000Z');
const GAP = 90;

interface FakeRow {
  id: string;
  tournament_id: string;
  court: string | null;
  court_order: number | null;
  status: string;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  late_hint: string | null;
}

function makeFakeSupabase(rows: FakeRow[]) {
  const updates: Array<{ id: string; late_hint: string | null }> = [];
  const supabase = {
    from(_table: string) {
      return {
        select: () => ({
          in: () => ({
            gte: () => ({
              lte: () => Promise.resolve({ data: rows, error: null }),
            }),
          }),
        }),
        update(payload: { late_hint: string | null }) {
          return {
            eq: (_col: string, id: string) => {
              updates.push({ id, late_hint: payload.late_hint });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  } as unknown as Parameters<typeof runScheduleHintsWriter>[0]['supabase'];
  return { supabase, updates };
}

describe('runScheduleHintsWriter', () => {
  it('writes may_be_late when predecessor is live and running over', async () => {
    const startedIso = new Date(NOW.getTime() - 95 * 60_000).toISOString();
    const futureIso = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const rows: FakeRow[] = [
      {
        id: 'A', tournament_id: 't1', court: 'C1', court_order: 0,
        status: 'live', scheduled_at: startedIso,
        started_at: startedIso, finished_at: null, late_hint: null,
      },
      {
        id: 'B', tournament_id: 't1', court: 'C1', court_order: 1,
        status: 'scheduled', scheduled_at: futureIso,
        started_at: null, finished_at: null, late_hint: null,
      },
    ];
    const { supabase, updates } = makeFakeSupabase(rows);

    const result = await runScheduleHintsWriter({
      supabase,
      logger: SILENT_LOGGER,
      dryRun: false,
      expectedDurationMinutes: GAP,
      now: () => NOW,
    });

    expect(result.rowsUpdated).toBe(1);
    expect(updates).toEqual([{ id: 'B', late_hint: 'may_be_late' }]);
  });

  it('skips rows whose hint is already correct', async () => {
    const startedIso = new Date(NOW.getTime() - 95 * 60_000).toISOString();
    const futureIso = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const rows: FakeRow[] = [
      {
        id: 'A', tournament_id: 't1', court: 'C1', court_order: 0,
        status: 'live', scheduled_at: startedIso,
        started_at: startedIso, finished_at: null, late_hint: null,
      },
      {
        id: 'B', tournament_id: 't1', court: 'C1', court_order: 1,
        status: 'scheduled', scheduled_at: futureIso,
        started_at: null, finished_at: null, late_hint: 'may_be_late',
      },
    ];
    const { supabase, updates } = makeFakeSupabase(rows);

    const result = await runScheduleHintsWriter({
      supabase,
      logger: SILENT_LOGGER,
      dryRun: false,
      expectedDurationMinutes: GAP,
      now: () => NOW,
    });

    expect(result.rowsUpdated).toBe(0);
    expect(updates).toEqual([]);
  });

  it('does not write in dry-run mode', async () => {
    const startedIso = new Date(NOW.getTime() - 95 * 60_000).toISOString();
    const futureIso = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const rows: FakeRow[] = [
      {
        id: 'A', tournament_id: 't1', court: 'C1', court_order: 0,
        status: 'live', scheduled_at: startedIso,
        started_at: startedIso, finished_at: null, late_hint: null,
      },
      {
        id: 'B', tournament_id: 't1', court: 'C1', court_order: 1,
        status: 'scheduled', scheduled_at: futureIso,
        started_at: null, finished_at: null, late_hint: null,
      },
    ];
    const { supabase, updates } = makeFakeSupabase(rows);

    const result = await runScheduleHintsWriter({
      supabase,
      logger: SILENT_LOGGER,
      dryRun: true,
      expectedDurationMinutes: GAP,
      now: () => NOW,
    });

    expect(result.rowsToUpdate).toBe(1);
    expect(result.rowsUpdated).toBe(0);
    expect(updates).toEqual([]);
  });

  it('clears late_hint when match leaves scheduled status', async () => {
    const startedIso = new Date(NOW.getTime() - 30 * 60_000).toISOString();
    const rows: FakeRow[] = [
      {
        id: 'A', tournament_id: 't1', court: 'C1', court_order: 0,
        status: 'live', scheduled_at: startedIso,
        started_at: startedIso, finished_at: null,
        late_hint: 'starting_soon', // stale
      },
    ];
    const { supabase, updates } = makeFakeSupabase(rows);

    await runScheduleHintsWriter({
      supabase,
      logger: SILENT_LOGGER,
      dryRun: false,
      expectedDurationMinutes: GAP,
      now: () => NOW,
    });

    expect(updates).toEqual([{ id: 'A', late_hint: null }]);
  });

  it('groups by (tournament, court, day) — different courts independent', async () => {
    const startedIso = new Date(NOW.getTime() - 95 * 60_000).toISOString();
    const futureIso = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const rows: FakeRow[] = [
      // Court 1: A running over → B should get may_be_late
      {
        id: 'A', tournament_id: 't1', court: 'C1', court_order: 0,
        status: 'live', scheduled_at: startedIso,
        started_at: startedIso, finished_at: null, late_hint: null,
      },
      {
        id: 'B', tournament_id: 't1', court: 'C1', court_order: 1,
        status: 'scheduled', scheduled_at: futureIso,
        started_at: null, finished_at: null, late_hint: null,
      },
      // Court 2: independent — D has no predecessor in its court, time in future
      {
        id: 'D', tournament_id: 't1', court: 'C2', court_order: 0,
        status: 'scheduled', scheduled_at: futureIso,
        started_at: null, finished_at: null, late_hint: null,
      },
    ];
    const { supabase, updates } = makeFakeSupabase(rows);

    await runScheduleHintsWriter({
      supabase,
      logger: SILENT_LOGGER,
      dryRun: false,
      expectedDurationMinutes: GAP,
      now: () => NOW,
    });

    expect(updates).toEqual([{ id: 'B', late_hint: 'may_be_late' }]);
  });
});

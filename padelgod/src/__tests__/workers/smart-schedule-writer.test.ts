import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import { runSmartScheduleWriter } from '../../workers/smart-schedule-writer.js';
const now = new Date('2026-10-08T10:00:00Z');
const row = { id: 'next', tournament_id: 't', court: 'Central', court_order: 1, status: 'scheduled', scheduled_at: now.toISOString(), schedule_label: 'Starting at 12:00 PM', started_at: null, finished_at: null, duration: null, updated_at: now.toISOString(), sets: null, smart_schedule: null, tournament: { timezone: 'Europe/Berlin' } };
function setup(rows = [row], error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  const query = { select: () => query, or: () => query, order: () => query, eq: vi.fn(() => query), not: () => query, gte: () => query, lt: vi.fn(() => query),
    range: async () => ({ data: rows, error }), limit: async () => ({ data: [], error: null }) };
  const supabase = { from: () => query, rpc } as unknown as SupabaseClient;
  const logger = { info: vi.fn() } as unknown as Logger;
  return { supabase, logger, rpc, query, now: () => now };
}
describe('smart schedule writer', () => {
  it('dry run never calls the writer RPC', async () => {
    const deps = setup();
    expect(await runSmartScheduleWriter({ ...deps, dryRun: true })).toEqual({ proposed: 1, applied: false });
    expect(deps.rpc).not.toHaveBeenCalled();
  });
  it('writes an atomic batch with a source snapshot', async () => {
    const deps = setup();
    await runSmartScheduleWriter({ ...deps, dryRun: false });
    expect(deps.rpc).toHaveBeenCalledWith('write_smart_schedule', { updates: [expect.objectContaining({ match_id: 'next', forecast: expect.objectContaining({ next_to_play: true, model: 'pbp-calibration-v1' }) })], sources: [{ match_id: 'next', status: 'scheduled', court: 'Central', court_order: 1, scheduled_at: now.toISOString() }] });
  });
  it('clears old badges on terminal matches', async () => {
    const deps = setup([{ ...row, status: 'finished', smart_schedule: { old: true } } as unknown as typeof row]);
    await runSmartScheduleWriter({ ...deps, dryRun: false });
    expect(deps.rpc.mock.calls[0]?.[1].updates[0].forecast).toBeNull();
  });
  it('reports a race without claiming a successful update', async () => {
    const deps = setup(); deps.rpc.mockResolvedValue({ data: false, error: null });
    expect((await runSmartScheduleWriter({ ...deps, dryRun: false })).applied).toBe(false);
  });
  it('does not apply partial results on a source read failure', async () => {
    const deps = setup([], new Error('read failed'));
    await expect(runSmartScheduleWriter({ ...deps, dryRun: false })).rejects.toThrow('read failed');
    expect(deps.rpc).not.toHaveBeenCalled();
  });
  it("filters training to recorded past starts and resolves country timezones", async () => {
    const deps = setup([
      {
        ...row,
        tournament: { timezone: null, country: "ES" },
      } as unknown as typeof row,
    ]);
    await runSmartScheduleWriter({ ...deps, dryRun: false });
    expect(deps.query.eq).toHaveBeenCalledWith("last_updated_by", "padelgod");
    expect(deps.query.lt).toHaveBeenCalledWith("started_at", now.toISOString());
    expect(deps.rpc.mock.calls[0]?.[1].updates[0].forecast.next_to_play).toBe(
      true
    );
  });
});

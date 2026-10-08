import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import { computeSmartSchedule, type ScheduleMatch } from '../lib/smart-schedule.js';

const SELECT = 'id,tournament_id,court,court_order,status,scheduled_at,started_at,finished_at,duration,schedule_label,category,updated_at,smart_schedule,tournament:tournaments(timezone),sets(set_number,pair1_games,pair2_games,is_current,updated_at,games(updated_at))';
interface Row extends ScheduleMatch { smart_schedule: unknown }
export async function runSmartScheduleWriter(deps: { supabase: SupabaseClient; logger: Logger; dryRun: boolean; now?: () => Date }) {
  const now = (deps.now ?? (() => new Date()))();
  const from = new Date(now.getTime() - 48 * 3600_000).toISOString();
  const to = new Date(now.getTime() + 48 * 3600_000).toISOString();
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await deps.supabase.from('matches').select(SELECT)
      .or(`and(scheduled_at.gte.${from},scheduled_at.lte.${to}),smart_schedule.not.is.null,status.in.(live,on_court,suspended)`)
      .order('id').range(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data as unknown as Row[]));
    if ((data ?? []).length < 500) break;
  }
  const { data: history, error } = await deps.supabase.from('matches').select(SELECT)
    .eq('status', 'finished').not('started_at', 'is', null).not('duration', 'is', null)
    .gte('started_at', new Date(now.getTime() - 90 * 86400_000).toISOString())
    .order('started_at', { ascending: false }).limit(1000);
  if (error) throw error;
  const computed = computeSmartSchedule(rows, history as unknown as ScheduleMatch[], now);
  // Refresh timestamps for active forecasts too: UI expires the snapshot if the worker stops.
  const updates = rows.filter((r) => computed.get(r.id) !== null || r.smart_schedule !== null)
    .map((r) => ({ match_id: r.id, expected_updated_at: r.updated_at, forecast: computed.get(r.id) ?? null }));
  if (!updates.length) return { proposed: 0, applied: false };
  deps.logger.info({ proposed: updates.length, dryRun: deps.dryRun, sample: updates.slice(0, 10) }, 'smart-schedule: computed');
  if (deps.dryRun) return { proposed: updates.length, applied: false };
  // Score ticks/late hints also touch updated_at. Validate queue identity instead:
  // those writes must not starve this worker while the court is actively scoring.
  const sources = rows.map((r) => ({ match_id: r.id, status: r.status, court: r.court, court_order: r.court_order, scheduled_at: r.scheduled_at }));
  const { data: applied, error: writeError } = await deps.supabase.rpc('write_smart_schedule', { updates, sources });
  if (writeError) throw writeError;
  if (!applied) deps.logger.info('smart-schedule: source changed during calculation; retry next tick');
  return { proposed: updates.length, applied: applied === true };
}

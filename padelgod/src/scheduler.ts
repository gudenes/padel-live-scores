import cron, { type ScheduledTask } from 'node-cron';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import type { Logger } from 'pino';
import { runTournamentDiscovery } from './workers/tournament-discovery.js';
import { runWidgetCodeLookup } from './workers/widget-code-lookup.js';
import { runPlayerRankings } from './workers/player-rankings.js';
import { runEntryListFetcher } from './workers/entry-list-fetcher.js';
import { runDrawFetcher } from './workers/draw-fetcher.js';
import { runOopFetcher } from './workers/oop-fetcher.js';
import { runResultsFetcher } from './workers/results-fetcher.js';

export interface ScheduleEntry {
  name: string;
  cron: string;
  run: (deps: SchedulerDeps) => Promise<unknown>;
}

export interface SchedulerFlags {
  enableTournamentDiscovery: boolean;
  enableWidgetCodeLookup: boolean;
  enablePlayerRankings: boolean;
  enablePlayerProfile: boolean;
  enableEntryListFetcher: boolean;
  enableDrawFetcher: boolean;
  enableOopFetcher: boolean;
  enableResultsFetcher: boolean;
}

export interface SchedulerDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
  logger: Logger;
}

export function buildSchedule(flags: SchedulerFlags): ScheduleEntry[] {
  const entries: ScheduleEntry[] = [];
  if (flags.enableTournamentDiscovery) {
    entries.push({
      name: 'tournament-discovery',
      cron: '0 * * * *', // hourly at :00
      run: (deps) => runTournamentDiscovery(deps),
    });
  }
  if (flags.enableWidgetCodeLookup) {
    entries.push({
      name: 'widget-code-lookup',
      cron: '15 * * * *', // hourly at :15
      run: (deps) => runWidgetCodeLookup(deps),
    });
  }
  if (flags.enablePlayerRankings) {
    entries.push({
      name: 'player-rankings',
      cron: '0 5 * * *', // daily 05:00 UTC
      run: (deps) => runPlayerRankings(deps),
    });
  }
  if (flags.enablePlayerProfile) {
    entries.push({
      name: 'player-profile',
      cron: '30 * * * *', // hourly at :30 — caller decides which players to refresh
      run: async (deps) => {
        deps.logger.info('player-profile worker scheduled but no batch driver yet (V1.5)');
      },
    });
  }
  if (flags.enableEntryListFetcher) {
    entries.push({
      name: 'entry-list-fetcher',
      cron: '45 * * * *', // hourly at :45
      run: (deps) => runEntryListFetcher(deps),
    });
  }
  if (flags.enableDrawFetcher) {
    entries.push({
      name: 'draw-fetcher',
      cron: '20 */2 * * *', // every 2 hours at :20
      run: (deps) => runDrawFetcher(deps),
    });
  }
  if (flags.enableOopFetcher) {
    entries.push({
      name: 'oop-fetcher',
      cron: '50 * * * *', // hourly at :50
      run: (deps) => runOopFetcher(deps),
    });
  }
  if (flags.enableResultsFetcher) {
    entries.push({
      name: 'results-fetcher',
      cron: '55 * * * *', // hourly at :55
      run: (deps) => runResultsFetcher(deps),
    });
  }
  return entries;
}

export function startScheduler(
  schedule: ScheduleEntry[],
  deps: SchedulerDeps
): ScheduledTask[] {
  return schedule.map((entry) => {
    deps.logger.info({ worker: entry.name, cron: entry.cron }, 'Registering scheduled worker');
    return cron.schedule(entry.cron, async () => {
      const childLogger = deps.logger.child({ worker: entry.name });
      try {
        const startedAt = Date.now();
        const result = await entry.run({ ...deps, logger: childLogger });
        childLogger.info({ result, durationMs: Date.now() - startedAt }, 'Worker completed');
      } catch (err) {
        childLogger.error({ err }, 'Worker threw');
      }
    });
  });
}

export function stopScheduler(tasks: ScheduledTask[]): void {
  for (const t of tasks) t.stop();
}

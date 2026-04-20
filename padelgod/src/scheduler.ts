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
import { runStaticReconciler } from './workers/static-reconciler.js';

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
  enableStaticReconciler: boolean;
}

export interface SchedulerDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
  logger: Logger;
}

export type WorkerName =
  | 'tournament-discovery'
  | 'widget-code-lookup'
  | 'player-rankings'
  | 'player-profile'
  | 'entry-list-fetcher'
  | 'draw-fetcher'
  | 'oop-fetcher'
  | 'results-fetcher'
  | 'static-reconciler';

export type WorkerRunner = (deps: SchedulerDeps) => Promise<unknown>;

export const ALL_WORKERS: WorkerName[] = [
  'tournament-discovery',
  'widget-code-lookup',
  'player-rankings',
  'player-profile',
  'entry-list-fetcher',
  'draw-fetcher',
  'oop-fetcher',
  'results-fetcher',
  'static-reconciler',
];

export function getWorkerRunner(name: string): WorkerRunner | null {
  switch (name) {
    case 'tournament-discovery': return (deps) => runTournamentDiscovery(deps);
    case 'widget-code-lookup':   return (deps) => runWidgetCodeLookup(deps);
    case 'player-rankings':      return (deps) => runPlayerRankings(deps);
    case 'player-profile':       return async (deps) => {
      deps.logger.info('player-profile worker has no batch driver yet (V1.5)');
      return { stub: true };
    };
    case 'entry-list-fetcher':   return (deps) => runEntryListFetcher(deps);
    case 'draw-fetcher':         return (deps) => runDrawFetcher(deps);
    case 'oop-fetcher':          return (deps) => runOopFetcher(deps);
    case 'results-fetcher':      return (deps) => runResultsFetcher(deps);
    case 'static-reconciler':    return (deps) => runStaticReconciler({ supabase: deps.supabase, logger: deps.logger });
    default: return null;
  }
}

export function buildSchedule(flags: SchedulerFlags): ScheduleEntry[] {
  const entries: ScheduleEntry[] = [];
  if (flags.enableTournamentDiscovery) {
    entries.push({
      name: 'tournament-discovery',
      cron: '0 * * * *', // hourly at :00
      run: getWorkerRunner('tournament-discovery')!,
    });
  }
  if (flags.enableWidgetCodeLookup) {
    entries.push({
      name: 'widget-code-lookup',
      cron: '15 * * * *', // hourly at :15
      run: getWorkerRunner('widget-code-lookup')!,
    });
  }
  if (flags.enablePlayerRankings) {
    entries.push({
      name: 'player-rankings',
      cron: '0 5 * * *', // daily 05:00 UTC
      run: getWorkerRunner('player-rankings')!,
    });
  }
  if (flags.enablePlayerProfile) {
    entries.push({
      name: 'player-profile',
      cron: '30 * * * *', // hourly at :30 — caller decides which players to refresh
      run: getWorkerRunner('player-profile')!,
    });
  }
  if (flags.enableEntryListFetcher) {
    entries.push({
      name: 'entry-list-fetcher',
      cron: '45 * * * *', // hourly at :45
      run: getWorkerRunner('entry-list-fetcher')!,
    });
  }
  if (flags.enableDrawFetcher) {
    entries.push({
      name: 'draw-fetcher',
      cron: '20 */2 * * *', // every 2 hours at :20
      run: getWorkerRunner('draw-fetcher')!,
    });
  }
  if (flags.enableOopFetcher) {
    entries.push({
      name: 'oop-fetcher',
      cron: '50 * * * *', // hourly at :50
      run: getWorkerRunner('oop-fetcher')!,
    });
  }
  if (flags.enableResultsFetcher) {
    entries.push({
      name: 'results-fetcher',
      cron: '55 * * * *', // hourly at :55
      run: getWorkerRunner('results-fetcher')!,
    });
  }
  if (flags.enableStaticReconciler) {
    entries.push({
      name: 'static-reconciler',
      cron: '5,35 * * * *', // twice hourly at :05 and :35 — consumes snapshots from fetchers
      run: getWorkerRunner('static-reconciler')!,
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

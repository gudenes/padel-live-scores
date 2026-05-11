import cron, { type ScheduledTask } from 'node-cron';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import type { Logger } from 'pino';
import { runTournamentDiscovery } from './workers/tournament-discovery.js';
import { runWidgetCodeLookup } from './workers/widget-code-lookup.js';
import { runPlayerRankings } from './workers/player-rankings.js';
import { runEntryListFetcher } from './workers/entry-list-fetcher.js';
import { runDrawFetcher } from './workers/draw-fetcher.js';
import { runFipDrawFetcher } from './workers/fip-draw-fetcher.js';
import { runFipDrawPopulator } from './workers/fip-draw-populator.js';
import { runFipEntryListPopulator } from './workers/fip-entry-list-populator.js';
import { runFipOopWriter } from './workers/fip-oop-writer.js';
import { runFipResultsWriter } from './workers/fip-results-writer.js';
import { runScheduleHintsWriter } from './workers/schedule-hints-writer.js';
import { runFipWinnerPropagator } from './workers/fip-winner-propagator.js';
import { runFipDrawLinker } from './workers/fip-draw-linker.js';
import { runOopFetcher } from './workers/oop-fetcher.js';
import { runResultsFetcher } from './workers/results-fetcher.js';
import { runStaticReconciler } from './workers/static-reconciler.js';
import { runMatchStatsFetcher } from './workers/match-stats-fetcher.js';
import { runLivePollerManager } from './workers/live-poller-manager.js';
import { runShadowDiffFinalizer } from './workers/shadow-diff-finalizer.js';
import { runShadowDiffLive } from './workers/shadow-diff-live.js';
import { runCloseStaleLiveSweeper } from './workers/close-stale-live-sweeper.js';
import { runFipEventPageEnricher } from './workers/fip-event-page-enricher.js';
import { runPlayerProfileBatch } from './workers/player-profile.js';

export interface ScheduleEntry {
  name: string;
  cron: string;
  run: (deps: SchedulerDeps) => Promise<unknown>;
}

export interface SchedulerFlags {
  enableTournamentDiscovery: boolean;
  enableFipEventPageEnricher: boolean;
  enableWidgetCodeLookup: boolean;
  enablePlayerRankings: boolean;
  enablePlayerProfile: boolean;
  enableEntryListFetcher: boolean;
  enableDrawFetcher: boolean;
  enableFipDrawFetcher: boolean;
  enableFipDrawPopulator: boolean;
  /** When true (default), the populator logs proposed writes but makes
   *  no DB changes. Flip to false in Railway once dry-run output is
   *  reviewed and we're ready for real writes. */
  fipDrawPopulatorDryRun: boolean;
  /** Comma-separated tournament UUIDs. Empty → no filter (process
   *  all eligible). See FIP_DRAW_POPULATOR_ONLY_TOURNAMENTS env var. */
  fipDrawPopulatorOnlyTournaments: string;
  /** Comma-separated `tournaments.level` values. Tournaments at any
   *  of these levels are skipped before the per-tournament loop runs.
   *  Composes with the allowlist (allowlist applied first). Empty →
   *  no level exclusion. See FIP_DRAW_POPULATOR_EXCLUDE_LEVELS env var. */
  fipDrawPopulatorExcludeLevels: string;
  enableFipEntryListPopulator: boolean;
  /** Same dry-run semantics as the populator flag. Independent. */
  fipEntryListPopulatorDryRun: boolean;
  enableFipOopWriter: boolean;
  /** Same dry-run semantics as the populator flag. Independent. */
  fipOopWriterDryRun: boolean;
  enableFipResultsWriter: boolean;
  /** Same dry-run semantics as the populator flag. Independent. */
  fipResultsWriterDryRun: boolean;
  enableFipWinnerPropagator: boolean;
  /** Same dry-run semantics. Independent. */
  fipWinnerPropagatorDryRun: boolean;
  enableFipDrawLinker: boolean;
  fipDrawLinkerDryRun: boolean;
  enableOopFetcher: boolean;
  enableResultsFetcher: boolean;
  enableStaticReconciler: boolean;
  enableMatchStatsFetcher: boolean;
  enableLivePollerManager: boolean;
  enableShadowDiffFinalizer: boolean;
  enableShadowDiffLive: boolean;
  enableCloseStaleLiveSweeper: boolean;
  enableScheduleHintsWriter: boolean;
  /** Same dry-run semantics as the populator flag. Independent. */
  scheduleHintsWriterDryRun: boolean;
  /** Default 90. Override via env to tune the "running over" threshold. */
  scheduleHintsExpectedDurationMin: number;
}

export interface SchedulerDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
  logger: Logger;
  /**
   * Optional web-push notify configuration. Forwarded by getWorkerRunner to
   * `runLivePollerManager` only. Populated in `index.ts` from the env:
   *   - `NOTIFY_BASE_URL` (e.g. `https://padelnachos.com`)
   *   - `CRON_SECRET` (same value as the Vercel side)
   * If either env var is missing, `notify` stays `undefined` and the push
   * hook inside `dualWriteShadowToPublic` silently no-ops.
   */
  notify?: import('./lib/notify.js').NotifyDeps;
  /**
   * Dry-run flag for the fip-draw-linker worker. When true (default),
   * the worker proposes and logs linkages without writing to
   * entity_external_ids. Threaded via deps (not an option to
   * runFipDrawLinker directly) because the scheduler dispatches workers
   * via the uniform `getWorkerRunner(name)(deps)` signature — this
   * keeps that signature unchanged.
   */
  fipDrawLinkerDryRun?: boolean;
}

export type WorkerName =
  | 'tournament-discovery'
  | 'fip-event-page-enricher'
  | 'widget-code-lookup'
  | 'player-rankings'
  | 'player-profile'
  | 'entry-list-fetcher'
  | 'draw-fetcher'
  | 'fip-draw-fetcher'
  | 'fip-draw-linker'
  | 'fip-draw-populator'
  | 'fip-entry-list-populator'
  | 'fip-oop-writer'
  | 'fip-results-writer'
  | 'fip-winner-propagator'
  | 'oop-fetcher'
  | 'results-fetcher'
  | 'static-reconciler'
  | 'match-stats-fetcher'
  | 'live-poller-manager'
  | 'shadow-diff-finalizer'
  | 'shadow-diff-live'
  | 'close-stale-live-sweeper'
  | 'schedule-hints-writer';

export type WorkerRunner = (deps: SchedulerDeps) => Promise<unknown>;

export const ALL_WORKERS: WorkerName[] = [
  'tournament-discovery',
  'fip-event-page-enricher',
  'widget-code-lookup',
  'player-rankings',
  'player-profile',
  'entry-list-fetcher',
  'draw-fetcher',
  'fip-draw-fetcher',
  'fip-draw-linker',
  'fip-draw-populator',
  'fip-entry-list-populator',
  'fip-oop-writer',
  'fip-results-writer',
  'fip-winner-propagator',
  'oop-fetcher',
  'results-fetcher',
  'static-reconciler',
  'match-stats-fetcher',
  'live-poller-manager',
  'shadow-diff-finalizer',
  'shadow-diff-live',
  'close-stale-live-sweeper',
  'schedule-hints-writer',
];

export function getWorkerRunner(name: string): WorkerRunner | null {
  switch (name) {
    case 'tournament-discovery':     return (deps) => runTournamentDiscovery(deps);
    case 'fip-event-page-enricher':  return (deps) => runFipEventPageEnricher(deps);
    case 'widget-code-lookup':       return (deps) => runWidgetCodeLookup(deps);
    case 'player-rankings':      return (deps) => runPlayerRankings(deps);
    case 'player-profile':       return async (deps) => {
      const tournamentResult = await runPlayerProfileBatch(
        { supabase: deps.supabase, httpClient: deps.httpClient },
        { mode: 'tournament', limit: 40, retryAfterDays: 30, throttleMs: 750 },
      );
      deps.logger.info(
        { worker: 'player-profile', phase: 'tournament', ...tournamentResult },
        `tournament batch attempted=${tournamentResult.attempted} ok=${tournamentResult.succeeded} fail=${tournamentResult.failed}`,
      );

      // Top up with ranked-fallback if we had spare quota.
      const spare = 40 - tournamentResult.attempted;
      if (spare > 0) {
        const fallbackResult = await runPlayerProfileBatch(
          { supabase: deps.supabase, httpClient: deps.httpClient },
          { mode: 'ranked', limit: spare, retryAfterDays: 30, throttleMs: 750 },
        );
        deps.logger.info(
          { worker: 'player-profile', phase: 'ranked-fallback', ...fallbackResult },
          `ranked-fallback attempted=${fallbackResult.attempted} ok=${fallbackResult.succeeded} fail=${fallbackResult.failed}`,
        );
        return { tournament: tournamentResult, fallback: fallbackResult };
      }

      return { tournament: tournamentResult };
    };
    case 'entry-list-fetcher':   return (deps) => runEntryListFetcher(deps);
    case 'draw-fetcher':         return (deps) => runDrawFetcher(deps);
    case 'fip-draw-fetcher':     return (deps) => runFipDrawFetcher(deps);
    case 'fip-draw-populator':   return (deps) => runFipDrawPopulator({
      supabase: deps.supabase,
      logger: deps.logger,
      // Admin triggers via /admin/run-worker default to dry-run-SAFE.
      // The scheduled cron entry in buildSchedule() threads in the
      // actual env-flag value via a closure override. See the
      // 'fip-draw-populator' branch of buildSchedule below.
      dryRun: true,
    });
    case 'fip-entry-list-populator': return (deps) => runFipEntryListPopulator({
      supabase: deps.supabase,
      logger: deps.logger,
      // Same admin-trigger dry-run-SAFE default. Scheduled cron entry
      // threads the real env flag via closure (see buildSchedule below).
      dryRun: true,
    });
    case 'fip-oop-writer':       return (deps) => runFipOopWriter({
      supabase: deps.supabase,
      logger: deps.logger,
      // Same admin-trigger dry-run-SAFE default as populator. Scheduled
      // cron entry threads the real env flag via closure.
      dryRun: true,
    });
    case 'fip-results-writer':   return (deps) => runFipResultsWriter({
      supabase: deps.supabase,
      logger: deps.logger,
      // Admin-trigger dry-run-SAFE default. Scheduled cron threads the
      // real env flag via closure (buildSchedule below).
      dryRun: true,
    });
    case 'fip-winner-propagator': return (deps) => runFipWinnerPropagator({
      supabase: deps.supabase,
      logger: deps.logger,
      // Admin-trigger dry-run-SAFE default. Scheduled cron threads the
      // real env flag via closure.
      dryRun: true,
    });
    case 'fip-draw-linker':      return (deps) => runFipDrawLinker(
      { supabase: deps.supabase, logger: deps.logger },
      { dryRun: deps.fipDrawLinkerDryRun ?? true },
    );
    case 'oop-fetcher':          return (deps) => runOopFetcher(deps);
    case 'results-fetcher':      return (deps) => runResultsFetcher(deps);
    case 'static-reconciler':    return (deps) => runStaticReconciler({ supabase: deps.supabase, logger: deps.logger });
    case 'match-stats-fetcher':  return (deps) => runMatchStatsFetcher(deps);
    case 'live-poller-manager':  return (deps) => runLivePollerManager({
      supabase: deps.supabase,
      httpClient: deps.httpClient,
      logger: deps.logger,
      notify: deps.notify,
    });
    case 'shadow-diff-finalizer': return (deps) => runShadowDiffFinalizer({ supabase: deps.supabase, logger: deps.logger });
    case 'shadow-diff-live':      return (deps) => runShadowDiffLive({ supabase: deps.supabase, logger: deps.logger });
    case 'close-stale-live-sweeper': return (deps) => runCloseStaleLiveSweeper({ supabase: deps.supabase, logger: deps.logger });
    case 'schedule-hints-writer':   return (deps) => runScheduleHintsWriter({
      supabase: deps.supabase,
      logger: deps.logger,
      // Admin-trigger always dry-run-safe. Scheduled cron threads the real
      // env flag via closure (see buildSchedule below).
      dryRun: true,
      expectedDurationMinutes: 90, // matches env default
    });
    default: return null;
  }
}

/**
 * Parse the `FIP_DRAW_POPULATOR_ONLY_TOURNAMENTS` env string into a
 * UUID set. Empty/whitespace input → undefined (no filter). Invalid
 * entries are silently dropped (operator sees the resulting set size
 * in the worker's log output at startup and can self-correct).
 */
function parseTournamentAllowlist(raw: string): Set<string> | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = trimmed
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && UUID_RE.test(s));
  return ids.length > 0 ? new Set(ids) : undefined;
}

/**
 * Parse the `FIP_DRAW_POPULATOR_EXCLUDE_LEVELS` env string into a set
 * of `tournaments.level` strings. Empty/whitespace input → undefined
 * (no exclusion). Levels are normalised to lowercase to match the
 * `level` column convention (e.g. "p1", "fip_silver"). Validation is
 * permissive: anything non-empty after trim is accepted, since the
 * level vocabulary is defined upstream and may evolve. The worker's
 * skip counter surfaces any typos at runtime.
 */
function parseExcludeLevels(raw: string): Set<string> | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const levels = trimmed
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  return levels.length > 0 ? new Set(levels) : undefined;
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
  if (flags.enableFipEventPageEnricher) {
    entries.push({
      name: 'fip-event-page-enricher',
      // Hourly at :12 — runs after tournament-discovery (:00) so it sees
      // freshly-discovered rows in the same cycle. Chosen to avoid overlap
      // with the cluster of FIP-specific writers (:35, :42, :46, :47, :52, :57).
      cron: '12 * * * *',
      run: getWorkerRunner('fip-event-page-enricher')!,
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
      cron: '0 7 * * *', // daily 07:00 UTC
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
  if (flags.enableFipDrawFetcher) {
    entries.push({
      name: 'fip-draw-fetcher',
      // Hourly at :35 — slots between oop-fetcher (:50) and static-reconciler
      // (:05/:35). FIP nonces are short-lived, so we re-fetch the event page
      // on every run; hourly gives us low-latency pickup of newly-seeded
      // brackets without hammering padelfip.com.
      cron: '35 * * * *',
      run: getWorkerRunner('fip-draw-fetcher')!,
    });
  }
  if (flags.enableFipDrawLinker) {
    entries.push({
      name: 'fip-draw-linker',
      // Hourly at :42 — ~7 min after fip-draw-fetcher (:35) so the latest
      // snapshots have landed. Reads only, no external HTTP — all DB queries
      // to our own Supabase. No need to worry about rate limits.
      cron: '42 * * * *',
      run: getWorkerRunner('fip-draw-linker')!,
    });
  }
  if (flags.enableFipEntryListPopulator) {
    entries.push({
      name: 'fip-entry-list-populator',
      // Hourly at :46 — sequenced AFTER entry-list-fetcher (:45, which
      // writes padelgod.entry_list_snapshots) and BEFORE
      // fip-draw-populator (:47, which reads public.players to resolve
      // fip_id → player.id during draw position writes). One-minute
      // gap is comfortably enough — entry-list-fetcher's slowest
      // observed run is ~25s.
      cron: '46 * * * *',
      run: async (deps) => {
        return runFipEntryListPopulator({
          supabase: deps.supabase,
          logger: deps.logger,
          dryRun: flags.fipEntryListPopulatorDryRun,
        });
      },
    });
  }
  if (flags.enableFipDrawPopulator) {
    entries.push({
      name: 'fip-draw-populator',
      // Hourly at :47 — sequenced AFTER fip-draw-fetcher (:35, writes
      // draw_snapshots) AND entry-list-fetcher (:45, writes the
      // name→fip_id map the populator needs). Running at :47 means the
      // populator always sees the fresh snapshots from the current hour.
      cron: '47 * * * *',
      run: async (deps) => {
        // Override the default admin-trigger dry-run with the env-flag
        // value for scheduled runs — this is the only path that can
        // flip dry-run off.
        const allowlist = parseTournamentAllowlist(
          flags.fipDrawPopulatorOnlyTournaments,
        );
        const excludeLevels = parseExcludeLevels(
          flags.fipDrawPopulatorExcludeLevels,
        );
        return runFipDrawPopulator({
          supabase: deps.supabase,
          logger: deps.logger,
          dryRun: flags.fipDrawPopulatorDryRun,
          onlyTournamentIds: allowlist,
          excludeLevels,
        });
      },
    });
  }
  if (flags.enableFipOopWriter) {
    entries.push({
      name: 'fip-oop-writer',
      // Every 15 min at :02/:17/:32/:47 — sequenced 2 min AFTER
      // oop-fetcher (:00/:15/:30/:45) so the snapshots are fresh.
      // DB-only worker; no upstream contention.
      cron: '2,17,32,47 * * * *',
      run: async (deps) => {
        return runFipOopWriter({
          supabase: deps.supabase,
          logger: deps.logger,
          dryRun: flags.fipOopWriterDryRun,
        });
      },
    });
  }
  if (flags.enableFipResultsWriter) {
    entries.push({
      name: 'fip-results-writer',
      // Every 5 min at :02/:07/:12/... — sequenced 2 min AFTER
      // results-fetcher (:00/:05/:10/...) so the snapshots are fresh.
      // DB-only worker; no upstream contention.
      cron: '2-57/5 * * * *',
      run: async (deps) => {
        return runFipResultsWriter({
          supabase: deps.supabase,
          logger: deps.logger,
          dryRun: flags.fipResultsWriterDryRun,
        });
      },
    });
  }
  if (flags.enableFipWinnerPropagator) {
    entries.push({
      name: 'fip-winner-propagator',
      // Hourly at :02 — the FIRST slot of each hour, right after any
      // late-arriving results from the previous hour. Clean window
      // before reconciler at :05 so there's no contention on
      // public.matches writes. Pure DB-to-DB, fast (<1s per
      // tournament), so running every hour even when most rounds have
      // already been propagated is fine.
      cron: '2 * * * *',
      run: async (deps) => {
        return runFipWinnerPropagator({
          supabase: deps.supabase,
          logger: deps.logger,
          dryRun: flags.fipWinnerPropagatorDryRun,
        });
      },
    });
  }
  if (flags.enableOopFetcher) {
    entries.push({
      name: 'oop-fetcher',
      cron: '*/15 * * * *', // every 15 min at :00/:15/:30/:45
      run: getWorkerRunner('oop-fetcher')!,
    });
  }
  if (flags.enableResultsFetcher) {
    entries.push({
      name: 'results-fetcher',
      cron: '*/5 * * * *', // every 5 min
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
  if (flags.enableMatchStatsFetcher) {
    entries.push({
      name: 'match-stats-fetcher',
      cron: '25,55 * * * *', // twice hourly at :25 and :55 — 20-match batch × 2/hr keeps recent finishes fresh
      run: getWorkerRunner('match-stats-fetcher')!,
    });
  }
  if (flags.enableLivePollerManager) {
    entries.push({
      name: 'live-poller-manager',
      // Every minute. The manager is fast (one RPC + diff against in-memory
      // map) — the actual long-running work is inside LivePollerLoop instances,
      // which are long-lived setInterval chains in-process, not controlled by
      // node-cron. This cron entry is just the manager's lifecycle check.
      cron: '*/1 * * * *',
      run: getWorkerRunner('live-poller-manager')!,
    });
  }
  if (flags.enableShadowDiffFinalizer) {
    entries.push({
      name: 'shadow-diff-finalizer',
      // Twice hourly, interleaved with static-reconciler (:05, :35) so divergence
      // rows land shortly after each reconciler tick flips matches to 'finished'.
      cron: '10,40 * * * *',
      run: getWorkerRunner('shadow-diff-finalizer')!,
    });
  }
  if (flags.enableShadowDiffLive) {
    entries.push({
      name: 'shadow-diff-live',
      cron: '*/1 * * * *', // every minute, snapshots per-live-match latency
      run: getWorkerRunner('shadow-diff-live')!,
    });
  }
  if (flags.enableCloseStaleLiveSweeper) {
    entries.push({
      name: 'close-stale-live-sweeper',
      // Every 5 minutes. Closes matches stuck at live/ended when the live-poller
      // can't (Crionet never emits terminal status; Railway restarts wipe in-memory
      // state). Reads from our own DB — no external calls, safe to run frequently.
      cron: '*/5 * * * *',
      run: getWorkerRunner('close-stale-live-sweeper')!,
    });
  }
  if (flags.enableScheduleHintsWriter) {
    entries.push({
      name: 'schedule-hints-writer',
      // Every 2 minutes — worst-case staleness for a late hint to appear or
      // clear after the underlying match status changes. DB-only; no external
      // HTTP calls, so the cadence is safe.
      cron: '*/2 * * * *',
      run: async (deps) => {
        return runScheduleHintsWriter({
          supabase: deps.supabase,
          logger: deps.logger,
          dryRun: flags.scheduleHintsWriterDryRun,
          expectedDurationMinutes: flags.scheduleHintsExpectedDurationMin,
        });
      },
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

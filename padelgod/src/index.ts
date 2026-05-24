import { EventEmitter } from 'node:events';
import Fastify from 'fastify';
import { loadEnv } from './lib/env.js';
import { initSentry } from './lib/sentry.js';

// Initialize Sentry FIRST — before any other module that might throw.
// initSentry is a no-op when SENTRY_DSN is unset, so this stays safe in
// local dev. The reason we init this far up the file (above even
// EventEmitter / loadEnv) is so any surprise error during boot — e.g.
// loadEnv itself failing on a malformed env var — has a chance of being
// captured and shipped before the process exits.
initSentry();

// Bump the default EventEmitter listener ceiling before anything else loads.
//
// Node's native `fetch` (undici) attaches an 'error' listener to each pooled
// TLSSocket per request. With keep-alive connection reuse + multiple workers
// (shadow-diff-live runs every minute, live-poller-manager every minute,
// static-reconciler twice/hr, etc.) a single pooled socket can legitimately
// carry more than 10 concurrent/pending request listeners. The 24h log audit
// on 2026-04-23 showed 20+ `MaxListenersExceededWarning` at 11 listeners —
// always starting ~7 min after startup and plateauing there, never growing
// unbounded. That matches "pooled socket handling ~N concurrent requests",
// not an actual leak.
//
// Raising to 50 gives us generous headroom for normal operation while still
// catching a REAL leak (a leak would blow past 50 rapidly). `process` +
// `EventEmitter.defaultMaxListeners` cover the two places Node reads the
// limit from — we set both to be defensive.
//
// Source references:
//   - https://github.com/supabase/supabase-js/issues (recurring theme in
//     multi-worker deployments on Node 18+)
//   - https://undici.nodejs.org/ (connection pooling + listener attach)
const MAX_LISTENERS_CEILING = 50;
EventEmitter.defaultMaxListeners = MAX_LISTENERS_CEILING;
process.setMaxListeners(MAX_LISTENERS_CEILING);
import { createLogger } from './lib/logger.js';
import { createSupabaseClient } from './lib/supabase.js';
import { registerHealthRoute } from './api/health.js';
import { registerAdminRoutes } from './api/admin.js';
import { registerRefreshTournamentRoute } from './api/refresh-tournament.js';
import { createHttpClient, PADELGOD_USER_AGENT } from './lib/http-client.js';
import { buildSchedule, startScheduler, stopScheduler, type SchedulerDeps } from './scheduler.js';
import { shutdownBrowser } from './lib/playwright-pool.js';
import { recordEnvConfigured } from './lib/notify-stats.js';

const VERSION = '0.1.0';
const startedAt = new Date();

async function main() {
  const env = loadEnv();
  const logger = createLogger({ level: env.LOG_LEVEL, service: 'padelgod' });

  // Initialize Supabase client (validates connectivity at first query, not boot)
  const supabase = createSupabaseClient({
    url: env.SUPABASE_URL,
    serviceKey: env.SUPABASE_SERVICE_KEY,
  });
  logger.info({ url: env.SUPABASE_URL }, 'Supabase client initialized');

  // Fastify app
  const app = Fastify({
    logger: false, // we use pino directly via logger var
    trustProxy: true,
  });

  const httpClient = createHttpClient({ userAgent: PADELGOD_USER_AGENT });

  registerHealthRoute(app, { startedAt, version: VERSION });
  registerAdminRoutes(app, {
    adminToken: env.PADELGOD_ADMIN_TOKEN,
    supabase,
    httpClient,
    logger,
    fipDrawLinkerDryRun: env.FIP_DRAW_LINKER_DRY_RUN,
  });
  registerRefreshTournamentRoute(app, {
    adminToken: env.PADELGOD_ADMIN_TOKEN,
    supabase,
    httpClient,
    logger,
  });

  // Preserve known-client-error status codes (4xx) from Fastify — e.g.
  // FST_ERR_CTP_INVALID_MEDIA_TYPE (415) from a request with no/wrong
  // Content-Type header. Without this, every client-side mistake surfaces
  // as a generic 500 "Internal server error" and callers can't tell the
  // difference between "you sent a bad header" and "our service crashed".
  //
  // Rules:
  //   - err.statusCode < 500 → pass through the real status + real message
  //     + real Fastify error code (e.g. "FST_ERR_CTP_INVALID_MEDIA_TYPE")
  //   - anything else (no statusCode, >=500, runtime throws) → keep the
  //     original behaviour: log at error + return 500 INTERNAL_ERROR with
  //     a generic message so we don't leak internals to the caller
  //
  // Route handlers still log at `info` for the request itself via Fastify's
  // built-in logger — this handler only fires on UNHANDLED errors, so a
  // 415 from a bad Content-Type is logged at `warn` (expected client
  // misuse, not a service bug) while a real runtime throw stays `error`.
  app.setErrorHandler((err, _req, reply) => {
    const isClientError =
      typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500;
    if (isClientError) {
      logger.warn({ err }, 'Client error');
      reply.status(err.statusCode!).send({
        error: {
          code: err.code ?? 'CLIENT_ERROR',
          message: err.message || 'Client error',
        },
      });
      return;
    }
    logger.error({ err }, 'Unhandled error');
    reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  });

  try {
    const address = await app.listen({ port: env.PORT, host: '0.0.0.0' });
    logger.info({ address, version: VERSION }, 'padelgod listening');
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }

  // Scheduler — runs workers on cron schedules
  let scheduledTasks: ReturnType<typeof startScheduler> = [];
  if (env.ENABLE_SCHEDULER) {
    const schedule = buildSchedule({
      enableTournamentDiscovery: env.ENABLE_TOURNAMENT_DISCOVERY,
      enableFipEventPageEnricher: env.ENABLE_FIP_EVENT_PAGE_ENRICHER,
      enableWidgetCodeLookup: env.ENABLE_WIDGET_CODE_LOOKUP,
      enablePlayerRankings: env.ENABLE_PLAYER_RANKINGS,
      enablePlayerProfile: env.ENABLE_PLAYER_PROFILE,
      enableEntryListFetcher: env.ENABLE_ENTRY_LIST_FETCHER,
      enableDrawFetcher: env.ENABLE_DRAW_FETCHER,
      enableFipDrawFetcher: env.ENABLE_FIP_DRAW_FETCHER,
      enableFipDrawLinker: env.ENABLE_FIP_DRAW_LINKER,
      enableFipDrawPopulator: env.ENABLE_FIP_DRAW_POPULATOR,
      fipDrawPopulatorDryRun: env.FIP_DRAW_POPULATOR_DRY_RUN,
      fipDrawPopulatorOnlyTournaments: env.FIP_DRAW_POPULATOR_ONLY_TOURNAMENTS,
      fipDrawPopulatorExcludeLevels: env.FIP_DRAW_POPULATOR_EXCLUDE_LEVELS,
      enableFipEntryListPopulator: env.ENABLE_FIP_ENTRY_LIST_POPULATOR,
      fipEntryListPopulatorDryRun: env.FIP_ENTRY_LIST_POPULATOR_DRY_RUN,
      enableFipOopWriter: env.ENABLE_FIP_OOP_WRITER,
      fipOopWriterDryRun: env.FIP_OOP_WRITER_DRY_RUN,
      enableFipResultsWriter: env.ENABLE_FIP_RESULTS_WRITER,
      fipResultsWriterDryRun: env.FIP_RESULTS_WRITER_DRY_RUN,
      enableFipWinnerPropagator: env.ENABLE_FIP_WINNER_PROPAGATOR,
      fipWinnerPropagatorDryRun: env.FIP_WINNER_PROPAGATOR_DRY_RUN,
      fipDrawLinkerDryRun: env.FIP_DRAW_LINKER_DRY_RUN,
      enableOopFetcher: env.ENABLE_OOP_FETCHER,
      enableResultsFetcher: env.ENABLE_RESULTS_FETCHER,
      enableStaticReconciler: env.ENABLE_STATIC_RECONCILER,
      enableMatchStatsFetcher: env.ENABLE_MATCH_STATS_FETCHER,
      enableLivePollerManager: env.ENABLE_LIVE_POLLER_MANAGER,
      enableShadowDiffFinalizer: env.ENABLE_SHADOW_DIFF_FINALIZER,
      enableShadowDiffLive: env.ENABLE_SHADOW_DIFF_LIVE,
      enableShadowDiffOcr: env.ENABLE_SHADOW_DIFF_OCR,
      enableCloseStaleLiveSweeper: env.ENABLE_CLOSE_STALE_LIVE_SWEEPER,
      enableScheduleHintsWriter: env.ENABLE_SCHEDULE_HINTS_WRITER,
      scheduleHintsWriterDryRun: env.SCHEDULE_HINTS_WRITER_DRY_RUN,
      scheduleHintsExpectedDurationMin: env.SCHEDULE_HINTS_EXPECTED_DURATION_MIN,
    });
    // Build the notify config for live-poller-manager. Both env vars must be
    // present — otherwise we pass `undefined` and the hook inside
    // `dualWriteShadowToPublic` no-ops (safe fallback for local/test).
    // Logger is child-scoped so notify errors carry the `notify:true` tag
    // for easy grep in Railway logs.
    const notify =
      env.NOTIFY_BASE_URL && env.CRON_SECRET
        ? {
            baseUrl: env.NOTIFY_BASE_URL,
            cronSecret: env.CRON_SECRET,
            logger: logger.child({ component: 'notify' }),
          }
        : undefined;
    // Surface env-config state to /admin/notify-stats so operators can
    // verify from outside Railway whether the push hook is armed.
    recordEnvConfigured(!!notify);

    if (!notify) {
      logger.warn(
        {
          hasBaseUrl: !!env.NOTIFY_BASE_URL,
          hasCronSecret: !!env.CRON_SECRET,
        },
        'NOTIFY_BASE_URL or CRON_SECRET not set — push notify hook disabled',
      );
    } else {
      logger.info(
        { baseUrl: env.NOTIFY_BASE_URL },
        'Push notify hook enabled for live-poller transitions',
      );
    }

    const schedulerDeps: SchedulerDeps = {
      supabase,
      httpClient,
      logger,
      notify,
      fipDrawLinkerDryRun: env.FIP_DRAW_LINKER_DRY_RUN,
    };
    scheduledTasks = startScheduler(schedule, schedulerDeps);
    logger.info({ workers: schedule.length }, 'Scheduler started');
  } else {
    logger.warn('Scheduler disabled via ENABLE_SCHEDULER=false');
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down gracefully');
    stopScheduler(scheduledTasks);
    await shutdownBrowser();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

import Fastify from 'fastify';
import { loadEnv } from './lib/env.js';
import { createLogger } from './lib/logger.js';
import { createSupabaseClient } from './lib/supabase.js';
import { registerHealthRoute } from './api/health.js';
import { registerAdminRoutes } from './api/admin.js';
import { createHttpClient, PADELGOD_USER_AGENT } from './lib/http-client.js';
import { buildSchedule, startScheduler, stopScheduler, type SchedulerDeps } from './scheduler.js';
import { shutdownBrowser } from './lib/playwright-pool.js';

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
  });

  app.setErrorHandler((err, _req, reply) => {
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
      enableWidgetCodeLookup: env.ENABLE_WIDGET_CODE_LOOKUP,
      enablePlayerRankings: env.ENABLE_PLAYER_RANKINGS,
      enablePlayerProfile: env.ENABLE_PLAYER_PROFILE,
      enableEntryListFetcher: env.ENABLE_ENTRY_LIST_FETCHER,
      enableDrawFetcher: env.ENABLE_DRAW_FETCHER,
      enableOopFetcher: env.ENABLE_OOP_FETCHER,
      enableResultsFetcher: env.ENABLE_RESULTS_FETCHER,
      enableStaticReconciler: env.ENABLE_STATIC_RECONCILER,
      enableMatchStatsFetcher: env.ENABLE_MATCH_STATS_FETCHER,
      enableLivePollerManager: env.ENABLE_LIVE_POLLER_MANAGER,
      enableShadowDiffFinalizer: env.ENABLE_SHADOW_DIFF_FINALIZER,
      enableShadowDiffLive: env.ENABLE_SHADOW_DIFF_LIVE,
      enableCloseStaleLiveSweeper: env.ENABLE_CLOSE_STALE_LIVE_SWEEPER,
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

    const schedulerDeps: SchedulerDeps = { supabase, httpClient, logger, notify };
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

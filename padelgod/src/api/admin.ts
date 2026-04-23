import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import type { Logger } from 'pino';
import { getWorkerRunner, ALL_WORKERS } from '../scheduler.js';
import { getNotifyStats } from '../lib/notify-stats.js';

export interface AdminRouteOptions {
  adminToken: string;
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
  logger: Logger;
}

export function registerAdminRoutes(app: FastifyInstance, opts: AdminRouteOptions): void {
  app.post('/admin/run-worker', async (req: FastifyRequest, reply: FastifyReply) => {
    // Auth
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${opts.adminToken}`) {
      reply.status(401);
      return { error: { code: 'UNAUTHENTICATED', message: 'Invalid or missing admin token' } };
    }

    const body = req.body as { worker?: string } | undefined;
    const workerName = body?.worker?.trim();
    if (!workerName) {
      reply.status(400);
      return { error: { code: 'INVALID_INPUT', message: 'Body must include { "worker": "<name>" }' } };
    }

    const runner = getWorkerRunner(workerName);
    if (!runner) {
      reply.status(400);
      return {
        error: {
          code: 'INVALID_INPUT',
          message: `Unknown worker: ${workerName}. Valid: ${ALL_WORKERS.join(', ')}`,
        },
      };
    }

    const startedAt = Date.now();
    const childLogger = opts.logger.child({ worker: workerName, source: 'admin-trigger' });
    try {
      childLogger.info('Manually triggered via admin endpoint');
      const result = await runner({
        supabase: opts.supabase,
        httpClient: opts.httpClient,
        logger: childLogger,
      });
      const durationMs = Date.now() - startedAt;
      childLogger.info({ result, durationMs }, 'Manual trigger completed');
      return { data: { worker: workerName, result, durationMs } };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const errorMessage = err instanceof Error ? err.message : String(err);
      childLogger.error({ err, durationMs }, 'Manual trigger threw');
      reply.status(500);
      return { error: { code: 'INTERNAL_ERROR', message: errorMessage.slice(0, 1000) } };
    }
  });

  // GET /admin/notify-stats — returns the in-memory counters tracked by
  // `../lib/notify-stats.ts`. Used to verify from outside Railway whether
  // the push-notify hook is armed and firing. Counters reset on restart;
  // the `started_at` field lets the caller tell "restarted 5 min ago" vs
  // "been up for hours with zero activity".
  //
  // Same bearer-token auth as /admin/run-worker (PADELGOD_ADMIN_TOKEN).
  //
  // Example successful response after one live transition:
  //   {
  //     "data": {
  //       "env_configured": true,
  //       "started_at": "2026-04-23T16:20:00.000Z",
  //       "total_attempted": 1,
  //       "total_skipped_env_missing": 0,
  //       "total_skipped_not_scheduled": 0,
  //       "total_fired": 1,
  //       "total_success": 1,
  //       "total_non_ok": 0,
  //       "total_fetch_error": 0,
  //       "last_success": { "at": "…", "matchId": "…" },
  //       "last_non_ok": null,
  //       "last_fetch_error": null,
  //       "last_skip": null
  //     }
  //   }
  app.get('/admin/notify-stats', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${opts.adminToken}`) {
      reply.status(401);
      return { error: { code: 'UNAUTHENTICATED', message: 'Invalid or missing admin token' } };
    }
    return { data: getNotifyStats() };
  });
}

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import type { Logger } from 'pino';
import { getWorkerRunner, ALL_WORKERS } from '../scheduler.js';

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
}

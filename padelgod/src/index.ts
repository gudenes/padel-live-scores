import Fastify from 'fastify';
import { loadEnv } from './lib/env.js';
import { createLogger } from './lib/logger.js';
import { createSupabaseClient } from './lib/supabase.js';
import { registerHealthRoute } from './api/health.js';

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

  registerHealthRoute(app, { startedAt, version: VERSION });

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

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down gracefully');
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Touch supabase to silence unused-var; replaced by real workers in Plan 2+
  void supabase;
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

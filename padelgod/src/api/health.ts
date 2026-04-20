import type { FastifyInstance } from 'fastify';

export interface HealthRouteOptions {
  startedAt: Date;
  version: string;
}

export function registerHealthRoute(app: FastifyInstance, opts: HealthRouteOptions): void {
  app.get('/health', async () => {
    const uptimeMs = Date.now() - opts.startedAt.getTime();
    return {
      data: {
        status: 'ok',
        uptime_seconds: Math.floor(uptimeMs / 1000),
        version: opts.version,
      },
    };
  });
}

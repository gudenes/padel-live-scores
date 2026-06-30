import type { FastifyInstance } from 'fastify';
import { getProxyBandwidthStats } from '../lib/http-client.js';

export interface HealthRouteOptions {
  startedAt: Date;
  version: string;
}

export function registerHealthRoute(app: FastifyInstance, opts: HealthRouteOptions): void {
  app.get('/health', async () => {
    const uptimeMs = Date.now() - opts.startedAt.getTime();
    // proxy_bandwidth counts are cumulative since process start (a Railway
    // redeploy resets them).
    const proxyBandwidth = getProxyBandwidthStats();
    const proxyBandwidthTotalBytes = Object.values(proxyBandwidth).reduce(
      (sum, s) => sum + s.bytes,
      0,
    );
    return {
      data: {
        status: 'ok',
        uptime_seconds: Math.floor(uptimeMs / 1000),
        version: opts.version,
        proxy_bandwidth: proxyBandwidth,
        proxy_bandwidth_total_bytes: proxyBandwidthTotalBytes,
      },
    };
  });
}

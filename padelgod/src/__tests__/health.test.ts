import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerHealthRoute } from '../api/health.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  registerHealthRoute(app, { startedAt: new Date(Date.now() - 60_000), version: '0.1.0' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('GET /health', () => {
  it('returns 200 with status ok and uptime info', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.status).toBe('ok');
    expect(body.data.version).toBe('0.1.0');
    expect(typeof body.data.uptime_seconds).toBe('number');
    expect(body.data.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(body.data.uptime_seconds).toBeGreaterThanOrEqual(60);
    expect(body.data.uptime_seconds).toBeLessThan(120);
  });
});

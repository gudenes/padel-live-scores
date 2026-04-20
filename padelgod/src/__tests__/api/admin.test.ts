import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAdminRoutes } from '../../api/admin.js';
import { createLogger } from '../../lib/logger.js';

const ADMIN_TOKEN = 'test-admin-token-secret';
const logger = createLogger({ level: 'fatal', service: 'admin-test' });

function makeApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  registerAdminRoutes(app, {
    adminToken: ADMIN_TOKEN,
    supabase: {} as any,    // workers won't actually run for invalid/auth tests
    httpClient: {} as any,
    logger,
  });
  return app;
}

describe('POST /admin/run-worker', () => {
  let app: FastifyInstance;

  beforeAll(async () => { app = makeApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it('returns 401 when authorization header is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/run-worker',
      payload: { worker: 'tournament-discovery' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 401 when bearer token is wrong', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/run-worker',
      headers: { authorization: 'Bearer wrong-token' },
      payload: { worker: 'tournament-discovery' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when body is missing worker', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/run-worker',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_INPUT');
  });

  it('returns 400 when worker name is unknown', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/run-worker',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { worker: 'not-a-real-worker' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_INPUT');
    expect(res.json().error.message).toMatch(/not-a-real-worker/);
  });
});

// src/lib/pg.ts
// Shared pg.Pool factory for API routes that need transactional Postgres
// access (e.g. DELETE /api/user/account). We construct a fresh pool per
// call site to avoid a circular import with src/auth.ts, which exports
// Auth.js handlers. In Vercel serverless, each function instance gets its
// own pool anyway, so there is no connection-reuse benefit to sharing.

import { Pool } from 'pg'

function parseDbUrl(url: string) {
  const u = new URL(url)
  return {
    host: u.hostname,
    port: parseInt(u.port || '5432', 10),
    database: u.pathname.slice(1) || 'postgres',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  }
}

export function createPool(): Pool {
  return new Pool({
    ...parseDbUrl(process.env.DATABASE_URL ?? ''),
    max: 1,
    ssl: { rejectUnauthorized: false },
  })
}

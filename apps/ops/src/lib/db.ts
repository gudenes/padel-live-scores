// apps/ops/src/lib/db.ts
// Pg pool against the shared Supabase Postgres.
// Lazy singleton — the Pool is only constructed on first call so module
// imports don't trigger side effects (matters for tests).

import { Pool } from 'pg'

function parseDbUrl(url: string) {
  if (!url) {
    // DATABASE_URL not set (e.g. during next build static analysis). Return
    // placeholder values — the pool won't connect until a request hits it.
    return { host: 'localhost', port: 5432, database: 'postgres', user: 'postgres', password: '' }
  }
  const u = new URL(url)
  return {
    host: u.hostname,
    port: parseInt(u.port || '5432', 10),
    database: u.pathname.slice(1) || 'postgres',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  }
}

let _pool: Pool | null = null

export function pgPool(): Pool {
  if (_pool) return _pool
  _pool = new Pool({
    ...parseDbUrl(process.env.DATABASE_URL ?? ''),
    max: 1, // Vercel serverless: minimal pool per instance
    ssl: { rejectUnauthorized: false },
  })
  return _pool
}

// apps/labs/src/lib/db.ts
// Postgres pool for Auth.js + Supabase clients for data access.
// Mirrors src/auth.ts in nachos: parse DATABASE_URL manually for special chars.

import { Pool } from 'pg'
import { createClient } from '@supabase/supabase-js'

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

let _pool: Pool | null = null

/** Serverless (Vercel): keep 1. Long-lived Railway process: allow more. */
export function pgPoolMax(env: NodeJS.ProcessEnv = process.env): number {
  const override = Number(env.PG_POOL_MAX)
  if (Number.isFinite(override) && override > 0) return override
  return env.RAILWAY_ENVIRONMENT ? 8 : 1
}

export function pgPool(): Pool {
  if (_pool) return _pool
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required')
  }
  _pool = new Pool({
    ...parseDbUrl(process.env.DATABASE_URL),
    max: pgPoolMax(),
    ssl: { rejectUnauthorized: false },
  })
  return _pool
}

export const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key',
  {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  },
)

export function supabaseService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_KEY required')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

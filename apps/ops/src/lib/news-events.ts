// apps/ops/src/lib/news-events.ts
// Fire-and-forget helper for emitting ops_events rows from source-curation routes.
// Swallows errors so callers are never blocked by observability failures.

import { pgPool } from './db'

interface LogOpts {
  status?: 'ok' | 'error' | 'partial'
  errorMessage?: string | null
}

export async function logOpsEvent(
  source: string,
  meta: Record<string, unknown>,
  opts: LogOpts = {},
): Promise<void> {
  try {
    await pgPool().query(
      `INSERT INTO ops_events (source, status, meta, error_message)
       VALUES ($1, $2, $3, $4)`,
      [source, opts.status ?? 'ok', JSON.stringify(meta), opts.errorMessage ?? null],
    )
  } catch (e) {
    console.error(`ops_events insert failed for ${source}:`, e)
  }
}

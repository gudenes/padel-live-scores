// apps/ops/src/lib/news-events.ts
// Fire-and-forget helper for emitting ops_events rows from source-curation routes.
// Swallows errors so callers are never blocked by observability failures.

import { pgPool } from './db'

export async function logOpsEvent(kind: string, metadata: Record<string, unknown>): Promise<void> {
  try {
    await pgPool().query(
      `INSERT INTO ops_events (kind, metadata) VALUES ($1, $2)`,
      [kind, JSON.stringify(metadata)],
    )
  } catch (e) {
    console.error(`ops_events insert failed for ${kind}:`, e)
  }
}

// src/lib/ops-logger.ts
// Lightweight wrapper for logging cron/relay execution to ops_events table.

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

/**
 * Wraps a cron handler function, logging start/end/error to ops_events.
 * The wrapped function should return a meta object with key metrics.
 * If it throws, the error is caught, logged, and re-thrown.
 */
export async function logOpsEvent(
  source: string,
  fn: () => Promise<Record<string, any>>
): Promise<Record<string, any>> {
  const startedAt = new Date()
  let status: 'ok' | 'error' | 'partial' | 'timeout' = 'ok'
  let meta: Record<string, any> = {}
  let errorMessage: string | null = null

  try {
    meta = await fn()
    // Allow the function to signal partial success via meta
    if (meta._status === 'partial') {
      status = 'partial'
      delete meta._status
    }
  } catch (err) {
    status = 'error'
    errorMessage = String(err)
    // Re-throw so the cron handler can still return its error response
    const finishedAt = new Date()
    await supabase.from('ops_events').insert({
      source,
      status,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      meta,
      error_message: errorMessage,
    })
    throw err
  }

  const finishedAt = new Date()
  await supabase.from('ops_events').insert({
    source,
    status,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
    meta,
    error_message: errorMessage,
  })

  return meta
}

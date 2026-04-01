// src/lib/ops-logger.ts
// Lightweight wrapper for logging cron/relay execution to ops_events table.

import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_KEY
    if (!url || !key) {
      throw new Error('[ops-logger] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY')
    }
    _client = createClient(url, key)
  }
  return _client
}

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
    // Log the error row, then re-throw
    const finishedAt = new Date()
    try {
      const { error: dbErr } = await getClient().from('ops_events').insert({
        source,
        status,
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        meta,
        error_message: errorMessage,
      })
      if (dbErr) console.error('[ops-logger] Failed to write error event:', dbErr.message)
    } catch (writeErr) {
      console.error('[ops-logger] Exception writing error event:', writeErr)
    }
    throw err
  }

  const finishedAt = new Date()
  try {
    const { error: dbErr } = await getClient().from('ops_events').insert({
      source,
      status,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      meta,
      error_message: errorMessage,
    })
    if (dbErr) console.error('[ops-logger] Failed to write event:', dbErr.message)
  } catch (writeErr) {
    console.error('[ops-logger] Exception writing event:', writeErr)
  }

  return meta
}

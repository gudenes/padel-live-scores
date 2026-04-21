// src/lib/padelgod-admin-client.ts
// Thin client over the padelgod service's `POST /admin/run-worker` endpoint.
//
// The parent Next.js app uses this to trigger specific padelgod workers
// on-demand for one-off flows (e.g. bringing up a new FIP tournament that
// shouldn't wait for the next cron tick). Failures don't throw — each call
// returns a discriminated-union result so callers can surface per-worker
// outcomes in an ops UI response without aborting downstream work.
//
// Deploy config (on the Next.js side, server-only env vars):
//   PADELGOD_URL         — e.g. https://padelgod.up.railway.app
//   PADELGOD_ADMIN_TOKEN — bearer token that matches padelgod's env

export type WorkerName =
  | 'tournament-discovery'
  | 'widget-code-lookup'
  | 'player-rankings'
  | 'player-profile'
  | 'entry-list-fetcher'
  | 'draw-fetcher'
  | 'oop-fetcher'
  | 'results-fetcher'
  | 'static-reconciler'
  | 'match-stats-fetcher'
  | 'live-poller-manager'
  | 'shadow-diff-finalizer'
  | 'shadow-diff-live'

export interface PadelgodAdminOptions {
  /** e.g. "https://padelgod.up.railway.app" — trailing slash tolerated. */
  baseUrl: string
  /** Bearer token — must match `PADELGOD_ADMIN_TOKEN` on the padelgod side. */
  adminToken: string
  /** Inject a custom fetch for testing. Defaults to the global `fetch`. */
  fetchFn?: typeof fetch
}

export type WorkerResult =
  | {
      ok: true
      worker: WorkerName
      /** Whatever the worker's `runner()` returned — payload shape varies per worker. */
      result: unknown
      /** Duration the padelgod side reports (wall-clock of the worker run). */
      durationMs: number
    }
  | {
      ok: false
      worker: WorkerName
      /** HTTP status from padelgod (0 if the request never got a response). */
      status: number
      /** Human-readable error — from padelgod's `error.message` or the fetch throw. */
      error: string
    }

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

/**
 * Trigger a single padelgod worker. Never throws for expected error paths —
 * returns a typed result. Thrown errors (e.g. DNS failures) are caught and
 * surfaced as `ok: false`.
 */
export async function triggerPadelgodWorker(
  worker: WorkerName,
  opts: PadelgodAdminOptions
): Promise<WorkerResult> {
  const fetchFn = opts.fetchFn ?? fetch
  const url = `${stripTrailingSlash(opts.baseUrl)}/admin/run-worker`

  let res: Response
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${opts.adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ worker }),
    })
  } catch (err) {
    return {
      ok: false,
      worker,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  // Parse body once — padelgod always responds with JSON, but guard against
  // unexpected proxies/load balancers returning HTML on error paths.
  let body: unknown
  try {
    body = await res.json()
  } catch {
    return {
      ok: false,
      worker,
      status: res.status,
      error: `non-JSON response from padelgod (status ${res.status})`,
    }
  }

  if (!res.ok) {
    const errorMessage =
      (body as { error?: { message?: string } } | null)?.error?.message ??
      `HTTP ${res.status}`
    return { ok: false, worker, status: res.status, error: errorMessage }
  }

  // Success envelope: { data: { worker, result, durationMs } }
  const data = (body as { data?: { worker?: string; result?: unknown; durationMs?: number } } | null)?.data
  return {
    ok: true,
    worker,
    result: data?.result ?? null,
    durationMs: typeof data?.durationMs === 'number' ? data.durationMs : 0,
  }
}

/**
 * Trigger multiple padelgod workers back-to-back.
 *
 * Sequential rather than parallel because the workers share DB contention
 * (they all read/write the same snapshot tables and the reconciler depends
 * on the fetchers having run first). If one fails, subsequent workers still
 * run — the caller gets one result per input worker, in order.
 */
export async function triggerPadelgodWorkersSequential(
  workers: WorkerName[],
  opts: PadelgodAdminOptions
): Promise<WorkerResult[]> {
  const results: WorkerResult[] = []
  for (const w of workers) {
    results.push(await triggerPadelgodWorker(w, opts))
  }
  return results
}

/**
 * Read padelgod base URL + admin token from the Next.js server's env. Returns
 * null when either is missing — ops flows treat that as "padelgod triggering
 * not configured; fall back to waiting for the next cron tick."
 */
export function getPadelgodAdminOptionsFromEnv(): Omit<PadelgodAdminOptions, 'fetchFn'> | null {
  const baseUrl = process.env.PADELGOD_URL
  const adminToken = process.env.PADELGOD_ADMIN_TOKEN
  if (!baseUrl || !adminToken) return null
  return { baseUrl, adminToken }
}

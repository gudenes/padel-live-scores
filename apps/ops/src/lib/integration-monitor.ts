export type Signal = 'healthy' | 'warning' | 'error' | 'unknown'
export interface FeedHealth {
  id: string; name: string; status: Signal; message: string
  runs: number | null; failures: number | null; lastRun: string | null
}
export interface ProxyRoute {
  id: string; status: Signal; requests: number; failures: number; bytes: number
  lastAttempt: string | null; lastSuccess: string | null; cooldownUntil: string | null
}
export interface IntegrationMonitor {
  fetchedAt: string
  runtime: { status: Signal; message: string; uptimeSeconds: number | null; telemetryAvailable: boolean }
  routes: ProxyRoute[]
  categories: { name: string; requests: number; bytes: number }[]
  budget: { usedBytes: number; limitBytes: number; day: string; status: Signal } | null
  feeds: FeedHealth[]
}
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null
export function budgetSignal(used: number, limit: number): Signal {
  if (limit === 0) return 'unknown'
  return used >= limit ? 'error' : used >= limit * .8 ? 'warning' : 'healthy'
}
export function feedHealth(id: string, name: string, runs: number | null, failures: number | null, lastRun: string | null, lastFailed: boolean, now: number): FeedHealth {
  if (runs === null || failures === null) return { id, name, runs: null, failures: null, lastRun: null, status: 'unknown', message: 'Ingestion history unavailable' }
  const stale = !lastRun || !Number.isFinite(Date.parse(lastRun)) || now - Date.parse(lastRun) > 2 * 60 * 60 * 1000
  const status: Signal = runs === 0 || stale ? 'unknown' : lastFailed || failures === runs ? 'error' : failures / runs >= .05 ? 'warning' : 'healthy'
  return { id, name, runs, failures, lastRun, status, message: stale || runs === 0 ? 'No recent activity — check the schedule' : lastFailed ? 'Latest ingestion failed' : failures / runs >= .05 ? 'Elevated failures in the last 24 hours' : 'Recent ingestion is succeeding' }
}
/** Explicit allowlist: never send upstream URLs, headers, errors or credentials to the browser. */
export function monitorSnapshot(payload: unknown, feeds: FeedHealth[], now = Date.now()): IntegrationMonitor {
  const data = object(object(payload).data)
  const reachable = data.status === 'ok'
  const routing = object(data.proxy_routing)
  const policy = object(routing.policy)
  const statuses = object(routing.routes)
  const counters = object(data.proxy_routes)
  const telemetryAvailable = reachable && Object.hasOwn(data, 'proxy_routes')
  const routes = Object.entries(counters).filter(([key]) => /^(fixed_\d+|residential)$/.test(key)).map(([id, value]): ProxyRoute => {
    const count = object(value); const state = object(statuses[id]); const lastAttempt = date(state.lastAttemptAt)
    const recent = lastAttempt !== null && now - Date.parse(lastAttempt) <= 2 * 60 * 60 * 1000
    return { id, status: !recent || !reachable ? 'unknown' : state.lastFailed === true ? 'error' : 'healthy', requests: number(count.requests) ?? 0, failures: number(count.failures) ?? 0, bytes: number(count.bytes) ?? 0, lastAttempt, lastSuccess: date(state.lastSuccessAt), cooldownUntil: date(state.cooldownUntil) }
  })
  for (const id of Object.keys(statuses).filter(key => /^(fixed_\d+|residential)$/.test(key))) {
    if (!routes.some(route => route.id === id)) routes.push({ id, status: 'unknown', requests: 0, failures: 0, bytes: 0, lastAttempt: null, lastSuccess: null, cooldownUntil: null })
  }
  const usage = object(data.residential_usage)
  const used = number(usage.estimated_body_bytes), limit = number(policy.residential_daily_byte_limit)
  const day = typeof usage.utc_day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(usage.utc_day) ? usage.utc_day : null
  const budget = reachable && used !== null && limit !== null && day === new Date(now).toISOString().slice(0, 10) && policy.residential_configured === true
    ? { usedBytes: used, limitBytes: limit, day, status: budgetSignal(used, limit) } : null
  const knownCategories = ['rest_ranking','rest_player_search','rest_discover','rest_other','admin_ajax_draw','event_page','player_profile','other_fip']
  const categories = Object.entries(object(data.proxy_bandwidth)).filter(([key]) => knownCategories.includes(key)).map(([name, value]) => ({ name, requests: number(object(value).requests) ?? 0, bytes: number(object(value).bytes) ?? 0 })).sort((a,b) => b.bytes-a.bytes)
  return {
    fetchedAt: new Date(now).toISOString(),
    runtime: { status: reachable ? 'healthy' : 'error', message: !reachable ? 'Worker health endpoint unavailable' : !telemetryAvailable ? 'Worker online; proxy telemetry awaits rollout' : 'Worker online', uptimeSeconds: number(data.uptime_seconds), telemetryAvailable },
    routes, categories, budget, feeds,
  }
}
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`
  return `${Math.round(bytes)} B`
}

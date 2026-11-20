import { AxiosHeaders, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

export interface FipProxyOptions {
  fixedProxyUrls: string[];
  residentialProxyUrl?: string;
  pattern: RegExp;
  cooldownMs?: number;
  residentialDailyByteLimit?: number;
}
interface RoutedConfig extends InternalAxiosRequestConfig {
  fipRoute?: string;
  fipAttemptedRoutes?: string[];
}
interface RouteStats { requests: number; failures: number; bytes: number }
const stats = new Map<string, RouteStats>();
let residentialDay = '';
let residentialBytes = 0;
function dailyResidentialBytes(): number {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== residentialDay) { residentialDay = day; residentialBytes = 0; }
  return residentialBytes;
}
export function getResidentialUsage() {
  return { utc_day: new Date().toISOString().slice(0, 10), estimated_body_bytes: dailyResidentialBytes() };
}
export function getProxyRouteStats(): Record<string, RouteStats> {
  return Object.fromEntries([...stats].map(([key, value]) => [key, { ...value }]));
}
export function resetProxyRouteStats(): void { stats.clear(); residentialDay = ''; residentialBytes = 0; }

function isRead(config: RoutedConfig): boolean {
  if (['get', 'head'].includes((config.method ?? 'get').toLowerCase())) return true;
  if (config.method?.toLowerCase() !== 'post' || !config.url?.includes('/wp-admin/admin-ajax.php')) return false;
  const action = new URLSearchParams(typeof config.data === 'string' ? config.data : '').get('action');
  return action === 'load_entrylist_tab' || action === 'handle_ajax_request';
}
function retryable(error: any): boolean {
  if (error.code === 'ERR_CANCELED') return false;
  const status = error.response?.status;
  const body = error.response?.data;
  // WordPress nonce failures need a fresh nonce, not a different proxy.
  if (String(body ?? '').trim() === '-1' || String(body ?? '').trim() === '0') return false;
  return status === undefined || [403, 407, 429, 502, 503, 504].includes(status);
}

/** Fixed routes first, one attempt per route; residential is the last resort.
 * A failed route cools down across requests, preventing every worker from
 * repeatedly hitting a blocked IP. No credentials are included in metrics.
 */
export function installFipProxyRouting(client: AxiosInstance, opts: FipProxyOptions): void {
  const routes = opts.fixedProxyUrls.map((url, i) => ({
    name: `fixed_${i + 1}`, agent: new HttpsProxyAgent(url), retryAt: 0,
  }));
  if (opts.residentialProxyUrl) routes.push({
    name: 'residential', agent: new HttpsProxyAgent(opts.residentialProxyUrl), retryAt: 0,
  });
  if (!routes.length) return;
  const byteLimit = opts.residentialDailyByteLimit ?? 75_000_000;
  if (!Number.isFinite(byteLimit) || byteLimit < 0) throw new Error('Invalid residential daily byte limit');
  const allowed = (route: typeof routes[number]) => route.name !== 'residential' || dailyResidentialBytes() < byteLimit;
  const matches = (url = '') => { opts.pattern.lastIndex = 0; return opts.pattern.test(url); };
  client.interceptors.request.use((config: RoutedConfig) => {
    if (!matches(config.url)) return config;
    const attempted = config.fipAttemptedRoutes ?? [];
    const available = routes.filter(r => !attempted.includes(r.name) && allowed(r));
    const route = available.find(r => r.retryAt <= Date.now());
    // If all routes are cooling down, allow one fixed probe for this new
    // request. Never turn residential cooldown into an unbounded retry loop.
    const selected = route ?? (attempted.length === 0 ? available[0] : undefined);
    if (!selected) throw new Error('FIP proxy routes exhausted');
    config.fipRoute = selected.name;
    config.fipAttemptedRoutes = [...attempted, selected.name];
    config.httpsAgent = selected.agent;
    config.httpAgent = selected.agent;
    config.proxy = false;
    return config;
  });
  const record = (response: any, failed: boolean, config: RoutedConfig) => {
    if (!config?.fipRoute) return;
    const previous = stats.get(config.fipRoute) ?? { requests: 0, failures: 0, bytes: 0 };
    const body = response?.data;
    const length = Number(response?.headers?.['content-length']);
    const bytes = !response || response?.status === 304 ? 0 : Number.isFinite(length) && length >= 0 ? length
      : Buffer.isBuffer(body) ? body.length : body instanceof ArrayBuffer ? body.byteLength
        : Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body ?? ''));
    if (config.fipRoute === 'residential') { dailyResidentialBytes(); residentialBytes += bytes; }
    stats.set(config.fipRoute, { requests: previous.requests + 1, failures: previous.failures + Number(failed), bytes: previous.bytes + bytes });
  };
  client.interceptors.response.use(response => {
    record(response, false, response.config);
    return response;
  }, async error => {
    const config = error.config as RoutedConfig | undefined;
    if (!config?.fipRoute) throw error;
    record(error.response, true, config);
    if (!isRead(config) || !retryable(error)) throw error;
    const route = routes.find(r => r.name === config.fipRoute)!;
    const retryAfter = Number(error.response?.headers?.['retry-after']);
    route.retryAt = Date.now() + Math.max(opts.cooldownMs ?? 300_000, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0);
    if (!routes.some(r => !config.fipAttemptedRoutes?.includes(r.name) && r.retryAt <= Date.now() && allowed(r))) throw error;
    return client.request(config);
  });
}

/** These are public, read-only FIP APIs; preserve caller-specific event context. */
export function installFipRequestHeaders(client: AxiosInstance): void {
  client.interceptors.request.use(config => {
    let url: URL;
    try { url = new URL(config.url ?? ''); } catch { return config; }
    if (url.hostname !== 'padelfip.com' && !url.hostname.endsWith('.padelfip.com')) return config;
    if (!url.pathname.includes('/wp-json/') && url.pathname !== '/wp-admin/admin-ajax.php') return config;
    const headers = AxiosHeaders.from(config.headers);
    if (!headers.has('Referer')) headers.set('Referer', `${url.origin}/es/fip-rankings/`);
    if (!headers.has('Origin')) headers.set('Origin', url.origin);
    if (!headers.has('X-Requested-With')) headers.set('X-Requested-With', 'XMLHttpRequest');
    config.headers = headers;
    return config;
  });
}

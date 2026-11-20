import axios, { type AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import { installFipProxyRouting, installFipRequestHeaders } from './fip-proxy-routing.js';

export interface HttpClientOptions {
  userAgent: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Legacy single fixed proxy override. Empty string explicitly selects direct.
   * Otherwise use FIP_FIXED_PROXY_URLS, falling back to FIP_PROXY_URL.
   * Non-FIP hosts remain direct unless proxyHostPattern is explicitly supplied.
   */
  proxyUrl?: string;
  proxyHostPattern?: RegExp;
  /** Ordered fixed pool. JSON array in FIP_FIXED_PROXY_URLS; legacy URL remains supported. */
  fixedProxyUrls?: string[];
  /** Used only after healthy fixed routes fail. */
  residentialProxyUrl?: string;
  residentialDailyByteLimit?: number;
}

/**
 * Per-category byte counter for proxied FIP traffic. FIP IP-blocks Railway, so
 * all padelfip.com traffic flows through a METERED residential proxy — this
 * estimates response bytes per category (Content-Length when present, otherwise
 * decoded body size) so ops can read /health and
 * right-size a proxy plan. Counts are cumulative since process start (a Railway
 * redeploy resets them). Module-level so every client created in this process
 * shares one accumulator.
 */
const proxyBandwidth = new Map<string, { requests: number; bytes: number }>();

/** Map a proxied FIP URL to a coarse bandwidth category. */
function fipBandwidthCategory(url: string): string {
  if (/\/wp-json\/fip\/v1\/(?:ranking|race)\//.test(url)) return 'rest_ranking';
  if (/\/wp-json\/fip\/v1\/player\/search/.test(url)) return 'rest_player_search';
  if (/\/wp-json\/wp\/v2\//.test(url)) return 'rest_discover';
  if (/\/wp-json\//.test(url)) return 'rest_other';
  if (/\/wp-admin\/admin-ajax/.test(url)) return 'admin_ajax_draw';
  if (/\/(?:events|eventos)\//.test(url)) return 'event_page';
  if (/\/player\//.test(url)) return 'player_profile';
  return 'other_fip';
}

/** Snapshot of the proxy bandwidth accumulator as a plain object, bytes desc. */
export function getProxyBandwidthStats(): Record<
  string,
  { requests: number; bytes: number }
> {
  const out: Record<string, { requests: number; bytes: number }> = {};
  for (const [category, stat] of [...proxyBandwidth.entries()].sort(
    (a, b) => b[1].bytes - a[1].bytes,
  )) {
    out[category] = { requests: stat.requests, bytes: stat.bytes };
  }
  return out;
}

/** Test-only: clear the bandwidth accumulator. */
export function __resetProxyBandwidthStats(): void {
  proxyBandwidth.clear();
}

export function createHttpClient(opts: HttpClientOptions): AxiosInstance {
  if (!opts.userAgent) throw new Error('userAgent is required');
  const client = axios.create({
    timeout: opts.timeoutMs ?? 30_000,
    headers: {
      'User-Agent': opts.userAgent,
      Accept: 'text/html,application/xhtml+xml,application/json,*/*',
    },
    // Treat 4xx/5xx as exceptions so retries trigger
    validateStatus: (status) => status >= 200 && status < 400,
  });
  installFipRequestHeaders(client);
  const fixedProxyUrls: string[] = opts.fixedProxyUrls ?? (opts.proxyUrl !== undefined
    ? (opts.proxyUrl ? [opts.proxyUrl] : [])
    : process.env.FIP_FIXED_PROXY_URLS ? JSON.parse(process.env.FIP_FIXED_PROXY_URLS)
      : process.env.FIP_PROXY_URL ? [process.env.FIP_PROXY_URL] : []);
  if (!Array.isArray(fixedProxyUrls) || fixedProxyUrls.some(url => typeof url !== 'string')) {
    throw new Error('FIP_FIXED_PROXY_URLS must be a JSON array of proxy URLs');
  }
  const residentialProxyUrl = opts.residentialProxyUrl ?? (opts.proxyUrl === undefined ? process.env.FIP_RESIDENTIAL_PROXY_URL : undefined);
  const pattern = opts.proxyHostPattern ?? /^https?:\/\/(?:[a-z0-9-]+\.)*padelfip\.com\//i;
  if (fixedProxyUrls.length || residentialProxyUrl) {
    // Side-effect-only bandwidth counter for proxied (padelfip.com) responses.
    // MUST never throw and MUST never alter the response/data — wrapped in
    // try/catch so a counting bug can't break a real request.
    const countBandwidth = (response: any): void => {
      try {
        const url = response?.config?.url ?? '';
        if (!pattern.test(url)) return; // only count proxied/FIP traffic
        const category = fipBandwidthCategory(url);
        const cl = Number(response?.headers?.['content-length']);
        const bytes = response?.status === 304 ? 0 :
          Number.isFinite(cl) && cl >= 0
            ? cl
            : Buffer.isBuffer(response?.data) ? response.data.length
            : response?.data instanceof ArrayBuffer ? response.data.byteLength
            : Buffer.byteLength(
                typeof response?.data === 'string'
                  ? response.data
                  : JSON.stringify(response?.data ?? ''),
              );
        const prev = proxyBandwidth.get(category) ?? { requests: 0, bytes: 0 };
        proxyBandwidth.set(category, {
          requests: prev.requests + 1,
          bytes: prev.bytes + bytes,
        });
      } catch {
        // never let counting break a request
      }
    };
    client.interceptors.response.use(
      (response) => {
        countBandwidth(response);
        return response;
      },
      (error) => {
        // Failed responses (e.g. the rare 403) carry a response too — count it,
        // but still propagate the error.
        if (error?.response) countBandwidth(error.response);
        return Promise.reject(error);
      },
    );
  }

  installFipProxyRouting(client, {
    fixedProxyUrls, residentialProxyUrl, pattern,
    residentialDailyByteLimit: opts.residentialDailyByteLimit ?? Number(process.env.FIP_RESIDENTIAL_DAILY_BYTE_LIMIT ?? 75_000_000),
  });
  // Route failover owns FIP retries. Keep normal axios retries for other providers.
  axiosRetry(client, {
    retries: opts.maxRetries ?? 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: err => !(err.config as { fipRoute?: string } | undefined)?.fipRoute && (
      axiosRetry.isNetworkOrIdempotentRequestError(err) ||
      (err.response?.status !== undefined && err.response.status >= 500)
    ),
  });
  return client;
}

export const PADELGOD_USER_AGENT =
  process.env.PADELGOD_USER_AGENT ??
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

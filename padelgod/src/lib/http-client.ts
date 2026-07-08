import axios, { type AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import { HttpsProxyAgent } from 'https-proxy-agent';

export interface HttpClientOptions {
  userAgent: string;
  timeoutMs?: number;
  maxRetries?: number;
  /**
   * If set, requests whose URL matches `proxyHostPattern` (default: any
   * `padelfip.com` host) are sent through this HTTP(S) proxy. FIP's Cloudflare
   * IP-blocks Railway's datacenter egress across the WHOLE padelfip.com domain
   * (verified 2026-06-30: /wp-json rankings+discover AND the /es/events/ +
   * /wp-admin/admin-ajax.php draw endpoints AND /player profile pages all 403),
   * so we must route every padelfip.com request through a residential proxy.
   * Non-FIP hosts (e.g. matchscorerlive.com / Crionet) stay direct — they are
   * not blocked and shouldn't burn proxy bandwidth. All FIP callers use
   * absolute URLs, so a host match on config.url is sufficient.
   * Defaults to `process.env.FIP_PROXY_URL` so ops can set it on Railway with
   * no redeploy of this signature. Unset = direct connection for everything
   * (today's behavior). See docs/superpowers/plans/2026-06-30-fip-rest-egress-proxy.md.
   */
  proxyUrl?: string;
  proxyHostPattern?: RegExp;
}

/**
 * Per-category byte counter for proxied FIP traffic. FIP IP-blocks Railway, so
 * all padelfip.com traffic flows through a METERED residential proxy — this
 * accumulates the on-wire bytes per coarse category so ops can read /health and
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
  axiosRetry(client, {
    retries: opts.maxRetries ?? 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (err) =>
      axiosRetry.isNetworkOrIdempotentRequestError(err) ||
      (err.response?.status !== undefined && err.response.status >= 500),
  });

  const proxyUrl = opts.proxyUrl ?? process.env.FIP_PROXY_URL;
  if (proxyUrl) {
    const agent = new HttpsProxyAgent(proxyUrl);
    // Match any padelfip.com host (www. or bare), in the URL's host position.
    const pattern = opts.proxyHostPattern ?? /\/\/(?:[a-z0-9-]+\.)*padelfip\.com\//i;
    client.interceptors.request.use((config) => {
      if (pattern.test(config.url ?? '')) {
        // FIP is https-only today, but set both agents so a plain-http target
        // can't silently bypass the proxy. HttpsProxyAgent tunnels both.
        config.httpsAgent = agent;
        config.httpAgent = agent;
        // Disable axios' built-in env-proxy handling so our agent is used.
        config.proxy = false;
      }
      return config;
    });

    // Side-effect-only bandwidth counter for proxied (padelfip.com) responses.
    // MUST never throw and MUST never alter the response/data — wrapped in
    // try/catch so a counting bug can't break a real request.
    const countBandwidth = (response: any): void => {
      try {
        const url = response?.config?.url ?? '';
        if (!pattern.test(url)) return; // only count proxied/FIP traffic
        const category = fipBandwidthCategory(url);
        const cl = Number(response?.headers?.['content-length']);
        const bytes =
          Number.isFinite(cl) && cl >= 0
            ? cl
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

  return client;
}

export const PADELGOD_USER_AGENT =
  process.env.PADELGOD_USER_AGENT ??
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

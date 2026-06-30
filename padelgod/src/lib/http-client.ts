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
  }

  return client;
}

export const PADELGOD_USER_AGENT =
  process.env.PADELGOD_USER_AGENT ??
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

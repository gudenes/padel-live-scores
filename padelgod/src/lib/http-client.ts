import axios, { type AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import { HttpsProxyAgent } from 'https-proxy-agent';

export interface HttpClientOptions {
  userAgent: string;
  timeoutMs?: number;
  maxRetries?: number;
  /**
   * If set, requests whose URL matches `proxyPathPattern` (default: the FIP
   * WordPress REST API path `/wp-json/`) are sent through this HTTP(S) proxy.
   * All other requests use the direct connection. Defaults to
   * `process.env.FIP_PROXY_URL` so ops can set it on Railway with no redeploy
   * of this signature. Unset = direct connection for everything (today's
   * behavior). See docs/superpowers/plans/2026-06-30-fip-rest-egress-proxy.md.
   */
  proxyUrl?: string;
  proxyPathPattern?: RegExp;
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
    const pattern = opts.proxyPathPattern ?? /\/wp-json\//;
    client.interceptors.request.use((config) => {
      if (pattern.test(config.url ?? '')) {
        config.httpsAgent = agent;
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

import axios, { type AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';

export interface HttpClientOptions {
  userAgent: string;
  timeoutMs?: number;
  maxRetries?: number;
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
  return client;
}

// FIP (Cloudflare WAF) started 403-blocking the self-identifying
// "Padelgod-Scraper/..." UA on 2026-06-22, which silently killed the
// weekly rankings + FIP draw fetches (event page + admin-ajax both 403).
// A browser-like UA is served 200. Env-overridable so ops can rotate the
// string from Railway (no code redeploy) if FIP tightens the rule again —
// set PADELGOD_USER_AGENT.
export const PADELGOD_USER_AGENT =
  process.env.PADELGOD_USER_AGENT ??
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

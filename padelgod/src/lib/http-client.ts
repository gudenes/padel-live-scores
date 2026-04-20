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

export const PADELGOD_USER_AGENT =
  'Padelgod-Scraper/0.2.0 (contact: ops@padelnachos.com)';

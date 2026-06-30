import { describe, it, expect, vi } from 'vitest';
import { createHttpClient } from '../lib/http-client.js';
import { HttpsProxyAgent } from 'https-proxy-agent';

describe('createHttpClient', () => {
  it('returns an axios instance with the configured User-Agent', () => {
    const client = createHttpClient({ userAgent: 'Padelgod-Test/1.0' });
    expect(client.defaults.headers['User-Agent']).toBe('Padelgod-Test/1.0');
  });

  it('honors a custom timeout', () => {
    const client = createHttpClient({ userAgent: 'X', timeoutMs: 15000 });
    expect(client.defaults.timeout).toBe(15000);
  });

  it('throws when userAgent is empty', () => {
    expect(() => createHttpClient({ userAgent: '' })).toThrow(/userAgent/);
  });
});

describe('createHttpClient FIP REST proxy routing', () => {
  const PROXY = 'http://user:pass@proxy.example:8080';

  function requestInterceptors(client: ReturnType<typeof createHttpClient>) {
    // axios stores registered interceptors here; typed as any for test access
    return (client.interceptors.request as any).handlers.filter(Boolean);
  }

  // axios-retry registers its own request interceptor, so we can't rely on a
  // fixed handler count/index. The proxy interceptor is identified by behavior:
  // it's the one that sets httpsAgent for a /wp-json/ URL.
  function proxyInterceptor(client: ReturnType<typeof createHttpClient>) {
    return requestInterceptors(client).find((h: any) => {
      try {
        const cfg = h.fulfilled({
          url: 'https://www.padelfip.com/es/wp-json/probe/',
        });
        return cfg?.httpsAgent instanceof HttpsProxyAgent;
      } catch {
        return false;
      }
    });
  }

  it('adds no proxy interceptor when no proxyUrl is configured', () => {
    const client = createHttpClient({ userAgent: 'X' });
    expect(proxyInterceptor(client)).toBeUndefined();
  });

  it('routes /wp-json/ URLs through the proxy agent when proxyUrl is set', () => {
    const client = createHttpClient({ userAgent: 'X', proxyUrl: PROXY });
    const fulfilled = proxyInterceptor(client).fulfilled;
    const cfg = fulfilled({
      url: 'https://www.padelfip.com/es/wp-json/fip/v1/ranking/load-more/?gender=male',
    });
    expect(cfg.httpsAgent).toBeInstanceOf(HttpsProxyAgent);
    expect(cfg.proxy).toBe(false);
  });

  it('leaves front-end/admin-ajax URLs on the direct connection', () => {
    const client = createHttpClient({ userAgent: 'X', proxyUrl: PROXY });
    const fulfilled = proxyInterceptor(client).fulfilled;
    const cfg = fulfilled({
      url: 'https://www.padelfip.com/es/events/foo-p2-2026/?tab=Cuadros',
    });
    expect(cfg.httpsAgent).toBeUndefined();
  });
});

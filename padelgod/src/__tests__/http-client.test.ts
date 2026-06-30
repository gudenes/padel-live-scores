import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createHttpClient,
  getProxyBandwidthStats,
  __resetProxyBandwidthStats,
} from '../lib/http-client.js';
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

describe('createHttpClient FIP proxy routing', () => {
  const PROXY = 'http://user:pass@proxy.example:8080';

  function requestInterceptors(client: ReturnType<typeof createHttpClient>) {
    // axios stores registered interceptors here; typed as any for test access
    return (client.interceptors.request as any).handlers.filter(Boolean);
  }

  // axios-retry registers its own request interceptor, so we can't rely on a
  // fixed handler count/index. The proxy interceptor is identified by behavior:
  // it's the one that sets httpsAgent for a padelfip.com URL.
  function proxyInterceptor(client: ReturnType<typeof createHttpClient>) {
    return requestInterceptors(client).find((h: any) => {
      try {
        const cfg = h.fulfilled({ url: 'https://www.padelfip.com/probe/' });
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

  // FIP's Cloudflare IP-blocks Railway across the whole padelfip.com domain, so
  // EVERY padelfip.com path must route through the proxy — REST, the event
  // pages, and the admin-ajax draw endpoint alike.
  it.each([
    ['REST/wp-json', 'https://www.padelfip.com/es/wp-json/fip/v1/ranking/load-more/?gender=male'],
    ['event page', 'https://www.padelfip.com/es/events/bordeaux-p2-2026/?tab=Cuadros'],
    ['eventos (redirect target)', 'https://www.padelfip.com/es/eventos/bordeaux-p2-2026/'],
    ['admin-ajax draw', 'https://www.padelfip.com/wp-admin/admin-ajax.php'],
    ['player profile', 'https://www.padelfip.com/es/player/arturo-coello/'],
  ])('routes padelfip.com %s through the proxy agent when proxyUrl is set', (_label, url) => {
    const client = createHttpClient({ userAgent: 'X', proxyUrl: PROXY });
    const cfg = proxyInterceptor(client).fulfilled({ url });
    expect(cfg.httpsAgent).toBeInstanceOf(HttpsProxyAgent);
    expect(cfg.proxy).toBe(false);
  });

  it('leaves non-FIP hosts (e.g. matchscorerlive/Crionet) on the direct connection', () => {
    const client = createHttpClient({ userAgent: 'X', proxyUrl: PROXY });
    const fulfilled = proxyInterceptor(client).fulfilled;
    for (const url of [
      'https://www.matchscorerlive.com/draw/12345',
      'https://api.ipify.org/?format=json',
    ]) {
      const cfg = fulfilled({ url });
      expect(cfg.httpsAgent).toBeUndefined();
    }
  });
});

describe('proxy bandwidth byte-counter', () => {
  const PROXY = 'http://user:pass@proxy.example:8080';

  function responseInterceptors(client: ReturnType<typeof createHttpClient>) {
    return (client.interceptors.response as any).handlers.filter(Boolean);
  }

  // The bandwidth response interceptor is the fulfilled handler that records a
  // padelfip.com response into the accumulator without altering it. It's the
  // only response interceptor we register, so behavior-probe it: a padelfip URL
  // must bump the accumulator. The probe leaves stats reset afterwards.
  function bandwidthInterceptor(client: ReturnType<typeof createHttpClient>) {
    return responseInterceptors(client).find((h: any) => {
      try {
        __resetProxyBandwidthStats();
        const probe = {
          config: { url: 'https://www.padelfip.com/probe/' },
          headers: { 'content-length': '7' },
          data: '',
        };
        const out = h.fulfilled(probe);
        const recorded = getProxyBandwidthStats().other_fip?.bytes === 7;
        __resetProxyBandwidthStats();
        return out === probe && recorded;
      } catch {
        return false;
      }
    });
  }

  // Resolve the interceptor once per test and reset, then return a driver that
  // doesn't re-probe — so the probe's reset never interleaves with accumulation.
  function recorder(client: ReturnType<typeof createHttpClient>) {
    const interceptor = bandwidthInterceptor(client);
    __resetProxyBandwidthStats();
    return (response: any) => interceptor!.fulfilled(response);
  }

  beforeEach(() => {
    __resetProxyBandwidthStats();
  });

  it('adds no response bandwidth interceptor when no proxyUrl is configured', () => {
    const client = createHttpClient({ userAgent: 'X' });
    expect(bandwidthInterceptor(client)).toBeUndefined();
  });

  it('counts an event-page response under event_page using content-length', () => {
    const client = createHttpClient({ userAgent: 'X', proxyUrl: PROXY });
    const record = recorder(client);
    record({
      config: { url: 'https://www.padelfip.com/es/events/bordeaux-p2-2026/?tab=Cuadros' },
      headers: { 'content-length': '296745' },
      data: '<html></html>',
    });
    const stats = getProxyBandwidthStats();
    expect(stats.event_page).toEqual({ requests: 1, bytes: 296745 });
  });

  it('counts admin-ajax under admin_ajax_draw and ranking under rest_ranking', () => {
    const client = createHttpClient({ userAgent: 'X', proxyUrl: PROXY });
    const record = recorder(client);
    record({
      config: { url: 'https://www.padelfip.com/wp-admin/admin-ajax.php' },
      headers: { 'content-length': '100' },
      data: '',
    });
    record({
      config: { url: 'https://www.padelfip.com/es/wp-json/fip/v1/ranking/load-more/?gender=male' },
      headers: { 'content-length': '200' },
      data: '',
    });
    const stats = getProxyBandwidthStats();
    expect(stats.admin_ajax_draw).toEqual({ requests: 1, bytes: 100 });
    expect(stats.rest_ranking).toEqual({ requests: 1, bytes: 200 });
  });

  it('maps each URL shape to its coarse category', () => {
    const client = createHttpClient({ userAgent: 'X', proxyUrl: PROXY });
    const record = recorder(client);
    const cases: Array<[string, string]> = [
      ['https://www.padelfip.com/es/wp-json/fip/v1/ranking/load-more/', 'rest_ranking'],
      ['https://www.padelfip.com/es/wp-json/fip/v1/race/load-more/', 'rest_ranking'],
      ['https://www.padelfip.com/wp-json/fip/v1/player/search?q=coello', 'rest_player_search'],
      ['https://www.padelfip.com/wp-json/wp/v2/posts', 'rest_discover'],
      ['https://www.padelfip.com/wp-json/fip/v1/other', 'rest_other'],
      ['https://www.padelfip.com/wp-admin/admin-ajax.php', 'admin_ajax_draw'],
      ['https://www.padelfip.com/es/events/foo/', 'event_page'],
      ['https://www.padelfip.com/es/eventos/foo/', 'event_page'],
      ['https://www.padelfip.com/es/player/arturo-coello/', 'player_profile'],
      ['https://www.padelfip.com/es/random/', 'other_fip'],
    ];
    for (const [url, category] of cases) {
      record({ config: { url }, headers: { 'content-length': '5' }, data: '' });
      expect(Object.keys(getProxyBandwidthStats())).toContain(category);
    }
  });

  it('does NOT count non-FIP responses (matchscorerlive)', () => {
    const client = createHttpClient({ userAgent: 'X', proxyUrl: PROXY });
    const record = recorder(client);
    record({
      config: { url: 'https://www.matchscorerlive.com/draw/12345' },
      headers: { 'content-length': '5000' },
      data: 'x'.repeat(5000),
    });
    expect(getProxyBandwidthStats()).toEqual({});
  });

  it('falls back to body byte length when content-length is missing', () => {
    const client = createHttpClient({ userAgent: 'X', proxyUrl: PROXY });
    const record = recorder(client);
    const body = { hello: 'wörld' }; // multi-byte to prove Buffer.byteLength is used
    const expected = Buffer.byteLength(JSON.stringify(body));
    record({
      config: { url: 'https://www.padelfip.com/wp-json/fip/v1/other' },
      headers: {},
      data: body,
    });
    expect(getProxyBandwidthStats().rest_other).toEqual({ requests: 1, bytes: expected });
  });

  it('accumulates across multiple responses in the same category', () => {
    const client = createHttpClient({ userAgent: 'X', proxyUrl: PROXY });
    const record = recorder(client);
    for (const n of ['10', '20', '30']) {
      record({
        config: { url: 'https://www.padelfip.com/es/events/x/' },
        headers: { 'content-length': n },
        data: '',
      });
    }
    expect(getProxyBandwidthStats().event_page).toEqual({ requests: 3, bytes: 60 });
  });

  it('returns the response unchanged and never throws on bad input', () => {
    const client = createHttpClient({ userAgent: 'X', proxyUrl: PROXY });
    const interceptor = bandwidthInterceptor(client);
    const weird = { config: null, headers: null, data: undefined } as any;
    expect(() => interceptor.fulfilled(weird)).not.toThrow();
    expect(interceptor.fulfilled(weird)).toBe(weird);
  });

  it('__resetProxyBandwidthStats clears the accumulator', () => {
    const client = createHttpClient({ userAgent: 'X', proxyUrl: PROXY });
    const record = recorder(client);
    record({
      config: { url: 'https://www.padelfip.com/es/events/x/' },
      headers: { 'content-length': '99' },
      data: '',
    });
    expect(getProxyBandwidthStats().event_page.bytes).toBe(99);
    __resetProxyBandwidthStats();
    expect(getProxyBandwidthStats()).toEqual({});
  });
});

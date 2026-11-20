import { afterEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, type AxiosAdapter } from 'axios';
import { createHttpClient } from '../lib/http-client.js';
import { getProxyRouteStats, resetProxyRouteStats, getProxyRoutingHealth } from '../lib/fip-proxy-routing.js';
const fixedProxyUrls = ['http://user:password@fixed1.test:80', 'http://user:password@fixed2.test:80'];
const residentialProxyUrl = 'http://user:password@residential.test:80';
function setup(statuses: number[], residentialDailyByteLimit?: number) {
  const seen: any[] = [];
  const client = createHttpClient({ userAgent: 'Test', fixedProxyUrls, residentialProxyUrl, residentialDailyByteLimit, maxRetries: 3 });
  client.defaults.adapter = (async config => {
    seen.push(config);
    const status = statuses.shift() ?? 200;
    const response = { status, statusText: '', config, headers: { 'content-length': '10' }, data: status === 403 ? 'Cloudflare blocked' : 'ok' };
    if (status >= 400) throw new AxiosError('Failed', 'ERR_BAD_RESPONSE', config, undefined, response);
    return response;
  }) as AxiosAdapter;
  return { client, seen };
}
afterEach(() => { vi.useRealTimers(); resetProxyRouteStats(); });
describe('fixed primary and residential fallback', () => {
  it('uses only fixed primary when healthy and keeps non-FIP traffic direct', async () => {
    const { client, seen } = setup([200, 200]);
    await client.get('https://www.padelfip.com/events/test/');
    await client.get('https://widget.matchscorerlive.com/test');
    expect(seen.map(c => c.fipRoute)).toEqual(['fixed_1', undefined]);
    expect(seen[1].httpsAgent).toBeUndefined();
    expect(seen[1].headers.get('Origin')).toBeUndefined();
  });
  it('tries each fixed route before residential and counts each attempt once', async () => {
    const { client, seen } = setup([403, 502, 200]);
    await client.get('https://www.padelfip.com/events/test/');
    expect(seen.map(c => c.fipRoute)).toEqual(['fixed_1', 'fixed_2', 'residential']);
    expect(getProxyRouteStats()).toEqual({ fixed_1: { requests: 1, failures: 1, bytes: 10 }, fixed_2: { requests: 1, failures: 1, bytes: 10 }, residential: { requests: 1, failures: 0, bytes: 10 } });
    expect(JSON.stringify(getProxyRouteStats())).not.toContain('password');
    const health = getProxyRoutingHealth();
    expect(health.policy).toMatchObject({ fixed_routes: 2, residential_configured: true });
    expect(health.routes.fixed_1).toMatchObject({ lastFailed: true, lastStatus: 403 });
    expect(health.routes.fixed_1.cooldownUntil).not.toBeNull();
    expect(health.routes.residential).toMatchObject({ lastFailed: false, lastStatus: 200 });
    expect(health.routes.residential.lastSuccessAt).not.toBeNull();
    expect(JSON.stringify(health)).not.toContain('password');
  });
  it('does not mistake a FIP hostname in another URL path for a FIP host', async () => {
    const { client, seen } = setup([200]);
    await client.get('https://example.com/path//padelfip.com/file');
    expect(seen[0].httpsAgent).toBeUndefined();
    expect(seen[0].headers.get('Origin')).toBeUndefined();
  });
  it('does not multiply failover attempts with axios-retry', async () => {
    const { client, seen } = setup([503, 503, 503]);
    await expect(client.get('https://www.padelfip.com/events/test/')).rejects.toThrow();
    expect(seen).toHaveLength(3);
  });
  it('skips a blocked fixed route until cooldown expires', async () => {
    vi.useFakeTimers();
    const { client, seen } = setup([403, 200, 200, 200]);
    await client.get('https://www.padelfip.com/events/test/');
    await client.get('https://www.padelfip.com/events/next/');
    vi.setSystemTime(Date.now() + 300_001);
    await client.get('https://www.padelfip.com/events/next/');
    expect(seen.map(c => c.fipRoute)).toEqual(['fixed_1', 'fixed_2', 'fixed_2', 'fixed_1']);
  });
  it('fails over read-only draw POSTs but not arbitrary POSTs or 404s', async () => {
    const { client, seen } = setup([403, 200, 403, 404]);
    await client.post('https://www.padelfip.com/wp-admin/admin-ajax.php', 'action=handle_ajax_request');
    await expect(client.post('https://www.padelfip.com/submit', 'action=write')).rejects.toThrow();
    await expect(client.get('https://www.padelfip.com/missing')).rejects.toThrow();
    expect(seen).toHaveLength(4);
  });
  it('keeps a WordPress nonce failure with the caller', async () => {
    const { client, seen } = setup([]);
    client.defaults.adapter = async config => {
      seen.push(config);
      throw new AxiosError('nonce', 'ERR_BAD_REQUEST', config, undefined, { status: 403, statusText: '', headers: {}, data: '-1', config });
    };
    await expect(client.post('https://www.padelfip.com/wp-admin/admin-ajax.php', 'action=handle_ajax_request')).rejects.toThrow();
    expect(seen).toHaveLength(1);
  });
  it('stops residential use at the daily budget and resets on the next UTC day', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
    const { client, seen } = setup([403, 403, 200, 403, 403, 403, 200], 10);
    await client.get('https://www.padelfip.com/test');
    await expect(client.get('https://www.padelfip.com/test')).rejects.toThrow();
    expect(seen.filter(c => c.fipRoute === 'residential')).toHaveLength(1);
    vi.setSystemTime(new Date('2026-11-21T10:00:00Z'));
    await client.get('https://www.padelfip.com/test');
    expect(seen.filter(c => c.fipRoute === 'residential')).toHaveLength(2);
  });
  it('does not fail over an explicitly cancelled request', async () => {
    const { client, seen } = setup([]);
    client.defaults.adapter = async config => { seen.push(config); throw new AxiosError('cancelled', 'ERR_CANCELED', config); };
    await expect(client.get('https://www.padelfip.com/test')).rejects.toThrow('cancelled');
    expect(seen).toHaveLength(1);
  });
  it('sets API context and preserves explicit event Referer', async () => {
    const { client, seen } = setup([200, 200]);
    await client.get('https://www.padelfip.com/wp-json/fip/v1/player/search?q=coello');
    await client.post('https://www.padelfip.com/wp-admin/admin-ajax.php', 'action=load_entrylist_tab', { headers: { Referer: 'https://www.padelfip.com/events/test/' } });
    expect(seen[0].headers.get('Origin')).toBe('https://www.padelfip.com');
    expect(seen[0].headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    expect(seen[1].headers.get('Referer')).toBe('https://www.padelfip.com/events/test/');
  });
});

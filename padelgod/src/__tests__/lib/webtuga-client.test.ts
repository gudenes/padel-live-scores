import { describe, it, expect, vi } from 'vitest';
import { fetchResultsFeed, fetchMatchDetail } from '../../lib/webtuga-client.js';

function fakeHttp(routes: Record<string, unknown>) {
  return {
    get: vi.fn(async (url: string) => {
      const key = Object.keys(routes).find((k) => url.endsWith(k));
      if (!key) throw new Error(`no route for ${url}`);
      return { data: routes[key] };
    }),
  } as any;
}

describe('webtuga-client', () => {
  it('fetchResultsFeed returns the parsed array', async () => {
    const http = fakeHttp({
      '/api/public/results-feed': [{ id: 2, teamA: 'A / B', status: 'Live' }],
    });
    const rows = await fetchResultsFeed(http, 'https://x.win.webtuga.net');
    expect(http.get).toHaveBeenCalledWith(
      'https://x.win.webtuga.net/api/public/results-feed',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(2);
  });

  it('fetchMatchDetail hits the id-scoped endpoint', async () => {
    const http = fakeHttp({ '/api/public/matches/5': { id: 5, state: {} } });
    const detail = await fetchMatchDetail(http, 'https://x.win.webtuga.net', 5);
    expect(http.get).toHaveBeenCalledWith(
      'https://x.win.webtuga.net/api/public/matches/5',
    );
    expect(detail.id).toBe(5);
  });

  it('trims a trailing slash on the base URL', async () => {
    const http = fakeHttp({ '/api/public/results-feed': [] });
    await fetchResultsFeed(http, 'https://x.win.webtuga.net/');
    expect(http.get).toHaveBeenCalledWith(
      'https://x.win.webtuga.net/api/public/results-feed',
    );
  });

  it('returns [] when the host answers with a non-array body', async () => {
    const http = fakeHttp({ '/api/public/results-feed': '<html>down for maintenance</html>' });
    const rows = await fetchResultsFeed(http, 'https://x.win.webtuga.net');
    expect(rows).toEqual([]);
  });
});

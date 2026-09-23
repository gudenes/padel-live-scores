/**
 * HTTP access to the padeldev live feed.
 *
 * Single unauthenticated AWS Lambda origin — no token, no referer check,
 * `cache-control: no-store`. Crucially this is a *padeldev.com* property, NOT
 * padelfip.com, so it does not go through the metered residential proxy in
 * http-client.ts and consumes no proxy bandwidth.
 *
 * The tournament feed hands back absolute per-match URLs. We deliberately do
 * NOT follow those verbatim — we pull the `id` out and rebuild against our own
 * constant base, so a feed that ever starts emitting third-party URLs can't
 * redirect our fetches somewhere unexpected.
 */
import type { AxiosInstance } from 'axios';
import type { PadeldevMatchFeed, PadeldevTournamentFeed } from './padeldev-types.js';

export const PADELDEV_FEED_BASE =
  process.env.PADELDEV_FEED_BASE ??
  'https://zyc2xjpbhtmjin7bdqk77ryojq0rwonh.lambda-url.eu-west-3.on.aws/';

/** Pull the `id=` value out of a feed-supplied per-match URL. */
export function matchRefFromUrl(url: string): string | null {
  const m = /[?&]id=([A-Za-z0-9._-]+)/.exec(url ?? '');
  return m?.[1] ?? null;
}

function feedUrl(ref: string): string {
  return `${PADELDEV_FEED_BASE.replace(/\/+$/, '')}/?id=${encodeURIComponent(ref)}`;
}

export async function fetchTournamentFeed(
  httpClient: AxiosInstance,
  key: string,
): Promise<PadeldevTournamentFeed | null> {
  const res = await httpClient.get(feedUrl(`${key}.json`));
  const data = res.data as PadeldevTournamentFeed | null;
  // The vendor can answer 200 with an error body; guarantee the caller's
  // `Object.keys(feed.tournament)` can't throw.
  if (!data || typeof data !== 'object' || !data.tournament) return null;
  return data;
}

export async function fetchMatchFeed(
  httpClient: AxiosInstance,
  matchRef: string,
): Promise<PadeldevMatchFeed | null> {
  const res = await httpClient.get(feedUrl(matchRef));
  const data = res.data as PadeldevMatchFeed | null;
  if (!data || typeof data !== 'object' || !data.score) return null;
  return data;
}

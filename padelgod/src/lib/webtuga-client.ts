import type { AxiosInstance } from 'axios';
import type { WebtugaFeedRow, WebtugaMatchDetail } from './webtuga-types.js';

function base(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export async function fetchResultsFeed(
  httpClient: AxiosInstance,
  baseUrl: string,
): Promise<WebtugaFeedRow[]> {
  const res = await httpClient.get(`${base(baseUrl)}/api/public/results-feed`);
  // The tracker is an ad-hoc third party that may answer 200 with an HTML error
  // page or an object. Guarantee an array so the caller's `.filter` can't throw.
  return Array.isArray(res.data) ? (res.data as WebtugaFeedRow[]) : [];
}

export async function fetchMatchDetail(
  httpClient: AxiosInstance,
  baseUrl: string,
  id: number,
): Promise<WebtugaMatchDetail> {
  const res = await httpClient.get(`${base(baseUrl)}/api/public/matches/${id}`);
  const data = res.data as WebtugaMatchDetail | null;
  if (!data) throw new Error(`fetchMatchDetail: empty response for id=${id}`);
  return data;
}

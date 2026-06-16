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
  return (res.data ?? []) as WebtugaFeedRow[];
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

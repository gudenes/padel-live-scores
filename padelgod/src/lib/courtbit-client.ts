import type { AxiosInstance } from 'axios';
import { z } from 'zod';
import { normalizeIdentity } from './strict-player-resolver.js';

const games = z.tuple([z.number().int().min(0).max(7), z.number().int().min(0).max(7)]);
const player = z.object({ name: z.string().min(2), slug: z.string().min(1).nullable(), country: z.string().min(2).max(3) });
const team = z.object({ players: z.array(player).max(2) });
export const courtbitMatchSchema = z.object({
  id: z.string().min(1), category: z.enum(['Masculino', 'Femenino']), phase: z.string().min(1),
  a: team, b: team, status: z.enum(['pending', 'ready', 'live', 'done']),
  sets: z.array(games).max(3), games: games.nullable(),
  tb: z.array(z.number().int().nonnegative().nullable()).max(3),
  points: z.tuple([z.string().min(1), z.string().min(1)]).nullable(),
  server: z.enum(['A', 'B']).nullable(), winner: z.enum(['A', 'B']).nullable(),
  reason: z.enum(['score', 'retired', 'walkover', 'default']).nullable(),
  startedAt: z.number().int().positive().nullable(), finishedAt: z.number().int().positive().nullable(),
  courtName: z.string(), playedOn: z.string().nullable(), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type CourtbitMatch = z.infer<typeof courtbitMatchSchema>;
/** Some wildcard players have no slug. Do not collapse them into one null ID. */
export function courtbitPlayerKey(p: CourtbitMatch['a']['players'][number]): string {
  return p.slug ?? `name:${normalizeIdentity(p.name)}:${p.country.toUpperCase()}`;
}
const envelope = z.object({ ok: z.literal(true), name: z.string(), matches: z.array(z.unknown()).max(1000) });
export interface CourtbitFeed { name: string; matches: CourtbitMatch[]; rejected: number }

export function normalizeCourtbitUrl(input: string): string {
  const url = new URL(input);
  // Explicit allowlist, no arbitrary URL fetching or redirects from DB mappings.
  if (url.protocol !== 'https:' || url.hostname !== 'fip.courtbit.com.mx' || url.port ||
      url.username || url.password || !['/', '/api/widget', '/widget/resultados'].includes(url.pathname) || url.search || url.hash) {
    throw new Error('Expected https://fip.courtbit.com.mx CourtBit endpoint');
  }
  return `${url.origin}/api/widget`;
}

export function parseCourtbitFeed(raw: unknown, expectedName: string): CourtbitFeed {
  const data = envelope.parse(raw);
  if (!expectedName.trim() || normalizeIdentity(data.name) !== normalizeIdentity(expectedName)) throw new Error('CourtBit event identity mismatch');
  const matches: CourtbitMatch[] = [];
  const ids = new Set<string>();
  let rejected = 0;
  for (const row of data.matches) {
    const parsed = courtbitMatchSchema.safeParse(row);
    if (!parsed.success) { rejected++; continue; }
    if (ids.has(parsed.data.id)) throw new Error('Duplicate CourtBit match ID');
    ids.add(parsed.data.id);
    matches.push(parsed.data);
  }
  return { name: data.name, matches, rejected };
}

/** Cache network payloads, not successful database writes. A 304 returns the
 * last validated body so failed/unresolved rows are retried on every tick. */
export class CourtbitClient {
  private cache = new Map<string, { etag?: string; feed: CourtbitFeed; observedAt: string }>();
  async fetch(http: AxiosInstance, baseUrl: string, expectedName: string) {
    const url = normalizeCourtbitUrl(baseUrl);
    const key = `${url}:${expectedName}`;
    const prev = this.cache.get(key);
    const response = await http.get(url, {
      timeout: 10000, maxRedirects: 0, maxContentLength: 2_000_000,
      headers: prev?.etag ? { 'If-None-Match': prev.etag } : {},
      validateStatus: status => status === 200 || status === 304,
    });
    if (response.status === 304) {
      if (!prev) throw new Error('CourtBit returned 304 without a cached body');
      return { ...prev, notModified: true };
    }
    const cached = { feed: parseCourtbitFeed(response.data, expectedName), etag: response.headers.etag as string | undefined, observedAt: new Date().toISOString() };
    this.cache.set(key, cached);
    return { ...cached, notModified: false };
  }
}

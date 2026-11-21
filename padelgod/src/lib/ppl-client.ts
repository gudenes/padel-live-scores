import type { AxiosInstance } from 'axios';
import { z } from 'zod';

export const PPL_DATABASE = 'projects/pro-padel-league/databases/prod-ppl';
const origin = 'https://propadelleague.com';
const documents = `https://firestore.googleapis.com/v1/${PPL_DATABASE}/documents`;
const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(180);
const options = { timeout: 10000, maxRedirects: 0, maxContentLength: 3_000_000 };

/** Only public document GETs. No Firebase credentials, private point collection,
 * browser session or Firestore write API is used. */
export function decodeFirestore(value: unknown): unknown {
  const v = z.record(z.unknown()).parse(value);
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return z.string().parse(v.stringValue);
  if ('timestampValue' in v) return z.string().datetime({ offset: true }).parse(v.timestampValue);
  if ('booleanValue' in v) return z.boolean().parse(v.booleanValue);
  if ('integerValue' in v) return z.coerce.number().int().safe().parse(v.integerValue);
  if ('doubleValue' in v) return z.number().finite().parse(v.doubleValue);
  if ('arrayValue' in v) {
    const a = z.object({ values: z.array(z.unknown()).default([]) }).parse(v.arrayValue);
    return a.values.map(decodeFirestore);
  }
  if ('mapValue' in v) {
    const m = z.object({ fields: z.record(z.unknown()).default({}) }).parse(v.mapValue);
    return Object.fromEntries(Object.entries(m.fields).map(([k, x]) => [k, decodeFirestore(x)]));
  }
  throw new Error('Unsupported Firestore value');
}

export function decodePplDocument(raw: unknown, id: string) {
  slugSchema.parse(id);
  const d = z.object({ name: z.literal(`${PPL_DATABASE}/documents/matches/${id}`),
    updateTime: z.string().datetime({ offset: true }), fields: z.record(z.unknown()) }).parse(raw);
  return { data: decodeFirestore({ mapValue: { fields: d.fields } }), revision: d.updateTime };
}

export const eventSchema = z.object({
  slug: slugSchema, name: z.string().min(1), startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), league: z.enum(['ppl', 'ppl-ii']),
});
export type PplEvent = z.infer<typeof eventSchema>;
export interface PplRosterPlayer { slug: string; name: string; country: string | null; category: 'men' | 'women'; team: string }
export interface PplFixture { id: string; home: string; away: string; category: 'men' | 'women'; stage: string; session: number | null; scheduledAt: string }
export interface PplEventPage { event: PplEvent; timezone: string; matchIds: string[]; players: PplRosterPlayer[]; fixtures: PplFixture[] }

/** Schedule dates are venue-local. The scoring document's scheduled_start_time
 * has been observed to disagree with the published event schedule. */
export function pplScheduleUtc(raw: string, timezone: string): string {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::\d{2})?$/);
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!iso && !us) throw new Error('Unsupported PPL schedule');
  const [year, month, day] = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : [Number(us![3]), Number(us![1]), Number(us![2])];
  let hour = Number((iso ?? us)![4]); const minute = Number((iso ?? us)![5]);
  if (us?.[6]?.toUpperCase() === 'PM' && hour !== 12) hour += 12;
  if (us?.[6]?.toUpperCase() === 'AM' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59 || month < 1 || month > 12 || day < 1 || day > 31) throw new Error('Invalid PPL schedule');
  const expected = Date.UTC(year, month - 1, day, hour, minute);
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const wall = (date: number) => {
    const parts = fmt.formatToParts(date), get = (type: string) => Number(parts.find(p => p.type === type)!.value);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  };
  let actual = expected;
  for (let i = 0; i < 3; i++) actual += expected - wall(actual);
  if (wall(actual) !== expected) throw new Error('PPL nonexistent local time');
  return new Date(actual).toISOString();
}

export function parsePplIndex(raw: unknown): PplEvent[] {
  const payload = z.object({ pageProps: z.object({ extraProps: z.object({ tournaments: z.array(z.object({
    id: z.string(), values: z.record(z.unknown()),
  })) }) }) }).parse(raw);
  return payload.pageProps.extraProps.tournaments.flatMap(r => {
    const v = r.values;
    if (v.hiddenFromWeb === true || v.detailPageEnabled === false) return [];
    const league = v.leagueId ?? (v.league as { docId?: string } | undefined)?.docId;
    const event = eventSchema.safeParse({ slug: r.id, name: v.title, startsAt: v.startDate, endsAt: v.endDate, league });
    return event.success ? [event.data] : [];
  });
}

export function parsePplEventPage(raw: unknown, event: PplEvent): PplEventPage {
  const p = z.object({ pageProps: z.object({ hero: z.object({ startDate: z.string(), endDate: z.string() }),
    broadcastContext: z.object({ tournamentSlug: z.literal(event.slug), tournamentTimeZone: z.string(),
      tournamentLeagueDocId: z.literal(event.league), matchRows: z.array(z.object({ id: slugSchema, values: z.record(z.unknown()) })).max(500),
      playerRowsById: z.record(z.object({ values: z.record(z.unknown()) })),
    }) }) }).parse(raw).pageProps;
  if (p.hero.startDate !== event.startsAt || p.hero.endDate !== event.endsAt) throw new Error('PPL event dates changed during discovery');
  // Older published stops have an empty timeZone. Keep the known venue fallback
  // explicit; never infer Mexico/US timezone from a country or runtime locale.
  const knownZones: Record<string, string> = { 'playa-del-carmen': 'America/Cancun',
    'playa-del-carmen-ppl-ii-2026': 'America/Cancun', 'new-york-2026': 'America/New_York',
    'new-york-ppl-ii-2026': 'America/New_York', 'los-angeles-2026': 'America/Los_Angeles',
    'los-angeles-ppl-ii-2026': 'America/Los_Angeles', 'miami-2026': 'America/New_York' };
  const timezone = p.broadcastContext.tournamentTimeZone || knownZones[event.slug];
  if (!timezone) throw new Error('PPL venue timezone missing');
  new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
  const matchIds = p.broadcastContext.matchRows.map(m => m.id);
  if (new Set(matchIds).size !== matchIds.length) throw new Error('Duplicate PPL match ID');
  const players = Object.entries(p.broadcastContext.playerRowsById).flatMap(([slug, row]) => {
    const v = row.values;
    if (typeof v.displayName !== 'string' || typeof v.teamId !== 'string' || !['male', 'female'].includes(String(v.sex))) return [];
    return [{ slug, name: v.displayName.replace(/\s*["“][^"”]*["”]\s*/g, ' ').trim(),
      country: typeof v.nationality === 'string' ? v.nationality : null,
      category: v.sex === 'male' ? 'men' as const : 'women' as const, team: v.teamId }];
  });
  const fixtures = p.broadcastContext.matchRows.flatMap(row => {
    const v = row.values;
    const home = (v.hometeam as { docId?: string } | null)?.docId, away = (v.awayteam as { docId?: string } | null)?.docId;
    if (!home || !away) return []; // Podium slots stay unmaterialized until teams are confirmed.
    slugSchema.parse(home); slugSchema.parse(away);
    const category = v.game_type === 'male' ? 'men' as const : v.game_type === 'female' ? 'women' as const : null;
    if (!category || typeof v.date !== 'string' || typeof v.stage !== 'string') throw new Error('Invalid PPL fixture');
    return [{ id: row.id, home, away, category, stage: v.stage,
      session: typeof v.sessionNumber === 'number' ? v.sessionNumber : null, scheduledAt: pplScheduleUtc(v.date, timezone) }];
  });
  return { event, timezone, matchIds, players, fixtures };
}

export class PplClient {
  private indexCache?: { expires: number; buildId: string; events: PplEvent[] };
  private pages = new Map<string, { expires: number; page: PplEventPage }>();
  async index(http: AxiosInstance): Promise<PplEvent[]> {
    if (this.indexCache && this.indexCache.expires > Date.now()) return this.indexCache.events;
    const html = await http.get<string>(`${origin}/tournaments/`, options);
    const match = String(html.data).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) throw new Error('PPL discovery payload missing');
    const data = z.object({ buildId: z.string().regex(/^[\w-]+$/), props: z.unknown() }).parse(JSON.parse(match[1]!));
    const events = parsePplIndex(data.props);
    this.indexCache = { buildId: data.buildId, events, expires: Date.now() + 300_000 };
    return events;
  }
  async event(http: AxiosInstance, event: PplEvent): Promise<PplEventPage> {
    eventSchema.parse(event);
    const cached = this.pages.get(event.slug);
    if (cached && cached.expires > Date.now()) return cached.page;
    await this.index(http);
    const r = await http.get(`${origin}/_next/data/${this.indexCache!.buildId}/tournament/${event.slug}.json`, options);
    const page = parsePplEventPage(r.data, event);
    this.pages.set(event.slug, { page, expires: Date.now() + 60_000 });
    return page;
  }
  async match(http: AxiosInstance, id: string) {
    slugSchema.parse(id);
    const r = await http.get(`${documents}/matches/${id}`, options);
    return decodePplDocument(r.data, id);
  }
}

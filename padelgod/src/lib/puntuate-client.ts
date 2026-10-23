import type { AxiosInstance } from 'axios';
import { load } from 'cheerio';
import { createHash } from 'node:crypto';

export interface PuntuateRow {
  id: string;
  category: 'men' | 'women';
  round: string;
  date: string;
  court: string;
  status: 'Live' | 'Finished' | 'Scheduled';
  teamA: string;
  teamB: string;
  setsA: number[];
  setsB: number[];
  pointsA: string;
  pointsB: string;
  servingTeam: 1 | 2 | null;
}

export function normalizePuntuateUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.puntuate.com') ||
      url.username || url.password || url.port ||
      url.pathname.toLowerCase() !== '/ordenjuegofip.aspx' ||
      !/^\d+$/.test(url.searchParams.get('idTorneo') ?? '')) {
    throw new Error('Expected an HTTPS Puntuate ordenJuegoFip.aspx tournament URL');
  }
  // Full results view includes dates and completed matches. One request per tick.
  const id = url.searchParams.get('idTorneo')!;
  url.search = new URLSearchParams({ idTorneo: id, rf: '0' }).toString();
  url.hash = '';
  return url.toString();
}

/** Server-rendered scoreboard; no browser or undocumented API required. */
export function parsePuntuate(html: string): PuntuateRow[] {
  const $ = load(html);
  if (!$('#ojfRoot').length) throw new Error('Unrecognized Puntuate response');
  const dates = new Map<string, string>();
  $('[data-ojf-tab]').each((_, el) => {
    dates.set($(el).attr('data-ojf-tab')!, $(el).attr('data-ojf-date') ?? '');
  });
  const rows = new Map<string, PuntuateRow>();
  $('.ojf-card').each((_, el) => {
    const card = $(el);
    const teams = card.find('.ojf-teamRow');
    const a = teams.eq(0), b = teams.eq(1);
    const namesA = a.find('.ojf-name').map((_, n) => $(n).text().trim()).get();
    const namesB = b.find('.ojf-name').map((_, n) => $(n).text().trim()).get();
    const cat = card.find('.ojf-cat').text().trim();
    if (teams.length !== 2 || namesA.length !== 2 || namesB.length !== 2 ||
        [...namesA, ...namesB].some(n => !n) || !['Men', 'Women'].includes(cat)) return;
    const readSets = (team: typeof a) => team.find('.ojf-set').map((_, n) => {
      const value = $(n).text().trim();
      return /^\d+$/.test(value) ? Number(value) : NaN;
    }).get();
    const setsA = readSets(a), setsB = readSets(b);
    if (setsA.length !== setsB.length || setsA.length > 3 ||
        [...setsA, ...setsB].some(n => !Number.isInteger(n) || n < 0 || n > 7)) return;
    const statusText = card.find('.ojf-status').text().trim();
    const status = statusText === 'Live' ? 'Live' : statusText === 'Finished' ? 'Finished' : 'Scheduled';
    // Puntuate can announce Live before publishing any set scores.
    // Preserve that presence signal; the worker handles it without score writes.
    const date = dates.get(card.closest('[data-ojf-panel]').attr('data-ojf-panel') ?? '') ?? '';
    const round = card.find('.ojf-metaText').text().split('•')[0]!.trim();
    const teamA = namesA.join(' / '), teamB = namesB.join(' / ');
    // Ordered teams deliberately change identity on an upstream side swap,
    // preventing reuse of cached score orientation from the earlier layout.
    const id = createHash('sha256').update(JSON.stringify([date, cat, round, teamA, teamB])).digest('hex');
    const row: PuntuateRow = {
      id, date, round, category: cat === 'Men' ? 'men' : 'women', status,
      court: card.closest('.ojf-courtColumn').find('.ojf-courtHeader').first().text().trim(),
      teamA, teamB, setsA, setsB,
      pointsA: a.find('.ojf-game').text().trim(), pointsB: b.find('.ojf-game').text().trim(),
      servingTeam: a.find('.ojf-serve').length ? 1 : b.find('.ojf-serve').length ? 2 : null,
    };
    rows.set(id, row); // responsive duplicate cards must not cause duplicate writes
  });
  return [...rows.values()];
}

export async function fetchResultsFeed(http: AxiosInstance, url: string): Promise<PuntuateRow[]> {
  const res = await http.get(normalizePuntuateUrl(url), {
    responseType: 'text', timeout: 15000, maxRedirects: 0,
  });
  if (typeof res.data !== 'string') throw new Error('Expected Puntuate HTML');
  return parsePuntuate(res.data);
}

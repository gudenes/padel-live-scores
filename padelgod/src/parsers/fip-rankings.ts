import * as cheerio from 'cheerio';

// === Parser selectors — adjust here after live HTML inspection ===
const RANKING_ROW_SELECTOR = 'table.ranking-table tbody tr';
const RANK_SELECTOR = '.rank';
const NAME_SELECTOR = '.player-name';
const COUNTRY_FLAG_SELECTOR = '.player-country img';
const POINTS_SELECTOR = '.points';
// =================================================================

export type Gender = 'men' | 'women';

export interface ParsedRanking {
  rank: number;
  name: string;
  country: string | null;
  points: number;
  gender: Gender;
}

export function parseFipRankings(html: string, gender: Gender): ParsedRanking[] {
  const $ = cheerio.load(html);
  const rows: ParsedRanking[] = [];
  $(RANKING_ROW_SELECTOR).each((_, el) => {
    const row = $(el);
    const rank = parseInt(row.find(RANK_SELECTOR).first().text().trim(), 10);
    const name = row.find(NAME_SELECTOR).first().text().trim();
    const flag = row.find(COUNTRY_FLAG_SELECTOR).first();
    const country =
      flag.attr('alt')?.trim() ||
      (flag.attr('src') ?? '').match(/([A-Z]{3})\.jpg/)?.[1] ||
      null;
    const points = parseInt(row.find(POINTS_SELECTOR).first().text().replace(/\D/g, ''), 10);
    if (Number.isNaN(rank) || !name) return;
    rows.push({
      rank,
      name,
      country,
      points: Number.isNaN(points) ? 0 : points,
      gender,
    });
  });
  return rows;
}

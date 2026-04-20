import * as cheerio from 'cheerio';

export interface ParsedSearchResult {
  code: string;
  name: string;
  isLive: boolean;
}

export function parseCrionetSearchResults(
  html: string,
  year: number
): ParsedSearchResult[] {
  const $ = cheerio.load(html);
  const results: ParsedSearchResult[] = [];

  $('.card.tournament-card').each((_, el) => {
    const card = $(el);
    const name = card.find('.tournament-name').first().text().trim();
    const codeNum = card.find('.tournament-code').first().text().trim();
    const isLive = card.find('.tournament-card-header-live').length > 0;
    if (!name || !codeNum) return;
    results.push({
      code: `FIP-${year}-${codeNum}`,
      name,
      isLive,
    });
  });

  return results;
}

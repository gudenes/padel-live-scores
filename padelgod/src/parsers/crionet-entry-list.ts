import * as cheerio from 'cheerio';
import { normalizeCountry } from '../lib/country.js';

// === Selectors — adjust post-deploy after live HTML inspection ===
const ROW_SELECTOR = '.entry-list-row';
const NAME_SELECTOR = '.player-name';
const COUNTRY_FLAG_SELECTOR = '.player-country img';
const SEED_SELECTOR = '.seed';
const PARTNER_NAME_SELECTOR = '.partner-name';
// =================================================================

export type Category = 'men' | 'women';

export interface ParsedEntryListPlayer {
  fipId: string | null;
  name: string;
  country: string | null;
  seed: number | null;
  partnerFipId: string | null;
  partnerName: string | null;
  category: Category;
}

// "LASTNAME, Firstname" → "Firstname Lastname"
function normalizeName(raw: string): string {
  const trimmed = raw.trim();
  const m = trimmed.match(/^(.+?),\s+(.+)$/);
  if (!m) return trimmed;
  const lastname = (m[1] ?? '')
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
  const firstname = (m[2] ?? '').trim();
  return `${firstname} ${lastname}`.trim();
}

function parseSeed(raw: string): number | null {
  const m = raw.match(/\((\d+)\)/);
  return m && m[1] ? parseInt(m[1], 10) : null;
}

function parseCountry(flagSrc: string, alt: string): string | null {
  // Extract whatever Crionet gave us (alpha-3 from flag filename or alt
  // attr) then normalize to our canonical alpha-2 via the shared helper.
  // Unknown codes fall through upper-cased — see `lib/country.ts`.
  const raw = alt && alt.trim().length === 3
    ? alt.trim().toUpperCase()
    : flagSrc.match(/([A-Z]{3})\.jpg/)?.[1] ?? null;
  return normalizeCountry(raw);
}

export function parseCrionetEntryList(html: string, category: Category): ParsedEntryListPlayer[] {
  const $ = cheerio.load(html);
  const rows: ParsedEntryListPlayer[] = [];

  $(ROW_SELECTOR).each((_, el) => {
    const row = $(el);
    const name = normalizeName(row.find(NAME_SELECTOR).first().text() ?? '');
    if (!name) return;

    const fipId = row.attr('data-fip-id')?.trim() || null;
    const partnerFipId = row.attr('data-partner-fip-id')?.trim() || null;
    const flag = row.find(COUNTRY_FLAG_SELECTOR).first();
    const country = parseCountry(flag.attr('src') ?? '', flag.attr('alt') ?? '');
    const seed = parseSeed(row.find(SEED_SELECTOR).first().text() ?? '');
    const partnerNameRaw = row.find(PARTNER_NAME_SELECTOR).first().text() ?? '';
    const partnerName = partnerNameRaw ? normalizeName(partnerNameRaw) : null;

    rows.push({ fipId, name, country, seed, partnerFipId, partnerName, category });
  });

  return rows;
}

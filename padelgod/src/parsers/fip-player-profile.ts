import * as cheerio from 'cheerio';

export interface ParsedPlayerProfile {
  fipId: string | null;
  birthDate: string | null; // ISO YYYY-MM-DD
  birthPlace: string | null;
  heightCm: number | null;
  affiliation: string | null;
  racketBrand: string | null;
  racketModel: string | null;
  /**
   * Ordered list of coach names from the `<div class="overview__coaches">`
   * block on the FIP player page. A player can have multiple coaches.
   * Empty array when the page has no coaches section or lists no names.
   */
  coaches: string[];
}

const FIP_ID_REGEX = /\bP\d{4,7}\b/;

function extractJsonLd(html: string): Record<string, unknown> | null {
  const match = html.match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (!match || !match[1]) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function parseHeightCm(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/(\d+)\s*cm/i);
  return m && m[1] ? parseInt(m[1], 10) : null;
}

export function parseFipPlayerProfile(html: string): ParsedPlayerProfile {
  const $ = cheerio.load(html);

  // fip_id: prefer data attribute, fall back to regex on page text
  let fipId = $('[data-fip-id]').first().attr('data-fip-id')?.trim() ?? null;
  if (!fipId) {
    const match = html.match(FIP_ID_REGEX);
    fipId = match ? match[0] : null;
  }

  // JSON-LD Person fields
  const ld = extractJsonLd(html);
  let birthDate: string | null = null;
  let birthPlace: string | null = null;
  let heightCm: number | null = null;
  let affiliation: string | null = null;
  if (ld && typeof ld === 'object') {
    const obj = ld as Record<string, any>;
    birthDate = typeof obj.birthDate === 'string' ? obj.birthDate.slice(0, 10) : null;
    birthPlace = obj.birthPlace?.name ?? null;
    heightCm = parseHeightCm(obj.height);
    affiliation = obj.affiliation?.name ?? null;
  }

  // Equipment
  const racketBrand = $('.racket-brand').first().text().trim() || null;
  const racketModel = $('.racket-model').first().text().trim() || null;

  // Coaches — one or more <p class="overview__text"> inside .overview__coaches.
  // Names are surfaced verbatim (no normalization) so the ops dashboard can
  // audit before any future dedup pass.
  const coaches: string[] = [];
  $('.overview__coaches .overview__text').each((_, el) => {
    const name = $(el).text().trim();
    if (name) coaches.push(name);
  });

  return { fipId, birthDate, birthPlace, heightCm, affiliation, racketBrand, racketModel, coaches };
}

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
  /**
   * "Playing Position" per FIP — which side of the court the player plays
   * ("Right" or "Left"). Distinct from handedness. Sourced from JSON-LD
   * description (regex) first, HTML overview block as fallback.
   */
  side: string | null;
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

/**
 * FIP exposes height in three forms across Person and meta tags:
 *   - "180 cm"  (legacy / explicit centimeters)
 *   - "1.75"    (decimal meters — what padelfip.com Yoast schema returns today)
 *   - "1,75"    (decimal meters with comma separator, observed on locale pages)
 *   - "175"     (bare integer assumed to be centimeters)
 *
 * Returns centimeters, or null when the value is missing / nonsense.
 * Sanity-bounded to 100..250 cm so noise like "0.5" or "50" gets rejected.
 */
function parseHeightCm(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const str = String(value).trim();
  if (!str) return null;

  // "180 cm" → 180 (existing form)
  const cmMatch = str.match(/(\d+)\s*cm/i);
  if (cmMatch && cmMatch[1]) {
    const cm = parseInt(cmMatch[1], 10);
    return cm >= 100 && cm <= 250 ? cm : null;
  }

  // "1.75" or "1,75" (decimal meters)
  const decimalMatch = str.match(/^(\d)[.,](\d{1,2})$/);
  if (decimalMatch) {
    const meters = parseFloat(`${decimalMatch[1]}.${decimalMatch[2]}`);
    const cm = Math.round(meters * 100);
    return cm >= 100 && cm <= 250 ? cm : null;
  }

  // "175" (bare integer assumed to be cm)
  const intMatch = str.match(/^(\d{2,3})$/);
  if (intMatch && intMatch[1]) {
    const cm = parseInt(intMatch[1], 10);
    return cm >= 100 && cm <= 250 ? cm : null;
  }

  return null;
}

/**
 * Walk a JSON-LD value to find the Person node carrying bio fields.
 *
 * padelfip.com uses Yoast SEO, which emits an `@graph` array containing a
 * WebPage node whose `mainEntity` is the Person. Older / simpler pages may
 * have a top-level `@type: "Person"` node directly. Try both shapes.
 */
function findPersonNode(ld: unknown): Record<string, any> | null {
  if (!ld || typeof ld !== 'object') return null;
  const obj = ld as Record<string, any>;

  // Direct Person at top level (legacy shape used by tests + older pages)
  if (obj['@type'] === 'Person') return obj;

  // Yoast @graph: search nodes for a Person, either directly or via mainEntity.
  if (Array.isArray(obj['@graph'])) {
    for (const node of obj['@graph']) {
      if (!node || typeof node !== 'object') continue;
      if (node['@type'] === 'Person') return node;
      const me = node.mainEntity;
      if (me && typeof me === 'object' && me['@type'] === 'Person') return me;
    }
  }

  // Top-level mainEntity → Person (uncommon but seen in some shapes)
  const me = obj.mainEntity;
  if (me && typeof me === 'object' && me['@type'] === 'Person') return me;

  return null;
}

export function parseFipPlayerProfile(html: string): ParsedPlayerProfile {
  const $ = cheerio.load(html);

  // fip_id: prefer data attribute, fall back to regex on page text
  let fipId = $('[data-fip-id]').first().attr('data-fip-id')?.trim() ?? null;
  if (!fipId) {
    const match = html.match(FIP_ID_REGEX);
    fipId = match ? match[0] : null;
  }

  // JSON-LD Person fields. Walk the graph to find the Person node — Yoast
  // SEO nests it under @graph[].mainEntity, older pages put it at the top
  // level. See findPersonNode for the shapes we support.
  const ld = extractJsonLd(html);
  const person = findPersonNode(ld);
  let birthDate: string | null = null;
  let birthPlace: string | null = null;
  let heightCm: number | null = null;
  let affiliation: string | null = null;
  let side: string | null = null;
  if (person) {
    birthDate = typeof person.birthDate === 'string' ? person.birthDate.slice(0, 10) : null;
    birthPlace = person.birthPlace?.name ?? null;
    heightCm = parseHeightCm(person.height);
    affiliation = person.affiliation?.name ?? null;
    // Playing Position is embedded in the description string, e.g.
    // "...Playing Position: Right;". Pluck it with a regex.
    if (typeof person.description === 'string') {
      const m = person.description.match(/Playing Position:\s*([A-Za-z]+)/i);
      if (m && m[1]) side = m[1];
    }
  }
  // HTML fallback when JSON-LD didn't surface side (older page formats).
  if (!side) {
    $('.overview__mirror').each((_, el) => {
      if (side) return;
      const title = $(el).find('.overview__title').first().text().trim().toLowerCase();
      if (title === 'playing position') {
        const value = $(el).find('.overview__text').first().text().trim();
        if (value) side = value;
      }
    });
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

  return { fipId, birthDate, birthPlace, heightCm, affiliation, racketBrand, racketModel, coaches, side };
}

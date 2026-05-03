/**
 * Mirror of padelgod/src/parsers/fip-event-page-detail.ts — kept in sync
 * manually because the top-level tsconfig excludes padelgod/ (moduleResolution
 * "bundler" + padelgod is in the exclude list), so cross-package imports from
 * scripts/ don't compile under tsc.
 *
 * When updating parsePrizeBreakdown in padelgod, keep this in sync.
 */

export interface PrizeBreakdown {
  r32?: number;
  r16?: number;
  qf?: number;
  sf?: number;
  finalist?: number;
  winner?: number;
  currency: 'EUR';
  per: 'player';
  source: 'scraped' | 'inferred';
}

type RoundKey = 'r32' | 'r16' | 'qf' | 'sf' | 'finalist' | 'winner';

function roundLabelToKey(label: string): RoundKey | null {
  if (label === 'R32' || label === 'ROUND 32') return 'r32';
  if (label === 'R16' || label === 'ROUND 16') return 'r16';
  if (
    label === 'QF' ||
    label === '1/4 FINAL' ||
    label === '1/4FINAL' ||
    label === 'QUARTERFINAL' ||
    label === 'QUARTER FINAL'
  )
    return 'qf';
  if (
    label === 'SF' ||
    label === '1/2 FINAL' ||
    label === '1/2FINAL' ||
    label === 'SEMIFINAL' ||
    label === 'SEMI FINAL'
  )
    return 'sf';
  if (label === 'FINALIST' || label === 'RUNNER UP' || label === 'RUNNER-UP')
    return 'finalist';
  if (label === 'WINNER' || label === 'CHAMPION') return 'winner';
  return null;
}

/**
 * Parse a single numeric amount from raw text. Handles both:
 *   US-style decimal:        "1,234.56" → 1234.56
 *   European-style decimal:  "349,65"   → 349.65
 *   Plain integer:           "999"      → 999
 *
 * The disambiguator is the LAST separator's position. If the last separator
 * is followed by exactly 2 digits (DD), it's a decimal. Otherwise the
 * separator is treated as thousands and stripped.
 *
 * Currency symbols / spaces are stripped before parsing.
 */
function parsePrizeAmount(raw: string): number | null {
  const cleaned = raw.replace(/[€\s]/g, '');
  if (cleaned === '') return null;

  // Find the last separator (',' or '.') and check if it's a decimal mark.
  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  const lastSep = Math.max(lastDot, lastComma);

  let normalised: string;
  if (lastSep === -1) {
    normalised = cleaned;
  } else {
    const trailing = cleaned.length - lastSep - 1;
    if (trailing === 2) {
      // "349,65" or "1.234,56" or "1,234.56" — last separator is decimal.
      // Strip every other separator, then convert the decimal to '.'.
      const head = cleaned.slice(0, lastSep).replace(/[.,]/g, '');
      const tail = cleaned.slice(lastSep + 1);
      normalised = `${head}.${tail}`;
    } else {
      // Separators are pure thousands grouping — strip them all.
      normalised = cleaned.replace(/[.,]/g, '');
    }
  }

  const n = Number.parseFloat(normalised);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function parsePrizeBreakdown(html: string): PrizeBreakdown | null {
  const rounds: Partial<Record<RoundKey, number>> = {};
  let hits = 0;

  // Layout 1 — HTML table: <th scope="row">LABEL</th><td>AMOUNT</td>
  // (Used by KL Bronze, Cyprus Silver, and most events the existing
  // enricher already covers.)
  const tableRe =
    /<th[^>]*scope="row"[^>]*>\s*([^<]+?)\s*<\/th>\s*<td[^>]*>\s*€?\s*([0-9][\d.,]*)\s*€?\s*<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(html)) !== null) {
    const label = m[1]!.toUpperCase().replace(/\s+/g, ' ').trim();
    const key = roundLabelToKey(label);
    if (!key) continue;
    // Existing US-style strip — table layout has only ever shown amounts
    // without European decimals in observed pages.
    const raw = m[2]!.replace(/,/g, '');
    const amount = Number.parseFloat(raw);
    if (!Number.isFinite(amount) || amount < 0) continue;
    rounds[key] = Math.round(amount * 100) / 100;
    hits++;
  }

  // Layout 2 — paragraph block: "LABEL – AMOUNT€<br />" inside a <p>.
  // Used by older / smaller-tier events (Bronze Qatar, Silver Como, etc).
  // Dash is em-dash (–, U+2013), en-dash (—, U+2014), or hyphen (-).
  // Amount uses European decimal (349,65€). Only fill keys not already set
  // by Layout 1 — a page that uses BOTH layouts is unheard of, but if it
  // happens the table value wins.
  const paraRe =
    /([A-Z0-9][A-Z0-9 \/]{2,30})\s*[–—-]\s*([0-9][\d.,]*\s*€)/g;
  while ((m = paraRe.exec(html)) !== null) {
    const label = m[1]!.toUpperCase().replace(/\s+/g, ' ').trim();
    const key = roundLabelToKey(label);
    if (!key) continue;
    if (rounds[key] != null) continue;  // Layout 1 wins on overlap
    const amount = parsePrizeAmount(m[2]!);
    if (amount == null) continue;
    rounds[key] = Math.round(amount * 100) / 100;
    hits++;
  }

  if (hits === 0) return null;
  return { ...rounds, currency: 'EUR', per: 'player', source: 'scraped' };
}

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
 *   US-style decimal:        "1,234.56" → 1234.56,  "212.5"   → 212.5
 *   European-style decimal:  "349,65"   → 349.65,   "1.234,56" → 1234.56
 *   European-style thousands: "9.375"   → 9375     (no decimal)
 *   Plain integer:           "999"      → 999
 *
 * The disambiguator is the LAST separator's position:
 *  - 1 or 2 trailing digits → decimal mark (`212.5`, `349,65`).
 *  - 3+ trailing digits     → thousands grouping (`9.375`, `1,234`),
 *    so we strip every separator.
 *
 * Currency symbols / spaces are stripped before parsing.
 */
function parsePrizeAmount(raw: string): number | null {
  const cleaned = raw.replace(/[€\s]/g, '');
  if (cleaned === '') return null;

  // Find the last separator (',' or '.') and decide whether it's a
  // decimal mark or a thousands separator.
  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  const lastSep = Math.max(lastDot, lastComma);

  let normalised: string;
  if (lastSep === -1) {
    normalised = cleaned;
  } else {
    const trailing = cleaned.length - lastSep - 1;
    if (trailing === 1 || trailing === 2) {
      // "212.5", "349,65", "1.234,56", "1,234.56" — last separator is
      // decimal. Strip every OTHER separator, then convert to '.'.
      const head = cleaned.slice(0, lastSep).replace(/[.,]/g, '');
      const tail = cleaned.slice(lastSep + 1);
      normalised = `${head}.${tail}`;
    } else {
      // 3+ trailing digits → separators are pure thousands grouping
      // ("9.375", "1,234"). Strip them all.
      normalised = cleaned.replace(/[.,]/g, '');
    }
  }

  const n = Number.parseFloat(normalised);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Tier-aware ceiling on a single per-player payout. The ×100 decimal-strip
 * bug (an older parser turned "807,50" into 80750) produced breakdown values
 * 100× over reality, and those corrupted rows are still in the DB. Any
 * per-player amount above the tier's plausible maximum winner share is a
 * corruption signal, not a real payout.
 *
 * Ceilings are ~1.5–2× the rulebook max winner-per-player so above-range
 * special events (e.g. a €12k Bronze paying ~€1,140) never false-positive,
 * while a 100×-inflated value (≥ €34,965 for Bronze) always trips.
 *
 * Deliberately keyed on TIER, not the tournament's stored total prize money —
 * some corrupted rows ALSO have a broken total (e.g. 40), so a pool-relative
 * check would miss them.
 */
const TIER_PER_PLAYER_CEILING_EUR: Record<string, number> = {
  fip_bronze: 1500,
  fip_silver: 4000,
  fip_gold: 12000,
  fip_platinum: 25000,
};
const DEFAULT_PER_PLAYER_CEILING_EUR = 25000;

export function isBreakdownInflated(
  breakdown:
    | Partial<Record<'winner' | 'finalist' | 'sf' | 'qf' | 'r16' | 'r32', number>>
    | null
    | undefined,
  level: string | null | undefined,
): boolean {
  if (!breakdown) return false;
  const ceiling =
    TIER_PER_PLAYER_CEILING_EUR[level ?? ''] ?? DEFAULT_PER_PLAYER_CEILING_EUR;
  const vals = [
    breakdown.winner,
    breakdown.finalist,
    breakdown.sf,
    breakdown.qf,
    breakdown.r16,
    breakdown.r32,
  ];
  return vals.some((raw) => {
    const v = typeof raw === 'string' ? Number(raw) : raw;
    return typeof v === 'number' && Number.isFinite(v) && v > ceiling;
  });
}

export function parsePrizeBreakdown(html: string): PrizeBreakdown | null {
  const rounds: Partial<Record<RoundKey, number>> = {};
  let hits = 0;

  // Layout 1 — HTML table: <th scope="row">LABEL</th><td>AMOUNT</td>
  // (Used by KL Bronze, Cyprus Silver, and most events the existing
  // enricher already covers.)
  //
  // Uses parsePrizeAmount (same as Layout 2) so the locale-aware logic
  // handles both US-style ("212.5") and European-style ("9.375" thousands,
  // "807,50" decimal) values. The earlier hand-rolled comma-strip path
  // turned "807,50" into 80750 — the ×100 corruption this module now detects.
  const tableRe =
    /<th[^>]*scope="row"[^>]*>\s*([^<]+?)\s*<\/th>\s*<td[^>]*>\s*€?\s*([0-9][\d.,]*)\s*€?\s*<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(html)) !== null) {
    const label = m[1]!.toUpperCase().replace(/\s+/g, ' ').trim();
    const key = roundLabelToKey(label);
    if (!key) continue;
    const amount = parsePrizeAmount(m[2]!);
    if (amount == null) continue;
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

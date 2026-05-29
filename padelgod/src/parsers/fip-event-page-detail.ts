// Pure parsers for FIP padelfip.com event pages. Mirrors the parsers
// that previously lived in the Vercel app's src/lib/fip-scraper.ts.
//
// The Vercel `fip-tournaments` cron has been retired in favour of
// padelgod's `fip-event-page-enricher` worker (see this directory's
// sibling). These parsers run in both places during the migration —
// padelgod for ongoing scraping, Vercel for ad-hoc admin endpoints
// (link-premier, backfill-fip-overview). Cleanup of the Vercel
// duplicate is a follow-up PR.

import { parseScheduleNotes, type RoundSchedule } from './fip-schedule-notes.js';
import { decodeHtmlEntities } from '../lib/html-entities.js';

export interface EventDates {
  startsAt: string | null; // ISO date YYYY-MM-DD
  endsAt: string | null;
}

/**
 * Read a labelled DD/MM/YYYY date from a "Tournament Structure" /
 * "Estructura del torneo" block.
 */
function findLabeledDate(html: string, label: string): string | null {
  const re = new RegExp(`${label}[^\\d]*(\\d{2})\\/(\\d{2})\\/(\\d{4})`, 'i');
  const m = re.exec(html);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo}-${d}`;
}

export function parseEventDates(html: string): EventDates {
  const dateRangeRe =
    /(\d{2})\/(\d{2})\/(\d{4})\s*[-–—]\s*(\d{2})\/(\d{2})\/(\d{4})/;
  const rangeMatch = dateRangeRe.exec(html);
  const headerStart = rangeMatch
    ? `${rangeMatch[3]}-${rangeMatch[2]}-${rangeMatch[1]}`
    : null;
  const headerEnd = rangeMatch
    ? `${rangeMatch[6]}-${rangeMatch[5]}-${rangeMatch[4]}`
    : null;

  // Prefer the page's prominent date range (the `event__date` block on
  // the FIP event header AND the meta description). That's the date
  // users see on FIP and the one they expect us to show in our
  // listings. The "Main draw" labelled date in the overview block is
  // a more specific sub-detail (the day the main-draw matches start,
  // typically one or two days after qualifying ends) — keep it as a
  // fallback for older page formats that don't expose the header
  // range cleanly.
  if (rangeMatch) {
    return { startsAt: headerStart, endsAt: headerEnd };
  }

  const mainDrawDate =
    findLabeledDate(html, 'Main\\s+draw') ??
    findLabeledDate(html, 'Cuadro\\s+principal');
  if (mainDrawDate) {
    return { startsAt: mainDrawDate, endsAt: null };
  }

  const singleRe = /(\d{2})\/(\d{2})\/(\d{4})/;
  const singleMatch = singleRe.exec(html);
  if (singleMatch) {
    const [, d, m, y] = singleMatch;
    return { startsAt: `${y}-${m}-${d}`, endsAt: null };
  }

  return { startsAt: null, endsAt: null };
}

export interface MatchscorerIds {
  year: string;
  id: string;
  totalDays: number;
  code: string; // e.g. "FIP-2025-3301", "FIP-2026-B0118"
  /**
   * Crionet matchscorerlive widget type — drives which `/screen/<widget>/`
   * URL is used downstream:
   *   - 'draw'      — Bronze/Silver/Gold/Premier (numeric eventID)
   *   - 'oopbyday'  — FIP Beyond / Promises (alphanumeric IDs like B0118)
   * Defaults to 'draw' when the page doesn't declare `const widget`.
   */
  widget: string;
}

/**
 * Extract matchscorer IDs from inline JS in event page HTML.
 *
 * Two formats observed in the wild:
 *
 *   Bronze/Silver/Gold/Premier (numeric ID + draw widget):
 *     const eventYear = "2025"
 *     const eventID   = "3301"
 *     const totalday  = 5
 *
 *   FIP Beyond / Promises (alphanumeric ID + oopbyday widget):
 *     const eventYear = "2026"
 *     const eventID   = "B0118"
 *     const widget    = 'oopbyday'
 */
export function parseMatchscorerIds(html: string): MatchscorerIds | null {
  const yearMatch = /const\s+eventYear\s*=\s*["'](\d+)["']/.exec(html);
  const idMatch = /const\s+eventID\s*=\s*["']([A-Za-z0-9]+)["']/.exec(html);
  const daysMatch = /const\s+totalday\s*=\s*(\d+)/.exec(html);
  const widgetMatch = /const\s+widget\s*=\s*["']([a-z]+)["']/.exec(html);

  if (!yearMatch || !idMatch) return null;

  const year = yearMatch[1]!;
  const id = idMatch[1]!;
  const totalDays = daysMatch ? parseInt(daysMatch[1]!, 10) : 1;
  const widget = widgetMatch ? widgetMatch[1]! : 'draw';

  return {
    year,
    id,
    totalDays,
    code: `FIP-${year}-${id}`,
    widget,
  };
}

export interface DrawSize {
  mainDraw: number | null;
  qualifyingDraw: number | null;
  prizeMoney: number | null; // euros
}

export interface OverviewFields {
  registrationStatus: string | null; // 'open' | 'closed' | 'upcoming' | …
  signupFeeEur: number | null;
  venue: string | null;
  venueAddress: string | null;
  venueType: string | null; // 'covered' | 'outdoor'
  scheduleNotes: string | null;
  roundSchedule: RoundSchedule; // empty {} when no parse
}

export interface OverviewContext {
  startsAt: string | null;
  endsAt: string | null;
  /**
   * Tournament `level` (p1 / p2 / major / finals / fip_silver / ...).
   * Used to disambiguate "1st ROUND" / "2nd ROUND" labels in the FIP
   * overview text — they're R64/R32 on Premier tiers (56-team mens MD)
   * but ambiguous on lower tiers.
   */
  level?: string | null;
}

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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

export function parseDrawSizes(html: string): DrawSize {
  // Premier event pages use a block layout under the Overview section:
  //   MAIN DRAW<br/>Men's draw size<br/>48 (41DE + 4Q + 3WC)<br/>
  //   Women's draw size<br/>40 (34DE + 4Q + 2WC)
  // We want the men's number (first "draw size" after the heading).
  //
  // The naive /Main\s*Draw[:\s]*(\d+)/ pattern was false-matching
  // "MAIN DRAW : 1st ROUND" in the Play Order block and capturing 1.
  // Anchor on the "draw size" sub-label, which only appears in the
  // overview block. Fall back to the FIP-Tour single-line format
  // ("Main draw: 32 (26DA+4Q+2WC)") if the block format isn't present.
  const mdBlock = /MAIN\s+DRAW[\s\S]{0,300}?draw\s*size[^\d]*(\d+)/i.exec(html);
  const mdLegacy = /[Mm]ain\s+[Dd]raw[:\s]+(\d+)\s*\(/.exec(html);
  const mdMatch = mdBlock ?? mdLegacy;
  const mainDraw = mdMatch ? parseInt(mdMatch[1]!, 10) : null;

  const qdBlock = /QUALIFY(?:ING|ICATION)[\s\S]{0,300}?draw\s*size[^\d]*(\d+)/i.exec(html);
  const qdLegacy = /[Qq]ualif(?:ication|ying)\s+[Dd]raw[:\s]+(\d+)\s*\(/.exec(html);
  const qdMatch = qdBlock ?? qdLegacy;
  const qualifyingDraw = qdMatch ? parseInt(qdMatch[1]!, 10) : null;

  // Labelled "Prize Money" only — both suffix and prefix € formats.
  // No unlabelled fallback (FIP Beyond pages have a Sign Up Fee that
  // would otherwise leak through).
  let prizeMoney: number | null = null;
  const labeledSuffix = /Prize\s*Money[^\d]*(\d[\d.,]*)\s*€/i;
  const labeledPrefix = /Prize\s*Money[^€]*€\s*(\d[\d.,]*)/i;
  const prizeMatch = labeledSuffix.exec(html) ?? labeledPrefix.exec(html);
  if (prizeMatch) {
    const cleaned = prizeMatch[1]!.replace(/[.,]/g, '');
    const val = parseInt(cleaned, 10);
    if (val > 0 && val < 10_000_000) prizeMoney = val;
  }

  return { mainDraw, qualifyingDraw, prizeMoney };
}

function findOverviewValue(html: string, label: string): string | null {
  const labelEsc = escapeRegex(label);
  const re = new RegExp(
    `overview__title[^>]*>\\s*${labelEsc}\\s*:?\\s*<\\/span>[\\s\\S]{0,800}?overview__text[^>]*>([\\s\\S]*?)<\\/(?:p|div)>`,
    'i',
  );
  const m = re.exec(html);
  if (!m) return null;
  const text = decodeHtmlEntities(stripTags(m[1]!)).replace(/\s+/g, ' ').trim();
  return text || null;
}

export function parseOverviewFields(html: string, ctx?: OverviewContext): OverviewFields {
  const regRe = /overview__title[^>]*>\s*Registration\s+([A-Za-z]+)\s*<\/span>/i;
  const regMatch = regRe.exec(html);
  const registrationStatus = regMatch ? regMatch[1]!.toLowerCase() : null;

  const feeText = findOverviewValue(html, 'Sign Up Fee');
  let signupFeeEur: number | null = null;
  if (feeText) {
    const m = /(\d[\d.,]*)/.exec(feeText);
    if (m) {
      const cleaned = m[1]!.replace(/[.,]/g, '');
      const val = parseInt(cleaned, 10);
      if (val >= 0 && val < 10_000) signupFeeEur = val;
    }
  }

  const courtRaw = findOverviewValue(html, 'Court conditions');
  const venueType = courtRaw ? courtRaw.toLowerCase() : null;
  const venue = findOverviewValue(html, 'Venue');
  const venueAddress = findOverviewValue(html, 'Address');

  const playOrderRe =
    /overview__title[^>]*>\s*Play\s*Order\s*:?\s*<\/span>[\s\S]{0,400}?overview__listText[^>]*>([\s\S]*?)<\/div>/i;
  const playMatch = playOrderRe.exec(html);
  let scheduleNotes: string | null = null;
  if (playMatch) {
    const withBreaks = playMatch[1]!.replace(/<br\s*\/?>/gi, '\n');
    scheduleNotes =
      decodeHtmlEntities(stripTags(withBreaks))
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join('\n') || null;
  }

  const roundSchedule: RoundSchedule =
    scheduleNotes && ctx?.startsAt && ctx?.endsAt
      ? parseScheduleNotes(scheduleNotes, ctx.startsAt, ctx.endsAt, { level: ctx.level })
      : {};

  return {
    registrationStatus,
    signupFeeEur,
    venue,
    venueAddress,
    venueType,
    scheduleNotes,
    roundSchedule,
  };
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
 * Parse a single numeric amount from raw text. Handles:
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
 * Padel prize amounts never use 1-digit thousands grouping, so 1
 * trailing digit unambiguously means decimal. 3 trailing digits is
 * ambiguous in principle (`1.234` could be 1.234 or 1234) but in the
 * FIP HTML it's always thousands — a per-player payout of `1.234€`
 * doesn't exist.
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
      // decimal. Strip every OTHER separator, then convert the decimal
      // to '.'.
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

export function parsePrizeBreakdown(html: string): PrizeBreakdown | null {
  const rounds: Partial<Record<RoundKey, number>> = {};
  let hits = 0;

  // Layout 1 — HTML table: <th scope="row">LABEL</th><td>AMOUNT</td>
  // (Used by KL Bronze, Cyprus Silver, FIP Platinum Albania, and most
  // events the existing enricher already covers.)
  //
  // Uses parsePrizeAmount (same as Layout 2 below) so the locale-aware
  // logic handles both US-style ("212.5") and European-style
  // ("9.375" thousands, "421,88" decimal) values. The earlier
  // hand-rolled strip-comma path broke Albania's mixed European table
  // (winner 9.375 → 9.38, r32 421,88 → 42188).
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

/**
 * Extract the factsheet PDF URL from an event page. FIP links a downloadable
 * factsheet on most Platinum/Major/Premier events — a 2-4 page PDF with
 * prize money breakdown, daily schedule, points table, sponsor list, venue
 * address, etc. Used by the factsheet-processor cron to feed Claude.
 *
 * URL pattern observed:
 *   https://www.padelfip.com/wp-content/uploads/YYYY/MM/[SLUG]_FACTSHEET[-N].pdf
 *
 * Match anything in `wp-content/uploads/` ending in `.pdf` and containing
 * "factsheet" (case-insensitive). If multiple match, prefer the most recent
 * year/month folder (handles re-uploaded factsheets keeping older copies).
 */
export function parseFactsheetUrl(html: string): string | null {
  const re = /https?:\/\/[^\s"'<>]*?wp-content\/uploads\/[^\s"'<>]*?factsheet[^\s"'<>]*?\.pdf/gi;
  const matches = html.match(re);
  if (!matches || matches.length === 0) return null;
  // Newest year/month wins on duplicates. The path component is /YYYY/MM/
  // — sort lexicographically descending picks the most recent.
  const sorted = [...new Set(matches)].sort((a, b) => {
    const aDate = a.match(/uploads\/(\d{4})\/(\d{2})\//);
    const bDate = b.match(/uploads\/(\d{4})\/(\d{2})\//);
    const aKey = aDate ? `${aDate[1] ?? ''}${aDate[2] ?? ''}` : '';
    const bKey = bDate ? `${bDate[1] ?? ''}${bDate[2] ?? ''}` : '';
    return bKey.localeCompare(aKey);
  });
  return sorted[0] ?? null;
}

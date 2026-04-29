// Pure parsers for FIP padelfip.com event pages. Mirrors the parsers
// that previously lived in the Vercel app's src/lib/fip-scraper.ts.
//
// The Vercel `fip-tournaments` cron has been retired in favour of
// padelgod's `fip-event-page-enricher` worker (see this directory's
// sibling). These parsers run in both places during the migration —
// padelgod for ongoing scraping, Vercel for ad-hoc admin endpoints
// (link-premier, backfill-fip-overview). Cleanup of the Vercel
// duplicate is a follow-up PR.

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

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&apos;/g, "'");
}

export function parseDrawSizes(html: string): DrawSize {
  const mdMatch = /[Mm]ain\s*[Dd]raw[:\s]*(\d+)/i.exec(html);
  const mainDraw = mdMatch ? parseInt(mdMatch[1]!, 10) : null;

  const qdMatch = /[Qq]ualif(?:ication|ying)\s*[Dd]raw[:\s]*(\d+)/i.exec(html);
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

export function parseOverviewFields(html: string): OverviewFields {
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

  return {
    registrationStatus,
    signupFeeEur,
    venue,
    venueAddress,
    venueType,
    scheduleNotes,
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

export function parsePrizeBreakdown(html: string): PrizeBreakdown | null {
  const rowRe =
    /<th[^>]*scope="row"[^>]*>\s*([^<]+?)\s*<\/th>\s*<td[^>]*>\s*€?\s*([0-9][\d.,]*)\s*€?\s*<\/td>/gi;

  const rounds: Partial<Record<RoundKey, number>> = {};
  let hits = 0;

  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const label = m[1]!.toUpperCase().replace(/\s+/g, ' ').trim();
    const key = roundLabelToKey(label);
    if (!key) continue;
    const raw = m[2]!.replace(/,/g, '');
    const amount = Number.parseFloat(raw);
    if (!Number.isFinite(amount) || amount < 0) continue;
    rounds[key] = Math.round(amount * 100) / 100;
    hits++;
  }

  if (hits === 0) return null;
  return { ...rounds, currency: 'EUR', per: 'player', source: 'scraped' };
}

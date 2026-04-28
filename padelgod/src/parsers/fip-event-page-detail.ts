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

  const mainDrawDate =
    findLabeledDate(html, 'Main\\s+draw') ??
    findLabeledDate(html, 'Cuadro\\s+principal');

  if (mainDrawDate) {
    return { startsAt: mainDrawDate, endsAt: headerEnd };
  }

  if (rangeMatch) {
    return { startsAt: headerStart, endsAt: headerEnd };
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

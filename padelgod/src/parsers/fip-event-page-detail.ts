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

/**
 * Per-round schedule extracted from a FIP tournament's `schedule_notes`
 * (free-text "Play Order" block from the overview page). Rendered as
 * placeholder tabs on the tournament detail page when a round has dates
 * but no match data yet.
 *
 * Single ISO date per round key; missing rounds are absent (not null).
 * When the source has different qualifying dates for men/women (Premier),
 * the parser stores the earliest.
 */
export type RoundKey = 'q1' | 'q2' | 'q3' | 'r64' | 'r32' | 'r16' | 'qf' | 'sf' | 'f';
export type RoundSchedule = Partial<Record<RoundKey, string>>;

const DAY_NAMES: Record<string, number> = {
  // English
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  // Spanish
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, miércoles: 3, jueves: 4, viernes: 5, sabado: 6, sábado: 6,
  // Portuguese (segunda/terça/etc.; full "segunda-feira" forms also accepted)
  segunda: 1, 'segunda-feira': 1, terca: 2, terça: 2, 'terca-feira': 2, 'terça-feira': 2,
  quarta: 3, 'quarta-feira': 3, quinta: 4, 'quinta-feira': 4, sexta: 5, 'sexta-feira': 5,
  // Italian
  domenica: 0, lunedi: 1, lunedì: 1, martedi: 2, martedì: 2, mercoledi: 3, mercoledì: 3,
  giovedi: 4, giovedì: 4, venerdi: 5, venerdì: 5,
  // French
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
  // Saturday — Spanish/Italian/Portuguese share spellings (sabado/sabato),
  // mapped to the same numeric value; Italian "sabato" listed explicitly
  // to make multilingual coverage visible.
  sabato: 6,
};

// English month names only — Strategy 1 targets Premier P1/P2/Major schedule_notes
// which are always in English. FIP Bronze/Silver/Gold/Platinum events using
// other languages are covered by Strategy 2's day-of-week resolver, which
// runs against the same notes string and doesn't need month names.
const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
  oct: 10, nov: 11, dec: 12,
};

/** Build an ISO date string from year+month+day, rolling month=13 to year+1. */
function buildIsoDate(year: number, month: number, day: number): string {
  const adjustedYear = year + Math.floor((month - 1) / 12);
  const adjustedMonth = ((month - 1) % 12) + 1;
  return `${adjustedYear}-${String(adjustedMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Resolve a "(D)D Month" string against a tournament range. Picks the
 * year so the resulting date falls inside [startsAt, endsAt]; if both
 * candidate years would land outside the range we drop the entry.
 */
function resolveDateInRange(
  dayNum: number,
  monthName: string,
  startsAt: string,
  endsAt: string,
): string | null {
  const month = MONTHS[monthName.toLowerCase()];
  if (!month || dayNum < 1 || dayNum > 31) return null;
  const startYear = parseInt(startsAt.slice(0, 4), 10);
  const candidates = [startYear, startYear + 1];
  for (const y of candidates) {
    const iso = `${y}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    if (iso >= startsAt && iso <= endsAt) return iso;
  }
  // Out of range — drop the entry rather than emit an obviously-wrong date.
  // Better to have a missing key (handled gracefully by the placeholder UI)
  // than a December final on a May tournament.
  return null;
}

function labelToKey(label: string): RoundKey | null {
  const u = label.toUpperCase();
  if (u.includes('ROUND OF 64')) return 'r64';
  if (u.includes('ROUND OF 32')) return 'r32';
  if (u.includes('ROUND OF 16')) return 'r16';
  if (u.includes('QUARTER')) return 'qf';
  if (u.includes('SEMI')) return 'sf';
  if (u.includes('FINAL')) return 'f';
  return null;
}

/** Strategy 1: Premier "MAIN DRAW : <FULL ROUND NAME>" blocks. */
function parsePremierBlocks(
  notes: string,
  startsAt: string,
  endsAt: string,
): RoundSchedule {
  const out: RoundSchedule = {};
  // Match a label line followed by a date line. The label is anchored to
  // start-of-line OR after a previous newline; the date line picks up the
  // first "<day> <Month>" pattern within the next 200 chars.
  const re =
    /(MAIN DRAW\s*:?\s*(?:ROUND OF 64|ROUND OF 32|ROUND OF 16|QUARTER-FINALS?|SEMI-FINALS?|FINALS?|1st ROUND|2nd ROUND|3rd ROUND))[\s\S]{0,200}?(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/gi;
  for (const m of notes.matchAll(re)) {
    const label = m[1]!.toUpperCase();
    const dayNum = parseInt(m[2]!, 10);
    const monthName = m[3]!;
    const iso = resolveDateInRange(dayNum, monthName, startsAt, endsAt);
    if (!iso) continue;
    const key = labelToKey(label);
    if (key && !(key in out)) out[key] = iso;
  }

  // Qualifying lines: "Q1 Sun 3 Start time : ..." — capture the day number,
  // then resolve via day-of-week + range.
  const qualRe = /\b(Q[123])\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+(\d{1,2})\b/gi;
  // For Q lines we don't always know the month from the line itself; use
  // the most-recently-seen month above OR fall back to startsAt's month.
  const startYear = parseInt(startsAt.slice(0, 4), 10);
  const startMonth = parseInt(startsAt.slice(5, 7), 10);
  for (const m of notes.matchAll(qualRe)) {
    const qKey = m[1]!.toLowerCase() as RoundKey;
    const dayNum = parseInt(m[2]!, 10);
    // Try same month as startsAt, then next month (buildIsoDate handles Dec→Jan rollover)
    const candidates = [
      buildIsoDate(startYear, startMonth, dayNum),
      buildIsoDate(startYear, startMonth + 1, dayNum),
    ];
    for (const iso of candidates) {
      if (iso >= startsAt && iso <= endsAt) {
        // Earliest wins (men's qualifying typically comes before women's)
        if (!(qKey in out) || iso < out[qKey]!) out[qKey] = iso;
        break;
      }
    }
  }
  return out;
}

/**
 * Parse a tournament's `schedule_notes` into a structured per-round map.
 *
 * Tries three strategies in order, merging results. Later strategies
 * override earlier ones on conflict.
 *   1. Premier "MAIN DRAW : ROUND OF 16" full-name blocks.
 *   2. (Task 4) Day-of-week phrases — "Sunday – SF and Finals MD".
 *   3. (Task 5) Final-date override — "Date Finals: 22/03/2026".
 *
 * Pure: no I/O, no DB. Returns {} for null/empty input.
 */
export function parseScheduleNotes(
  notes: string | null,
  startsAt: string,
  endsAt: string,
): RoundSchedule {
  if (!notes) return {};
  const result: RoundSchedule = {};
  Object.assign(result, parsePremierBlocks(notes, startsAt, endsAt));
  return result;
}

/**
 * Returns the first ISO date in [startsAt, endsAt] (inclusive) whose
 * weekday matches `dayName`. Day names are matched case-insensitively
 * across en/es/pt/it/fr. Returns null when the day name is unknown or
 * the range contains no matching weekday.
 */
export function resolveDayOfWeek(
  dayName: string,
  startsAt: string,
  endsAt: string,
): string | null {
  const key = dayName.trim().toLowerCase();
  if (!(key in DAY_NAMES)) return null;
  const target = DAY_NAMES[key];
  const start = new Date(`${startsAt}T00:00:00Z`);
  const end = new Date(`${endsAt}T00:00:00Z`);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() === target) {
      return d.toISOString().slice(0, 10);
    }
  }
  return null;
}

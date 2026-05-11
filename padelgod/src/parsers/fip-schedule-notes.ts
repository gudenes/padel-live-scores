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
  // Portuguese — short forms only; the line regex strips at the hyphen
  // so "quinta-feira" matches as "quinta" via this entry.
  segunda: 1, terca: 2, terça: 2, quarta: 3, quinta: 4, sexta: 5,
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

// Premier tiers (p1/p2/major/finals) always use a 56-team men's main
// draw, so "1st ROUND" is unambiguously R64. But "2nd ROUND" varies by
// event layout in the FIP overview text:
//   - 3-day layout (Buenos Aires P1 2026): "1st ROUND" + "2nd ROUND" +
//     explicit "ROUND OF 16" → 1st=R64, 2nd=R32, R16 explicit.
//   - 2-day layout (Asuncion P2 2025, Brussels P2): "1st ROUND" spans
//     two days (R64+R32 combined) and "2nd ROUND" = R16. No "ROUND OF
//     16" label appears. Without disambiguation we'd write r32 on the
//     R16 day, which is worse than leaving r32 unset.
//   - "Combined-ROUND OF 16" layout (Newgiza, Gijón): "1st ROUND" spans
//     two days + "ROUND OF 16" explicit + no "2nd ROUND".
// Layout is detected by which OTHER labels appear in the same notes.
// FIP Bronze/Silver/Gold/Platinum vary in draw size — stay ambiguous.
const PREMIER_LEVELS = new Set(['p1', 'p2', 'major', 'finals']);

interface PremierLayout {
  hasSecondRound: boolean;
  hasRoundOf16: boolean;
}

function detectPremierLayout(notes: string): PremierLayout {
  const u = notes.toUpperCase();
  return {
    hasSecondRound: /\b2ND\s+ROUND\b/.test(u),
    hasRoundOf16: /\bROUND\s+OF\s+16\b/.test(u),
  };
}

function labelToKey(
  label: string,
  level?: string | null,
  layout?: PremierLayout,
): RoundKey | null {
  const u = label.toUpperCase();
  if (u.includes('ROUND OF 64')) return 'r64';
  if (u.includes('ROUND OF 32')) return 'r32';
  if (u.includes('ROUND OF 16')) return 'r16';
  if (u.includes('QUARTER')) return 'qf';
  if (u.includes('SEMI')) return 'sf';
  if (u.includes('FINAL')) return 'f';
  if (level && PREMIER_LEVELS.has(level)) {
    if (/\b1ST\s+ROUND\b/.test(u)) return 'r64';
    if (/\b2ND\s+ROUND\b/.test(u)) {
      // 3-day layout: explicit ROUND OF 16 means 2nd ROUND is R32.
      // 2-day layout: no ROUND OF 16 → 2nd ROUND is R16.
      return layout?.hasRoundOf16 ? 'r32' : 'r16';
    }
    // "3rd ROUND" only meaningful if the schedule has 4 distinct MD
    // pre-QF days (R64/R32/R16/...) — the only such layout puts R16 here.
    if (/\b3RD\s+ROUND\b/.test(u)) return 'r16';
  }
  return null;
}

/** Strategy 1: Premier "MAIN DRAW : <FULL ROUND NAME>" blocks. */
function parsePremierBlocks(
  notes: string,
  startsAt: string,
  endsAt: string,
  level?: string | null,
): RoundSchedule {
  const out: RoundSchedule = {};
  const layout = detectPremierLayout(notes);
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
    const key = labelToKey(label, level, layout);
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

/** Strategy 2: day-of-week phrases like "Sunday – SF and Finals MD". */
function parseDayOfWeekLines(
  notes: string,
  startsAt: string,
  endsAt: string,
): RoundSchedule {
  const out: RoundSchedule = {};
  // Match each line that starts with a day name (after optional bullet
  // markers like "*", "-", whitespace) and capture the description after
  // the dash/colon.
  const lineRe =
    /^[\s*\-•·]*([A-Za-zçéëèêîïôûáàèéíìóòúù]+)\s*(?:[-–—:]+)\s*(.+)$/gm;
  for (const m of notes.matchAll(lineRe)) {
    const dayName = m[1]!;
    const desc = m[2]!.toLowerCase();
    const date = resolveDayOfWeek(dayName, startsAt, endsAt);
    if (!date) continue;

    // Map descriptions to round keys. Combined phrases ("SF and Finals",
    // "QF and SF", "2nd and 3rd round qualy") emit multiple keys.
    const keys = descriptionToKeys(desc);
    for (const k of keys) {
      // Earliest-wins on conflict (consistent with Q1 men/women rule).
      if (!(k in out) || date < out[k]!) out[k] = date;
    }
  }
  return out;
}

/**
 * Map a free-text description of a tournament day's matches to round keys.
 * Conservative — only emits keys for unambiguously named rounds.
 *   Quarterfinals / Quarter Finals / QF      → qf
 *   Semifinals / Semi Finals / SF            → sf
 *   Finals / Final / F                       → f
 *   1st (round of) Qualy / Q1                → q1   (and q2/q3)
 * Combined phrases ("SF and Finals", "QF and SF", "2nd and 3rd qualy")
 * emit multiple keys.
 *
 * Round labels are ENGLISH-ONLY. Real-world FIP overview text uses English
 * round names even on Spanish/Italian/Portuguese-language tournaments
 * (e.g. FIP Silver Mediolanum's notes say "Quarterfinals" / "Semifinals
 * and Finals" despite being an Italian event). The connector set
 * `(and|y|e|et|&)` IS multilingual to handle hybrid phrasings like
 * "Semifinales and Finals" — but the round-name vocabulary itself is not.
 *
 * Deliberately NOT mapped: "1st round MD" / "2nd round MD" — ambiguous
 * on draw size (R32 in 32-draw, R16 in 16-draw). See spec §Risks.
 */
function descriptionToKeys(desc: string): RoundKey[] {
  const keys = new Set<RoundKey>();
  const lc = desc;

  // Order matters: check combined phrases first.
  if (/(?:semi[-\s]?final[s]?|sf)\s*(?:and|y|e|et|&)\s*final[s]?/i.test(lc)) {
    keys.add('sf');
    keys.add('f');
  } else if (/(?:quarter[-\s]?final[s]?|qf)\s*(?:and|y|e|et|&)\s*(?:semi[-\s]?final[s]?|sf)/i.test(lc)) {
    keys.add('qf');
    keys.add('sf');
  } else {
    if (/\b(?:quarter[-\s]?final[s]?|qf|1\/4)\b/i.test(lc)) keys.add('qf');
    if (/\b(?:semi[-\s]?final[s]?|sf|1\/2)\b/i.test(lc)) keys.add('sf');
    if (/\b(?:final[s]?|^f$)\b/i.test(lc) && !/(semi|quarter)/i.test(lc)) keys.add('f');
  }

  // Qualifying — handle "1st round qualification", "2nd and 3rd round qualy", "Q1", etc.
  // Note: no trailing \b after "qual" prefix — "qual" is a prefix that matches
  // "qualy", "qualification", etc. Word boundary only at the start.
  if (/\b(?:1st\s+(?:round\s+)?qual|q1\b|1st\s+qualy\b)/i.test(lc)) keys.add('q1');
  if (/\b(?:2nd\s+(?:round\s+)?qual|q2\b|2nd\s+qualy\b)/i.test(lc)) keys.add('q2');
  if (/\b(?:3rd\s+(?:round\s+)?qual|q3\b|3rd\s+qualy\b|final\s+round\s+qual)/i.test(lc)) keys.add('q3');
  // Combined: "2nd and 3rd round qualification" — emit both
  if (/\b2nd\s+and\s+3rd\s+(?:round\s+)?qual/i.test(lc)) {
    keys.add('q2');
    keys.add('q3');
  }
  return [...keys];
}

/** Strategy 3: explicit "Date Finals: DD/MM/YYYY" override. */
function parseDateFinals(notes: string): string | null {
  const m = /Date\s+Finals\s*:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(notes);
  if (!m) return null;
  const dd = m[1]!.padStart(2, '0');
  const mm = m[2]!.padStart(2, '0');
  const yyyy = m[3]!;
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Parse a tournament's `schedule_notes` into a structured per-round map.
 *
 * Tries three strategies in order, merging results. Later strategies
 * override earlier ones on conflict.
 *   1. Premier "MAIN DRAW : ROUND OF 16" full-name blocks.
 *   2. Day-of-week phrases — "Sunday – SF and Finals MD".
 *   3. Final-date override — "Date Finals: 22/03/2026".
 *
 * Pure: no I/O, no DB. Returns {} for null/empty input.
 */
export function parseScheduleNotes(
  notes: string | null,
  startsAt: string,
  endsAt: string,
  opts?: { level?: string | null },
): RoundSchedule {
  if (!notes) return {};
  // Defensive: callers may pass full ISO timestamps ("2026-05-03T00:00:00+00:00")
  // instead of date-only strings ("2026-05-03"). String comparisons in the
  // helpers below assume the date-only form — slice to 10 chars to normalize.
  // Without this, '2026-05-03' >= '2026-05-03T...' is FALSE (shorter string
  // with same prefix loses), and tournament-first-day dates get dropped.
  const start = startsAt.slice(0, 10);
  const end = endsAt.slice(0, 10);
  const result: RoundSchedule = {};
  Object.assign(result, parsePremierBlocks(notes, start, end, opts?.level));
  Object.assign(result, parseDayOfWeekLines(notes, start, end));
  // Strategy 3: explicit Date Finals overrides whatever strategies 1/2 set.
  const finals = parseDateFinals(notes);
  if (finals) result.f = finals;
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
  // Slice to YYYY-MM-DD; tolerate full ISO timestamps from callers.
  const start = new Date(`${startsAt.slice(0, 10)}T00:00:00Z`);
  const end = new Date(`${endsAt.slice(0, 10)}T00:00:00Z`);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() === target) {
      return d.toISOString().slice(0, 10);
    }
  }
  return null;
}

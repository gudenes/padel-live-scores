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

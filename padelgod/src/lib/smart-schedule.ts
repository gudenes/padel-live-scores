/** Court order is independent of category and UI filters. Estimates never change scheduled_at. */
export interface ScheduleSet { set_number: number; pair1_games: number | null; pair2_games: number | null; is_current: boolean; updated_at?: string; games?: { updated_at: string }[] }
export interface ScheduleMatch {
  id: string; tournament_id: string; court: string | null; court_order: number | null;
  status: string; scheduled_at: string | null; started_at: string | null;
  finished_at: string | null; duration: string | null; schedule_label: string | null;
  category?: string | null; updated_at: string; sets: ScheduleSet[] | null;
  tournament: { timezone: string | null } | null;
}
export interface ScheduleForecast {
  version: 1; next_to_play: boolean; predecessor_id: string | null;
  earliest_at: string | null; latest_at: string | null;
  computed_at: string; source_updated_at: string | null;
  basis: 'live_progress' | 'observed_finish' | 'court_order';
}
const MINUTE = 60_000;
export const SIGNAL_MAX_AGE_MS = 5 * MINUTE;
const terminal = new Set(['finished', 'retired', 'walkover', 'cancelled', 'ended', 'bye']);
export function durationMinutes(value: string | null): number | null {
  const m = value?.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[2]) > 59) return null;
  const n = Number(m[1]) * 60 + Number(m[2]);
  return n > 0 && n <= 240 ? n : null;
}
function dateMs(value: string | null): number | null {
  const n = value ? Date.parse(value) : NaN;
  return Number.isFinite(n) ? n : null;
}
export function localPlayDay(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
function winner(a: number, b: number): number {
  return (a >= 6 || b >= 6) && (Math.abs(a - b) >= 2 || Math.max(a, b) === 7) ? (a > b ? 1 : 2) : 0;
}
function validSets(sets: ScheduleSet[]): boolean {
  const numbers = new Set<number>();
  return sets.length > 0 && sets.length <= 3 && sets.every((s) => {
    if (numbers.has(s.set_number)) return false;
    numbers.add(s.set_number);
    return Number.isInteger(s.set_number) && s.set_number >= 1 && s.set_number <= 3 &&
      [s.pair1_games, s.pair2_games].every((n) => n !== null && Number.isInteger(n) && n >= 0 && n <= 7) &&
      !(s.pair1_games === 7 && s.pair2_games === 7);
  }) && [...numbers].sort().every((n, i) => n === i + 1);
}
function quantile(values: number[], q: number): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * q)]!;
}
/** Learn pace only from observed finished matches, never placeholder finished_at values. */
export function historicalPace(matches: ScheduleMatch[], category?: string | null): number[] {
  return matches.filter((m) => m.status === 'finished' && m.started_at && (!category || m.category === category))
    .flatMap((m) => {
      const minutes = durationMinutes(m.duration);
      const sets = m.sets ?? [];
      if (!minutes || !validSets(sets) || !sets.every((s) => winner(s.pair1_games!, s.pair2_games!))) return [];
      const winners = sets.map((s) => winner(s.pair1_games!, s.pair2_games!));
      if (![1, 2].some((pair) => winners.filter((w) => w === pair).length === 2)) return [];
      const games = sets.reduce((n, s) => n + s.pair1_games! + s.pair2_games!, 0);
      const pace = minutes / games;
      return pace >= 1 && pace <= 8 ? [pace] : [];
    });
}
/** Deterministic best-of-three game simulation, preserving the observed set scores.
 * Equal game-win odds deliberately avoid coupling scheduling to our betting model.
 * The resulting window is a heuristic, not a calibrated probability interval.
 */
export function remainingMinutes(match: ScheduleMatch, history: ScheduleMatch[]): [number, number] | null {
  const sets = (match.sets ?? []).slice().sort((a, b) => a.set_number - b.set_number);
  const elapsed = durationMinutes(match.duration);
  if (!elapsed || !validSets(sets) || sets.filter((s) => s.is_current).length !== 1) return null;
  const current = sets.find((s) => s.is_current)!;
  if (current !== sets[sets.length - 1] || winner(current.pair1_games!, current.pair2_games!)) return null;
  let wins1 = 0, wins2 = 0;
  for (const s of sets.filter((s) => !s.is_current)) {
    const w = winner(s.pair1_games!, s.pair2_games!);
    if (!w) return null;
    if (w === 1) wins1++; else wins2++;
  }
  if (wins1 >= 2 || wins2 >= 2) return null;
  const played = sets.reduce((n, s) => n + s.pair1_games! + s.pair2_games!, 0);
  const categoryPace = historicalPace(history, match.category);
  const allPace = categoryPace.length >= 20 ? categoryPace : historicalPace(history);
  const base = allPace.length >= 20 ? quantile(allPace, .5) : 3.5;
  const observed = played >= 4 ? Math.min(8, Math.max(1, elapsed / played)) : base;
  const pace = base * .5 + observed * .5;
  let seed = 12345;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const samples: number[] = [];
  for (let i = 0; i < 512; i++) {
    let a = current.pair1_games!, b = current.pair2_games!, x = wins1, y = wins2, games = 0;
    while (x < 2 && y < 2 && games < 40) {
      if (random() < .5) a++; else b++;
      games++;
      const w = winner(a, b);
      if (w) { if (w === 1) x++; else y++; a = 0; b = 0; }
    }
    samples.push(games * pace);
  }
  const uncertainty = allPace.length >= 20 ? 5 : 15;
  return [Math.max(5, quantile(samples, .15) - uncertainty), quantile(samples, .85) + uncertainty];
}
function queuedDuration(history: ScheduleMatch[], category?: string | null): [number, number] {
  const eligible = history.filter((m) => historicalPace([m]).length > 0);
  const categoryRows = eligible.filter((m) => category && m.category === category);
  const durations = (categoryRows.length >= 20 ? categoryRows : eligible).map((m) => durationMinutes(m.duration)!);
  return durations.length >= 20 ? [quantile(durations, .15), quantile(durations, .85)] : [60, 120];
}
function observedEnd(match: ScheduleMatch): number | null {
  if (match.status !== 'finished' && match.status !== 'retired') return null;
  const start = dateMs(match.started_at), duration = durationMinutes(match.duration);
  return start !== null && duration !== null ? start + duration * MINUTE : null;
}
/** Null results explicitly clear old badges after court/status/order changes. */
export function computeSmartSchedule(rows: ScheduleMatch[], history: ScheduleMatch[], now: Date): Map<string, ScheduleForecast | null> {
  const out = new Map<string, ScheduleForecast | null>(rows.map((r) => [r.id, null]));
  const groups = new Map<string, ScheduleMatch[]>();
  const nowMs = now.getTime();
  for (const r of rows) {
    if (!r.court?.trim() || r.court_order === null || r.court_order < 1 || !r.scheduled_at) continue;
    try {
      const tz = r.tournament?.timezone;
      if (!tz) continue;
      const day = localPlayDay(r.scheduled_at, tz);
      if (day !== localPlayDay(now.toISOString(), tz)) continue;
      const key = `${r.tournament_id}:${r.court.trim().toLowerCase()}:${day}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    } catch { /* Invalid timezone/date: retain null, never guess UTC. */ }
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.court_order! - b.court_order!);
    // A missing order on any other row makes this court's queue ambiguous.
    if (rows.some((r) => r.tournament_id === group[0]!.tournament_id && r.court?.trim().toLowerCase() === group[0]!.court!.trim().toLowerCase() && !terminal.has(r.status) &&
      (r.court_order === null || !r.scheduled_at || ((r.status === 'live' || r.status === 'on_court') && !group.includes(r))))) continue;
    if (new Set(group.map((m) => m.court_order)).size !== group.length || group.some((m) => m.status === 'suspended')) continue;
    const active = group.filter((m) => m.status === 'live' || m.status === 'on_court');
    if (active.length > 1) continue;
    const next = group.find((m) => !terminal.has(m.status) && m.status !== 'live' && m.status !== 'on_court');
    if (!next || next.status !== 'scheduled' || (active[0] && active[0].court_order! > next.court_order!)) continue;
    let end: [number, number] | null = null;
    let basis: ScheduleForecast['basis'] = 'court_order';
    let signal: string | null = null;
    for (let i = 0; i < group.length; i++) {
      const m = group[i]!, prev = group.slice(0, i).reverse().find((p) => !['walkover', 'cancelled', 'bye'].includes(p.status));
      if (m.status === 'live') {
        // Match.updated_at also changes when forecasts are written; score freshness must
        // come from score rows so this worker cannot make a stalled feed look fresh.
        const updates = (m.sets ?? []).flatMap((s) => [s.updated_at ?? null, ...(s.games ?? []).map((g) => g.updated_at)]).map(dateMs).filter((n): n is number => n !== null);
        const updated = updates.length ? Math.max(...updates) : null;
        const remaining = updated !== null && nowMs - updated <= SIGNAL_MAX_AGE_MS && updated <= nowMs ? remainingMinutes(m, history) : null;
        // Counter corresponds to the observation time, not the worker time.
        end = remaining && updated !== null ? [Math.max(nowMs, updated + remaining[0] * MINUTE), Math.max(nowMs, updated + remaining[1] * MINUTE)] : null;
        basis = end ? 'live_progress' : 'court_order'; signal = end && updated !== null ? new Date(updated).toISOString() : null;
      } else if (terminal.has(m.status)) {
        // A skipped match consumes neither playing time nor another changeover.
        if (['walkover', 'cancelled', 'bye'].includes(m.status)) continue;
        const observed = observedEnd(m);
        end = observed !== null && observed <= nowMs && nowMs - observed <= 60 * MINUTE ? [observed, observed] : null;
        basis = end ? 'observed_finish' : 'court_order'; signal = end ? m.updated_at : null;
      } else if (m.status === 'scheduled') {
        const floor = /not before|starting at/i.test(m.schedule_label ?? '') ? dateMs(m.scheduled_at) : null;
        // Propagate the window through the queue; later cards display only its early edge.
        const start: [number, number] | null = end ? [Math.max(nowMs + 5 * MINUTE, end[0] + 10 * MINUTE, floor ?? 0), Math.max(nowMs + 10 * MINUTE, end[1] + 20 * MINUTE, floor ?? 0)] : null;
        const round = (ms: number) => new Date(Math.ceil(ms / (5 * MINUTE)) * 5 * MINUTE).toISOString();
        out.set(m.id, { version: 1, next_to_play: m.id === next.id, predecessor_id: prev?.id ?? null,
          earliest_at: start ? round(start[0]) : null, latest_at: start ? round(start[1]) : null,
          computed_at: now.toISOString(), source_updated_at: signal, basis });
        // Later slots have wider uncertainty; no fabricated precision from missing live data.
        const duration = queuedDuration(history, m.category);
        end = start ? [start[0] + duration[0] * MINUTE, start[1] + duration[1] * MINUTE] : null;
      } else { end = null; basis = 'court_order'; signal = null; }
    }
  }
  return out;
}

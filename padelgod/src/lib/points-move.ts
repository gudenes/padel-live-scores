/** Week-over-week FIP points delta. Null means "no previous week" (UI shows --). */

export function computePointsMove(
  currentPoints: number,
  previousPoints: number | null | undefined,
): number | null {
  if (previousPoints == null) return null;
  return currentPoints - previousPoints;
}

export function isoYearWeek(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const diff = (date.getTime() - firstThursday.getTime()) / 86400000;
  const week = 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return { year: date.getUTCFullYear(), week };
}

/** ISO week immediately before `year`/`week`. Wraps at year boundaries. */
export function previousIsoYearWeek(year: number, week: number): { year: number; week: number } {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Day);
  const thisMonday = new Date(week1Monday);
  thisMonday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  const prevMonday = new Date(thisMonday);
  prevMonday.setUTCDate(thisMonday.getUTCDate() - 7);
  return isoYearWeek(prevMonday);
}

export function rankingDateKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return iso.slice(0, 10);
}

/**
 * Previous-week points used to compute the delta.
 * Snapshot of last ISO week wins. Live `players.points` is only a fallback
 * when the ranking publish date actually changed — otherwise a same-week
 * re-run would compare this week's already-written points against itself
 * and zero the chip.
 */
export function resolvePreviousPoints(opts: {
  snapshotPoints: number | null | undefined;
  currentPlayerPoints: number | null | undefined;
  currentRankingDate: string | null | undefined;
  newRankingDate: string;
}): number | null {
  if (opts.snapshotPoints != null) return opts.snapshotPoints;
  if (opts.currentPlayerPoints == null) return null;
  const prevKey = rankingDateKey(opts.currentRankingDate);
  const nextKey = rankingDateKey(opts.newRankingDate);
  if (prevKey && nextKey && prevKey === nextKey) return null;
  return opts.currentPlayerPoints;
}

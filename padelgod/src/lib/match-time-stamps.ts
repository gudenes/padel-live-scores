/**
 * match-time-stamps — pure helpers for computing started_at / duration string
 * values padelgod writes to `public.matches`.
 *
 * These are kept pure (no I/O, no Date.now) so they can be unit-tested with
 * a deterministic clock. The live-poller supplies `nowMs` at call time.
 *
 * Why back-compute started_at from durationMinutes (instead of first-observation):
 *   The Crionet live widget surfaces an elapsed-time counter (`durationMinutes`)
 *   for every in-progress match. If padelgod starts polling mid-match — e.g.
 *   after a Railway restart, or when a tournament is enrolled late — the first
 *   tick still gives us an accurate start time via `now - durationMinutes`,
 *   whereas stamping `now` on first observation would mis-stamp by up to the
 *   full match length. Accuracy is ±1 minute (durationMinutes is integer).
 */

/**
 * Back-compute an ISO timestamp for when a match started, given the live
 * widget's current elapsed-minutes counter and the current wall-clock time.
 *
 * Returns null if `durationMinutes` is null — the caller should fall back to
 * `now()` only on the first tick (handled at the write layer with
 * `.is('started_at', null)` so subsequent ticks refine via back-compute).
 */
export function computeBackstampedStartedAt(
  durationMinutes: number | null,
  nowMs: number,
): string | null {
  if (durationMinutes === null) return null;
  // Duration is integer minutes; a negative value is nonsensical — coerce to 0.
  const mins = Math.max(0, durationMinutes);
  return new Date(nowMs - mins * 60_000).toISOString();
}

/**
 * Format an integer minute count as the `HH:MM` string `public.matches.duration`
 * expects (matching the legacy padelapi shape: "01:20", "00:40", "02:14").
 */
export function formatDurationHHMM(durationMinutes: number): string {
  const mins = Math.max(0, Math.trunc(durationMinutes));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Maximum plausible match duration in minutes. Real padel matches almost
 * never approach 3.5 hours; 4 hours is a generous outer bound. Any
 * incoming duration above this is upstream contamination — usually a
 * wall-clock end-time leaking into the duration field. See ASUNCION P2
 * 2026-05-08 (QF '22:09' / '20:05') and the older padelapi-pipeline rows
 * at Bnl Italy Major, Buenos Aires P1, Cancún P2, Miami P1 with similar
 * shape.
 */
export const MAX_DURATION_MINUTES = 240;

/**
 * Defense-in-depth sanity guard for integer-minute durations entering a
 * write path. Returns null when the value is null, negative, or above
 * MAX_DURATION_MINUTES so callers can skip the write rather than persist
 * garbage that would later overwrite earlier-correct values.
 */
export function sanitizeDurationMinutes(mins: number | null): number | null {
  if (mins === null || !Number.isFinite(mins)) return null;
  if (mins < 0 || mins > MAX_DURATION_MINUTES) return null;
  return mins;
}

/**
 * Defense-in-depth sanity guard for HH:MM-formatted durations entering a
 * write path. Padelapi.org returns `duration` as a string in this shape;
 * we want to drop wall-clock-looking values (e.g. '22:09' = 22h09m) before
 * they land on `public.matches.duration`. Returns the original string when
 * plausible, null otherwise.
 */
export function sanitizeDurationHHMM(durationHHMM: string | null): string | null {
  const mins = parseDurationHHMM(durationHHMM);
  if (sanitizeDurationMinutes(mins) === null) return null;
  return durationHHMM;
}

/**
 * Parse an `HH:MM` duration string into total minutes. Returns null for
 * malformed input (unknown upstream formats, empty strings, etc) so the
 * caller can cleanly fall back.
 */
export function parseDurationHHMM(durationHHMM: string | null): number | null {
  if (!durationHHMM) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(durationHHMM);
  if (!m) return null;
  const h = parseInt(m[1]!, 10);
  const mins = parseInt(m[2]!, 10);
  if (Number.isNaN(h) || Number.isNaN(mins)) return null;
  return h * 60 + mins;
}

/**
 * Compute a fallback `finished_at` ISO string for a match that's terminal in
 * the results snapshot but wasn't live-observed.
 *
 * Priority:
 *   1. `started_at + duration`  — most accurate (live-poller back-stamped
 *      `started_at` from the widget's elapsed counter + wrote `duration`
 *      every tick). When both are present, this is true wall-clock accuracy.
 *   2. `tournament.starts_at + (dayNumber - 1) days` at 12:00 UTC — derives
 *      the actual play day from the Crionet widget's day cursor. The widget
 *      groups results by play day (Day 1, Day 2, ...), and `tournament.starts_at`
 *      is the calendar anchor for Day 1. 12:00 UTC is the timezone-safe
 *      midpoint that lands on the correct local calendar day worldwide.
 *      Used when live-poller didn't observe the match (Bronze/Silver/etc
 *      tournaments scraped via the static results widget only).
 *   3. `captured_at`            — the time we scraped the results snapshot.
 *      Last resort; pre-fix this tier mis-stamped every R32/R16/QF as the
 *      cron's run-day instead of each round's actual play day.
 *
 * Pure function: no I/O, no Date.now. The caller is expected to guard the
 * resulting write with `.is('finished_at', null)` so the live-poller's
 * precise stamp always wins when present.
 */
export function computeFinishedAtFallback(
  startedAtIso: string | null,
  durationHHMM: string | null,
  capturedAtIso: string,
  options?: { dayNumber?: number | null; tournamentStartsAtIso?: string | null },
): string {
  const mins = parseDurationHHMM(durationHHMM);
  if (startedAtIso && mins !== null) {
    const startMs = Date.parse(startedAtIso);
    if (!Number.isNaN(startMs)) {
      return new Date(startMs + mins * 60_000).toISOString();
    }
  }
  const dayNumber = options?.dayNumber ?? null;
  const tStart = options?.tournamentStartsAtIso ?? null;
  if (dayNumber != null && Number.isFinite(dayNumber) && dayNumber >= 1 && tStart) {
    const tStartMs = Date.parse(tStart);
    if (!Number.isNaN(tStartMs)) {
      const dayDate = new Date(tStartMs);
      dayDate.setUTCDate(dayDate.getUTCDate() + (Math.trunc(dayNumber) - 1));
      dayDate.setUTCHours(12, 0, 0, 0);
      return dayDate.toISOString();
    }
  }
  return capturedAtIso;
}

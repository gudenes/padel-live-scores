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
 *   2. `captured_at`            — the time we scraped the results snapshot.
 *      Can be 30+ minutes late (the worker runs twice-hourly), but strictly
 *      better than leaving `finished_at` NULL — which excludes the match
 *      from the Results tab filter.
 *
 * Pure function: no I/O, no Date.now. The caller is expected to guard the
 * resulting write with `.is('finished_at', null)` so the live-poller's
 * precise stamp always wins when present.
 */
export function computeFinishedAtFallback(
  startedAtIso: string | null,
  durationHHMM: string | null,
  capturedAtIso: string,
): string {
  const mins = parseDurationHHMM(durationHHMM);
  if (startedAtIso && mins !== null) {
    const startMs = Date.parse(startedAtIso);
    if (!Number.isNaN(startMs)) {
      return new Date(startMs + mins * 60_000).toISOString();
    }
  }
  return capturedAtIso;
}

/**
 * Defense-in-depth sanity guard for `matches.duration` values written from
 * the padelapi.org pipeline (cron/scores, relay, admin routes).
 *
 * Padelapi.org returns `duration` as an HH:MM string. Almost always it's
 * the real elapsed match time — but historically a handful of rows landed
 * with wall-clock-looking values like '22:09' (1329 min) or '20:05'
 * (1205 min) at Bnl Italy Major 2025, Buenos Aires P1 2025, Cancún P2 +
 * Miami P1 2026, sometimes via the relay's match-finish fetch and
 * sometimes via the static admin imports. A real padel match never
 * approaches 4 hours, so anything above MAX_DURATION_MINUTES is upstream
 * contamination that we drop on the floor rather than persist.
 *
 * Mirrors padelgod/src/lib/match-time-stamps.ts. Both packages keep their
 * own copy because they have separate dependency trees; the value is
 * trivial enough that cross-package sharing would cost more than it saves.
 */

export const MAX_DURATION_MINUTES = 240

/**
 * Parse "HH:MM" → minutes. Returns null for null/empty/malformed input.
 */
export function parseDurationHHMM(s: string | null | undefined): number | null {
  if (!s) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (!m) return null
  const h = parseInt(m[1]!, 10)
  const mins = parseInt(m[2]!, 10)
  if (Number.isNaN(h) || Number.isNaN(mins)) return null
  return h * 60 + mins
}

/**
 * Sanity-check an HH:MM duration string before persisting. Returns the
 * original string if it parses to a value in [0, 240]; null otherwise.
 */
export function sanitizeDurationHHMM(s: string | null | undefined): string | null {
  const mins = parseDurationHHMM(s)
  if (mins === null) return null
  if (mins < 0 || mins > MAX_DURATION_MINUTES) return null
  return s ?? null
}

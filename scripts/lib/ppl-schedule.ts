// Turns the Pro Padel League's zone-less wall-clock strings into real UTC
// instants.
//
// Phase 2a deliberately left `matches.scheduled_at` NULL rather than guess a
// timezone. That was the right call at the time and the wrong state to stay
// in: the player profile orders history by finished_at → started_at →
// scheduled_at, so 72 correct matches sat at the bottom of every list,
// invisible. Correct-but-undated is indistinguishable from absent.
//
// The repo already carries this scar. The Paris Major incident (2026-09-07)
// left 110 matches with a NULL scheduled_at and the whole tournament vanished
// from the home carousel while its results were landing normally.

/**
 * Venue timezone per event.
 *
 * Keyed on `tournaments.external_id`, not derived from the location string or
 * the country. A country is not enough — the United States spans four zones
 * and Mexico three, so "US" would put a Los Angeles match three hours wrong.
 * The league runs five stops a year; an explicit table is both smaller and
 * more honest than a lookup that cannot be right.
 *
 * An unknown slug returns null and the caller skips the match rather than
 * assuming. A new stop must be added here, and the importer will say so.
 */
const VENUE_TIMEZONE: Record<string, string> = {
  'new-york-2026': 'America/New_York',
  'new-york-ppl-ii-2026': 'America/New_York',
  'los-angeles-2026': 'America/Los_Angeles',
  'los-angeles-ppl-ii-2026': 'America/Los_Angeles',
  'playa-del-carmen-2026': 'America/Cancun',
  'playa-del-carmen-ppl-ii-2026': 'America/Cancun',
  'guadalajara-2026': 'America/Mexico_City',
  'guadalajara-ppl-ii-2026': 'America/Mexico_City',
  'miami-2026': 'America/New_York',
  'miami-ppl-ii-2026': 'America/New_York',
}

export function venueTimezone(tournamentSlug: string): string | null {
  return VENUE_TIMEZONE[tournamentSlug] ?? null
}

export interface WallClock {
  year: number
  month: number
  day: number
  hours: number
  minutes: number
}

/**
 * Upstream emits THREE shapes, none carrying a zone:
 *   "2026-08-13T16:00:00"   ISO-looking, T separator, 24-hour, padded
 *   "2026-07-13 8:00:00"    same but a SPACE separator and an UNPADDED hour
 *   "8/16/2026 1:00:00 PM"  US locale, 12-hour with a meridiem
 *
 * The second was found only after importing: two PPL II podium matches came
 * back with a null date because the ISO branch demanded a two-digit hour.
 * Since the other 24-hour rows in the same payload are unambiguous, an
 * unpadded hour with no meridiem is read as 24-hour too — "8:00" is 08:00.
 *
 * Both are wall-clock at the venue. The ISO one is the trap: `new Date(...)`
 * on a string with no zone is interpreted in the RUNTIME's zone, which for a
 * worker on Railway is UTC and for a laptop is whatever the laptop is — so
 * the same import would produce different timestamps in different places.
 * Parsed by hand for that reason.
 */
export function parseWallClock(raw: string | null | undefined): WallClock | null {
  if (!raw) return null
  const s = raw.trim()

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (iso) {
    if (Number(iso[4]) > 23) return null
    return {
      year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]),
      hours: Number(iso[4]), minutes: Number(iso[5]),
    }
  }

  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i)
  if (us) {
    let hours = Number(us[4])
    const ampm = us[7]?.toUpperCase()
    if (ampm === 'PM' && hours !== 12) hours += 12
    if (ampm === 'AM' && hours === 12) hours = 0
    if (hours > 23) return null
    return {
      year: Number(us[3]), month: Number(us[1]), day: Number(us[2]),
      hours, minutes: Number(us[5]),
    }
  }

  return null
}

/**
 * Wall-clock in `timezone` → UTC ISO string.
 *
 * The algorithm is lifted from `localTimeToUtc` in
 * padelgod/src/lib/oop-schedule-parser.ts, which is the code that fixed the
 * Paris Major incident. It is a third copy rather than an import because
 * padelgod is a separate npm package that `scripts/` cannot reach, and the
 * function is private there. Copied deliberately, with its reasoning:
 *
 *   1. Build the desired wall-clock moment as if it were UTC.
 *   2. Format that moment IN the target zone — that tells us which wall-clock
 *      time it corresponds to there.
 *   3. The difference is the zone's offset on that date, DST included.
 *   4. Subtract it to get the true instant.
 *
 * This avoids the day-boundary trap of `localHour - utcHour`, where 01:00
 * next-day minus 17:00 today yields -16 instead of +8.
 */
export function wallClockToUtc(w: WallClock, timezone: string): string | null {
  try {
    const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hours, w.minutes, 0)
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
    const parts = fmt.formatToParts(new Date(asIfUtc))
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')
    let lH = get('hour')
    if (lH === 24) lH = 0 // Intl reports midnight as 24 in some locales
    const wallClockInTz = Date.UTC(get('year'), get('month') - 1, get('day'), lH, get('minute'), 0)
    return new Date(asIfUtc - (wallClockInTz - asIfUtc)).toISOString()
  } catch {
    return null
  }
}

/** `HH:MM` or `HH:MM:SS` → seconds. Null when absent or malformed. */
export function durationToSeconds(v: string | null | undefined): number | null {
  if (!v) return null
  const m = v.trim().match(/^(\d+):([0-5]\d)(?::([0-5]\d))?$/)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0)
}

/**
 * When a match ended, from when it started plus how long it ran.
 *
 * Derived, not observed — upstream never publishes an end time. It exists so
 * the profile, which orders history by finished_at first, can place a league
 * match among circuit ones. With no duration it falls back to the start, which
 * is still vastly better than null.
 */
export function finishedAtFrom(scheduledAtIso: string | null, durationSeconds: number | null): string | null {
  if (!scheduledAtIso) return null
  if (durationSeconds == null) return scheduledAtIso
  return new Date(new Date(scheduledAtIso).getTime() + durationSeconds * 1000).toISOString()
}

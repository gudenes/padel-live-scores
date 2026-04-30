// Parses Crionet OOP scheduled_label strings into UTC timestamps.
//
// The OOP widget emits schedule labels in three forms:
//
//   "Starting at 2:30 PM"   — exact time (firm)
//   "Not before 7:00 PM"    — exact time (approximate — match COULD start later)
//   "Followed by"           — implicit time (= previous match on same court + 90 min)
//
// All three carry the local-tournament time, NOT UTC. We convert to UTC using
// the tournament's IANA timezone (e.g. "Asia/Singapore") and the day_date
// captured from the OOP day-pill (e.g. "2026-04-30").
//
// "Followed by" requires court-context — we chain off the previous parsed
// time on the same (court, day_date). Courts are processed in
// `court_position` order (the OOP widget's row order on the page) so
// chaining matches reality.
//
// IMPORTANT: the chain key includes `dayDate`, not just `court`. Crionet
// OOP snapshots cover multiple days at once, and `court_position` resets
// per day. Without per-day isolation, Apr 30's "Followed by" rows latch
// onto Apr 29's last absolute time and produce timestamps a full day
// off (Mendoza Q2 MQ008 — stored as 22:15 ARG Apr 29, real time was
// 16:30 ARG Apr 30).
//
// Mirrors the parser used in src/app/api/ops/schedule-review/route.ts; that
// path is the human-in-the-loop preview UI. This module is the automated
// version that runs on every padelgod oop-fetcher tick via fip-oop-writer.

const FOLLOWED_BY_GAP_MINUTES = 90;

export interface OopScheduleRow {
  /** Crionet match-widget id (e.g. "M8001"). Required — without it we can't
   *  link back to a public.matches row to update. Rows with null are skipped. */
  matchWidgetId: string | null;
  /** Tournament court name (e.g. "Court 1", "CAMPO CARLSBERG"). Used as the
   *  chaining key for "Followed by". Null collapses every row to a single
   *  pseudo-court for chaining (defensive — most fixtures have a court). */
  court: string | null;
  /** 0-based position within the court's day. Drives "Followed by"
   *  ordering — we chain in ascending courtPosition. */
  courtPosition: number;
  /** Raw schedule label from the widget. */
  scheduledLabel: string | null;
  /** ISO YYYY-MM-DD captured from the day-pill. Required — without it the
   *  parsed local time has no calendar anchor. */
  dayDate: string | null;
}

export interface OopScheduleResult {
  matchWidgetId: string;
  /** ISO UTC timestamp. */
  scheduledAt: string;
  /** Raw label, preserved verbatim — UI uses it for the `*` approximate
   *  marker on "Not before" / "Followed by". */
  scheduleLabel: string;
  /** True for "Not before" / "Followed by" — UI may render with a `*`
   *  suffix to signal "could shift". Callers can ignore if they don't care. */
  approximate: boolean;
}

const TIME_RE = /(\d{1,2}):(\d{2})\s*(AM|PM)/i;

/**
 * Convert a local YYYY-MM-DD + HH:MM in `timezone` to UTC ISO.
 *
 * DST-aware via Intl.DateTimeFormat. Approach:
 *   1. Build the desired wall-clock moment as if it were UTC (`asIfUtc`).
 *   2. Format that moment in the target timezone — gives us what wall-clock
 *      time `asIfUtc` corresponds to in that tz.
 *   3. Diff (wallClockInTz - asIfUtc) = the timezone's offset on that date.
 *   4. Subtract the offset from `asIfUtc` to get the true UTC moment.
 *
 * Avoids the day-boundary trap of `localHour - utcHour` (where 01:00 next-day
 * minus 17:00 today gives -16 instead of +8). Also avoids local-tz `getHours`
 * pitfalls.
 */
function localTimeToUtc(
  dateStr: string,
  hours: number,
  minutes: number,
  timezone: string,
): string | null {
  try {
    const [y, m, d] = dateStr.split('-').map((s) => parseInt(s, 10));
    if (!y || !m || !d) return null;
    const asIfUtc = Date.UTC(y, m - 1, d, hours, minutes, 0);
    const probe = new Date(asIfUtc);

    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(probe);
    const get = (type: string) =>
      parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
    const lY = get('year');
    const lM = get('month');
    const lD = get('day');
    let lH = get('hour');
    const lMin = get('minute');
    // Intl returns "24" for midnight in some locales — normalise to 0.
    if (lH === 24) lH = 0;

    const wallClockInTz = Date.UTC(lY, lM - 1, lD, lH, lMin, 0);
    const offsetMs = wallClockInTz - asIfUtc;
    return new Date(asIfUtc - offsetMs).toISOString();
  } catch {
    return null;
  }
}

/**
 * Parse a batch of OOP schedule rows into UTC timestamps.
 *
 * Rows are processed in (court, courtPosition) order to allow "Followed by"
 * chaining — each "Followed by" row anchors off the most recent parsed time
 * on the same court.
 *
 * Returns one result per row that resolved to a time. Rows that can't be
 * parsed (no widget id, no day_date, no time, no chain anchor for
 * "Followed by") are silently dropped — caller decides how to handle gaps.
 */
export function parseOopScheduledAtBatch(
  rows: OopScheduleRow[],
  timezone: string,
): OopScheduleResult[] {
  // Sort by (court, dayDate, courtPosition) for deterministic chaining.
  // dayDate must be in the sort key so each day's chain is processed
  // contiguously — see the IMPORTANT note at the top of this file.
  const sorted = [...rows].sort((a, b) => {
    const ac = a.court ?? '';
    const bc = b.court ?? '';
    if (ac !== bc) return ac < bc ? -1 : 1;
    const ad = a.dayDate ?? '';
    const bd = b.dayDate ?? '';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return a.courtPosition - b.courtPosition;
  });

  // Keyed by `${court}::${dayDate}` — never bleed the chain across days.
  const lastTimePerCourt = new Map<string, Date>();
  const out: OopScheduleResult[] = [];

  for (const row of sorted) {
    if (!row.matchWidgetId) continue;
    if (!row.dayDate) continue;
    if (!row.scheduledLabel) continue;
    const courtKey = `${row.court ?? '__none__'}::${row.dayDate}`;

    let scheduledAt: string | null = null;
    let approximate = false;

    const timeMatch = TIME_RE.exec(row.scheduledLabel);
    if (timeMatch) {
      // "Starting at H:MM AM/PM" or "Not before H:MM PM" — both carry an
      // explicit time we can parse directly.
      let hours = parseInt(timeMatch[1]!, 10);
      const minutes = parseInt(timeMatch[2]!, 10);
      const ampm = timeMatch[3]!.toUpperCase();
      if (ampm === 'PM' && hours < 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;
      scheduledAt = localTimeToUtc(row.dayDate, hours, minutes, timezone);
      if (scheduledAt) {
        lastTimePerCourt.set(courtKey, new Date(scheduledAt));
      }
      // "Not before" is approximate — match COULD start later. "Starting at"
      // is firm. Detect via case-insensitive substring on the label.
      approximate = /not before/i.test(row.scheduledLabel);
    } else if (/followed by/i.test(row.scheduledLabel)) {
      // Chain off the previous match on the same court. If we have no
      // anchor (court's first row is itself "Followed by", or chain
      // broken by a malformed prior row), skip — UI will fall back to
      // showing whatever scheduled_at currently is, which for the
      // Singapore-style case is null.
      const lastTime = lastTimePerCourt.get(courtKey);
      if (lastTime) {
        const estimated = new Date(
          lastTime.getTime() + FOLLOWED_BY_GAP_MINUTES * 60 * 1000,
        );
        scheduledAt = estimated.toISOString();
        lastTimePerCourt.set(courtKey, estimated);
        approximate = true;
      }
    }

    if (!scheduledAt) continue;
    out.push({
      matchWidgetId: row.matchWidgetId,
      scheduledAt,
      scheduleLabel: row.scheduledLabel,
      approximate,
    });
  }

  return out;
}

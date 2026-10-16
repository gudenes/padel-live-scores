import type { Match } from '@/types/match'

export function formatShortDate(
  match: Match,
  locale: string,
  tz: string,
): string | null {
  const iso = match.finished_at ?? match.scheduled_at
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: tz,
  }).format(d)
}

// Time chip for scheduled matches. Skips date-only padelapi values
// (those land on midnight UTC and don't carry a real start time).
export function formatScheduledTime(
  match: Match,
  locale: string,
  tz: string,
): string | null {
  if (match.status !== 'scheduled') return null
  const iso = match.scheduled_at
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) return null
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: tz,
  }).format(d)
}


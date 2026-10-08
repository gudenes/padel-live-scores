export interface SmartScheduleForecast {
  version: 1
  next_to_play: boolean
  predecessor_id: string | null
  earliest_at: string | null
  latest_at: string | null
  computed_at: string
  source_updated_at: string | null
  basis: 'live_progress' | 'observed_finish' | 'court_order'
}

/** Fail closed on stale snapshots, malformed windows, and status transitions. */
export function visibleForecast(value: SmartScheduleForecast | null | undefined, status: string, now: number): SmartScheduleForecast | null {
  if (!value || value.version !== 1 || status !== 'scheduled' || typeof value.next_to_play !== 'boolean') return null
  const computed = Date.parse(value.computed_at)
  if (!Number.isFinite(computed) || computed > now + 60_000 || now - computed > 3 * 60_000) return null
  if (!value.earliest_at && !value.latest_at) return value
  const start = Date.parse(value.earliest_at ?? ''), end = Date.parse(value.latest_at ?? '')
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end <= now) return { ...value, earliest_at: null, latest_at: null }
  if (value.basis === 'live_progress') {
    const source = Date.parse(value.source_updated_at ?? '')
    if (!Number.isFinite(source) || now - source > 5 * 60_000 || source > now + 60_000) return { ...value, earliest_at: null, latest_at: null }
  }
  return value
}
export function relativeStartWindow(forecast: SmartScheduleForecast, now: number): { min: number; max: number } | null {
  if (!forecast.earliest_at || !forecast.latest_at) return null
  const min = Math.max(0, Math.ceil((Date.parse(forecast.earliest_at) - now) / 300_000) * 5)
  const max = Math.max(min, Math.ceil((Date.parse(forecast.latest_at) - now) / 300_000) * 5)
  return { min, max }
}
export function startClockWindow(forecast: SmartScheduleForecast, locale: string, tz: string): string | null {
  if (!forecast.earliest_at || !forecast.latest_at) return null
  // Include the day when an estimate crosses midnight in the viewer's timezone.
  const start = new Date(forecast.earliest_at), end = new Date(forecast.latest_at)
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz })
  const crossDay = day.format(start) !== day.format(end)
  const fmt = new Intl.DateTimeFormat(locale, { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false, ...(crossDay ? { day: 'numeric', month: 'short' } as const : {}) })
  return `${fmt.format(start)}–${fmt.format(end)}`
}

/** Early edge for the qualitative later-match label, in the viewer's timezone. */
export function earliestStartClock(forecast: SmartScheduleForecast, locale: string, tz: string): string | null {
  if (!forecast.earliest_at) return null
  const start = new Date(forecast.earliest_at)
  const computed = new Date(forecast.computed_at)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(computed.getTime())) return null
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz })
  return new Intl.DateTimeFormat(locale, { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false, ...(day.format(start) !== day.format(computed) ? { day: 'numeric', month: 'short' } as const : {}) }).format(start)
}

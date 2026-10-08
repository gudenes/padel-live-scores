import { describe, expect, it } from 'vitest'
import { visibleForecast, relativeStartWindow, startClockWindow, earliestStartClock, type SmartScheduleForecast } from '../smart-schedule'
const now = Date.parse('2026-10-08T10:00Z')
const forecast: SmartScheduleForecast = { version: 1, next_to_play: true, predecessor_id: 'p', earliest_at: '2026-10-08T10:20Z', latest_at: '2026-10-08T10:40Z', computed_at: '2026-10-08T10:00Z', source_updated_at: '2026-10-08T10:00Z', basis: 'live_progress' }
describe('smart schedule presentation', () => {
  it('expires forecasts and removes badges after status transitions', () => {
    expect(visibleForecast(forecast, 'scheduled', now + 181_000)).toBeNull()
    expect(visibleForecast(forecast, 'on_court', now)).toBeNull()
    expect(visibleForecast(forecast, 'finished', now)).toBeNull()
  })
  it('retains queue position but withholds stale live times', () => {
    const result = visibleForecast({ ...forecast, source_updated_at: '2026-10-08T09:50Z' }, 'scheduled', now)
    expect(result?.next_to_play).toBe(true)
    expect(result?.earliest_at).toBeNull()
  })
  it('rounds relative ranges and formats viewer-local clock time', () => {
    expect(relativeStartWindow(forecast, now + 60_000)).toEqual({ min: 20, max: 40 })
    expect(startClockWindow(forecast, 'es', 'Europe/Madrid')).toBe('12:20–12:40')
  })
  it('includes the day when the early edge rolls into tomorrow', () => {
    expect(earliestStartClock({ ...forecast, earliest_at: '2026-10-08T23:00Z' }, 'en-GB', 'Europe/Madrid')).toContain('9 Oct')
  })
  it('never shows a negative timer or malformed range', () => {
    expect(visibleForecast({ ...forecast, latest_at: 'invalid' }, 'scheduled', now)?.earliest_at).toBeNull()
    expect(relativeStartWindow({ ...forecast, earliest_at: '2026-10-08T09:55Z' }, now)?.min).toBe(0)
  })
})

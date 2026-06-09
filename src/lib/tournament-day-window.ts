// src/lib/tournament-day-window.ts
// Tournament-local-timezone day math for the matchday digest. Uses Intl
// (no date-fns-tz in this app). All inputs/outputs are UTC except the tz arg.
import { countryToTimezone } from '@/lib/country-timezone'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function getTournamentTimezone(
  supabase: Pick<SupabaseClient, 'from'>,
  tournamentId: string,
): Promise<string | null> {
  const { data } = await supabase.from('tournaments').select('timezone, country').eq('id', tournamentId).maybeSingle()
  const explicit = (data?.timezone as string | null) ?? null
  if (explicit) return explicit
  return countryToTimezone((data?.country as string | null) ?? null)
}

export function localHourIn(tz: string, now: Date): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).format(now)
  return parseInt(h, 10) % 24
}

export function zonedDayBoundsUtc(tz: string, now: Date): { localDate: string; startUtc: string; endUtc: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  const localDate = `${get('year')}-${get('month')}-${get('day')}`
  const start = zonedMidnightToUtc(tz, localDate)
  const next = new Date(start.getTime() + 36 * 3600_000) // safely into next local day
  const np = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(next)
  const ng = (t: string) => np.find((p) => p.type === t)!.value
  const endExact = zonedMidnightToUtc(tz, `${ng('year')}-${ng('month')}-${ng('day')}`)
  return { localDate, startUtc: start.toISOString(), endUtc: endExact.toISOString() }
}

// UTC instant of local 00:00 on dateStr (YYYY-MM-DD) in tz. Probe-and-correct for DST.
function zonedMidnightToUtc(tz: string, dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0))
  const asLocal = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(guess)
  const gp = (t: string) => parseInt(asLocal.find((p) => p.type === t)!.value, 10)
  const shownHour = gp('hour') === 24 ? 0 : gp('hour')
  const shown = Date.UTC(gp('year'), gp('month') - 1, gp('day'), shownHour, gp('minute'))
  const desired = Date.UTC(y, m - 1, d, 0, 0)
  return new Date(guess.getTime() + (desired - shown))
}

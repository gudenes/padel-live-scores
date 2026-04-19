// Pure helpers for the Matches page: date-window calculation,
// legacy-tab remapping, and the composite filter predicate.
// All functions are deterministic, test-only inputs in/out.

export type Tab = 'yesterday' | 'today' | 'upcoming'
export type Circuit = 'premier' | 'fip'
export type Gender = 'men' | 'women'

export interface MatchFilters {
  circuits: Set<Circuit>
  genders: Set<Gender>
  levels: Set<string>
  favouritesOnly: boolean
  hideQualifiers: boolean
  favourites: {
    matches: Set<string>
    players: Set<string>
    tournaments: Set<string>
  }
}

export interface DateWindow {
  yesterdayStart: string   // ISO UTC for midnight local yesterday
  todayStart: string
  tomorrowStart: string
}

const PREMIER_LEVELS = new Set(['p1', 'p2', 'major', 'finals'])
const QUALIFIER_RE = /^q\d|qualif/i

// ── Date-window computation ──────────────────────────────────
// Find local-midnight boundaries for yesterday / today / tomorrow
// by formatting the input time with the target tz and backing out
// the offset. Falls back to UTC if Intl rejects the tz.
export function computeDateWindow(now: Date, tz: string): DateWindow {
  const ymd = ymdInTz(now, tz)
  const [y, m, d] = ymd.split('-').map(Number)
  const todayUtc = localMidnightToUtc(y, m, d, tz)
  const tomorrowUtc = new Date(todayUtc.getTime() + 24 * 60 * 60 * 1000)
  const yesterdayUtc = new Date(todayUtc.getTime() - 24 * 60 * 60 * 1000)
  return {
    yesterdayStart: yesterdayUtc.toISOString(),
    todayStart: todayUtc.toISOString(),
    tomorrowStart: tomorrowUtc.toISOString(),
  }
}

function ymdInTz(d: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d)
    const y = parts.find(p => p.type === 'year')!.value
    const m = parts.find(p => p.type === 'month')!.value
    const day = parts.find(p => p.type === 'day')!.value
    return `${y}-${m}-${day}`
  } catch {
    // invalid tz — fall through to UTC
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
}

function localMidnightToUtc(y: number, m: number, d: number, tz: string): Date {
  // Naive guess: UTC midnight for the given Y-M-D
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0))
  // Format the guess back in tz; the delta tells us the offset to subtract
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(guess)
    const map: Record<string, string> = {}
    for (const p of parts) map[p.type] = p.value
    const asLocal = Date.UTC(
      Number(map.year), Number(map.month) - 1, Number(map.day),
      Number(map.hour === '24' ? '0' : map.hour),
      Number(map.minute), Number(map.second),
    )
    const offset = asLocal - guess.getTime()
    return new Date(guess.getTime() - offset)
  } catch {
    return guess
  }
}

// ── Legacy tab remap ─────────────────────────────────────────
export function tabForLegacyParam(value: string | null): Tab | null {
  if (value === 'today' || value === 'yesterday' || value === 'upcoming') return value
  if (value === 'live') return 'today'
  if (value === 'results') return 'yesterday'
  return null
}

// ── Filter predicate ─────────────────────────────────────────
export function applyFilters<M extends {
  id: string
  category?: string | null
  round?: string | null
  tournament?: { id?: string | null; level?: string | null } | null
  pair1_player1?: { id?: string | null } | null
  pair1_player2?: { id?: string | null } | null
  pair2_player1?: { id?: string | null } | null
  pair2_player2?: { id?: string | null } | null
}>(matches: M[], f: MatchFilters): M[] {
  return matches.filter(m => {
    // Circuits
    if (f.circuits.size > 0 && f.circuits.size < 2) {
      const level = m.tournament?.level ?? ''
      const circuit: Circuit | 'other' =
        PREMIER_LEVELS.has(level) ? 'premier' :
        level.startsWith('fip_')  ? 'fip' : 'other'
      if (circuit === 'other') return false
      if (!f.circuits.has(circuit)) return false
    }

    // Genders
    if (f.genders.size > 0 && f.genders.size < 2) {
      const g = m.category as Gender | undefined
      if (!g || !f.genders.has(g)) return false
    }

    // Levels
    if (f.levels.size > 0) {
      const lvl = m.tournament?.level
      if (!lvl || !f.levels.has(lvl)) return false
    }

    // Hide qualifiers
    if (f.hideQualifiers) {
      const round = m.round ?? ''
      if (QUALIFIER_RE.test(round)) return false
    }

    // Favourites only
    if (f.favouritesOnly) {
      const tid = m.tournament?.id ?? ''
      const pids = [
        m.pair1_player1?.id, m.pair1_player2?.id,
        m.pair2_player1?.id, m.pair2_player2?.id,
      ].filter(Boolean) as string[]
      const hit =
        f.favourites.matches.has(m.id) ||
        (tid && f.favourites.tournaments.has(tid)) ||
        pids.some(pid => f.favourites.players.has(pid))
      if (!hit) return false
    }

    return true
  })
}

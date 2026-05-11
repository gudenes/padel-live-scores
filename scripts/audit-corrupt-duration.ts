/**
 * Audit every match with an implausibly large `duration` value.
 *
 *   npx tsx scripts/audit-corrupt-duration.ts                # threshold = 240 min
 *   npx tsx scripts/audit-corrupt-duration.ts --threshold=300
 *
 * Hypothesis: the Crionet tournamentlive parser's `parseDuration` greedily
 * picks the first `(\d{1,2}):(\d{2})` span in the summary row. When the
 * widget switches a finished match's summary block to show the wall-clock
 * end time (e.g. "22:09"), the parser misreads it as 22 hours of elapsed
 * play and writes "22:09" into `matches.duration`. Real padel matches
 * never approach 4 hours.
 *
 * Output: every offending row with its derived (finished_at - started_at)
 * for comparison + a per-tournament breakdown.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnv() {
  const candidates = [
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), '..', '..', '..', '.env.local'),
    resolve(process.cwd(), '..', '..', '..', '..', '.env.local'),
    '/Users/GuDenes/Projects/padel-live-scores/.env.local',
  ]
  for (const path of candidates) {
    if (!existsSync(path)) continue
    const raw = readFileSync(path, 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"(.*)"$/, '$1')
    }
    return path
  }
  return null
}

const envPath = loadEnv()
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY')
  console.error(envPath ? `Tried env file: ${envPath}` : 'No .env.local found in usual locations')
  process.exit(1)
}

const thresholdArg = process.argv.find((a) => a.startsWith('--threshold='))
const THRESHOLD_MIN = thresholdArg ? parseInt(thresholdArg.split('=')[1]!, 10) : 240

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

function parseHhMm(s: string | null): number | null {
  if (!s) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (!m) return null
  const h = parseInt(m[1]!, 10)
  const mins = parseInt(m[2]!, 10)
  if (Number.isNaN(h) || Number.isNaN(mins)) return null
  return h * 60 + mins
}

interface Row {
  id: string
  tournament_id: string | null
  status: string | null
  round: string | null
  category: string | null
  court: string | null
  duration: string | null
  started_at: string | null
  finished_at: string | null
  pair1_player1_name: string | null
  pair1_player2_name: string | null
  pair2_player1_name: string | null
  pair2_player2_name: string | null
}

interface TournamentMeta {
  id: string
  name: string | null
  level: string | null
  starts_at: string | null
}

const PAGE_SIZE = 1000

async function loadAll(): Promise<Row[]> {
  const out: Row[] = []
  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from('matches')
      .select(
        'id, tournament_id, status, round, category, court, duration, started_at, finished_at, pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name',
      )
      .not('duration', 'is', null)
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`matches query failed: ${error.message}`)
    if (!data || data.length === 0) break
    out.push(...(data as Row[]))
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return out
}

async function loadTournaments(ids: string[]): Promise<Map<string, TournamentMeta>> {
  const m = new Map<string, TournamentMeta>()
  if (ids.length === 0) return m
  const CHUNK = 200
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const { data, error } = await supabase
      .from('tournaments')
      .select('id, name, level, starts_at')
      .in('id', chunk)
    if (error) throw new Error(`tournaments query failed: ${error.message}`)
    for (const row of (data ?? []) as TournamentMeta[]) m.set(row.id, row)
  }
  return m
}

function fmtNames(r: Row): string {
  const pair1 = [r.pair1_player1_name, r.pair1_player2_name].filter(Boolean).join(' / ') || 'TBD'
  const pair2 = [r.pair2_player1_name, r.pair2_player2_name].filter(Boolean).join(' / ') || 'TBD'
  return `${pair1} vs ${pair2}`
}

async function main() {
  console.log(`Threshold: duration > ${THRESHOLD_MIN} minutes`)
  const all = await loadAll()
  console.log(`Scanned ${all.length} matches with non-null duration`)

  const offenders: Array<{
    r: Row
    parsedMin: number
    wallMin: number | null
  }> = []
  for (const r of all) {
    const parsedMin = parseHhMm(r.duration)
    if (parsedMin === null) continue
    if (parsedMin <= THRESHOLD_MIN) continue
    let wallMin: number | null = null
    if (r.started_at && r.finished_at) {
      const s = Date.parse(r.started_at)
      const f = Date.parse(r.finished_at)
      if (!Number.isNaN(s) && !Number.isNaN(f) && f > s) {
        wallMin = Math.round((f - s) / 60_000)
      }
    }
    offenders.push({ r, parsedMin, wallMin })
  }

  console.log(`\nFound ${offenders.length} matches with duration > ${THRESHOLD_MIN} min\n`)
  if (offenders.length === 0) return

  const tournamentIds = Array.from(new Set(offenders.map((o) => o.r.tournament_id).filter(Boolean) as string[]))
  const tournaments = await loadTournaments(tournamentIds)

  // Per-tournament breakdown
  const byTournament = new Map<string, typeof offenders>()
  for (const o of offenders) {
    const tid = o.r.tournament_id ?? '(no tournament)'
    if (!byTournament.has(tid)) byTournament.set(tid, [])
    byTournament.get(tid)!.push(o)
  }

  console.log('=== Per-tournament breakdown ===')
  const sortedTournaments = Array.from(byTournament.entries()).sort((a, b) => b[1].length - a[1].length)
  for (const [tid, group] of sortedTournaments) {
    const t = tournaments.get(tid)
    const label = t ? `${t.name} (${t.level ?? '?'}, ${t.starts_at?.slice(0, 10) ?? '?'})` : tid
    console.log(`\n${label}  —  ${group.length} match(es)`)
    for (const { r, parsedMin, wallMin } of group) {
      const wall = wallMin === null ? '?' : `${wallMin}m`
      console.log(
        `  • ${r.id}  ${r.round ?? '?'} ${r.category ?? '?'}  duration='${r.duration}' (${parsedMin}m), wall=${wall}, status=${r.status}`,
      )
      console.log(`      ${fmtNames(r)}`)
      console.log(`      started_at=${r.started_at ?? '?'}  finished_at=${r.finished_at ?? '?'}`)
    }
  }

  // Pattern check: how many parse to a value in 12*60 .. 24*60 (wall-clock-looking) vs other?
  const wallClockLike = offenders.filter((o) => o.parsedMin >= 12 * 60 && o.parsedMin < 24 * 60).length
  console.log('\n=== Pattern signal ===')
  console.log(`  Total over threshold:        ${offenders.length}`)
  console.log(`  Plausibly wall-clock (12-24h): ${wallClockLike}`)
  console.log(`  Other (>= 24h or 4-12h):     ${offenders.length - wallClockLike}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

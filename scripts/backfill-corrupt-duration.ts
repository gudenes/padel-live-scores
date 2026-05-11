/**
 * Backfill matches with corrupt `duration` values (wall-clock-time leakage).
 *
 *   npx tsx scripts/backfill-corrupt-duration.ts             # dry run
 *   npx tsx scripts/backfill-corrupt-duration.ts --apply     # actually write
 *
 * Policy per row:
 *   - duration parses > MAX_DURATION_MINUTES (240) AND we have a usable
 *     wall-clock pair (finished_at > started_at, diff in [0, 240]) →
 *     overwrite with formatted (finished_at - started_at).
 *   - otherwise → set duration = NULL.
 *
 * The four older padelapi-pipeline rows in the dataset have
 * `started_at == finished_at` (pre-padelgod stamping era), so they fall
 * into the NULL branch — better than persisting garbage. The two ASUNCION
 * QF rows have real wall-clock pairs and get recovered.
 *
 * See scripts/audit-corrupt-duration.ts for the read-only sibling.
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

loadEnv()
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const APPLY = process.argv.includes('--apply')
const MAX_DURATION_MINUTES = 240

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

function formatHhMm(totalMins: number): string {
  const mins = Math.max(0, Math.trunc(totalMins))
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

interface Row {
  id: string
  tournament_id: string | null
  duration: string | null
  started_at: string | null
  finished_at: string | null
  round: string | null
  category: string | null
  status: string | null
}

const PAGE_SIZE = 1000

async function loadCandidates(): Promise<Row[]> {
  const out: Row[] = []
  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from('matches')
      .select('id, tournament_id, duration, started_at, finished_at, round, category, status')
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

interface Plan {
  row: Row
  parsedMin: number
  wallMin: number | null
  newDuration: string | null
  reason: string
}

function plan(row: Row): Plan | null {
  const parsedMin = parseHhMm(row.duration)
  if (parsedMin === null || parsedMin <= MAX_DURATION_MINUTES) return null

  let wallMin: number | null = null
  if (row.started_at && row.finished_at) {
    const s = Date.parse(row.started_at)
    const f = Date.parse(row.finished_at)
    if (!Number.isNaN(s) && !Number.isNaN(f) && f > s) {
      wallMin = Math.round((f - s) / 60_000)
    }
  }

  if (wallMin !== null && wallMin > 0 && wallMin <= MAX_DURATION_MINUTES) {
    return {
      row,
      parsedMin,
      wallMin,
      newDuration: formatHhMm(wallMin),
      reason: 'wall-clock-recovered',
    }
  }
  return {
    row,
    parsedMin,
    wallMin,
    newDuration: null,
    reason:
      wallMin === null
        ? 'unrecoverable (started_at/finished_at missing or equal)'
        : `unrecoverable (wall=${wallMin}m also out of range)`,
  }
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (read-only)'}`)
  const all = await loadCandidates()
  console.log(`Scanned ${all.length} matches with non-null duration`)

  const plans: Plan[] = []
  for (const r of all) {
    const p = plan(r)
    if (p) plans.push(p)
  }
  console.log(`Plan: ${plans.length} rows to backfill`)
  if (plans.length === 0) return

  for (const p of plans) {
    console.log(
      `  • ${p.row.id}  ${p.row.round ?? '?'}/${p.row.category ?? '?'}/${p.row.status ?? '?'}`,
    )
    console.log(`      current duration='${p.row.duration}' (${p.parsedMin}m)`)
    console.log(
      `      started_at=${p.row.started_at ?? '?'}  finished_at=${p.row.finished_at ?? '?'}  wall=${p.wallMin === null ? '?' : p.wallMin + 'm'}`,
    )
    console.log(
      `      → new duration=${p.newDuration === null ? 'NULL' : `'${p.newDuration}'`}  (${p.reason})`,
    )
  }

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write.')
    return
  }

  let ok = 0
  let failed = 0
  for (const p of plans) {
    const { error } = await supabase
      .from('matches')
      .update({ duration: p.newDuration, updated_at: new Date().toISOString() })
      .eq('id', p.row.id)
      .eq('duration', p.row.duration as string)
    if (error) {
      console.error(`  FAILED ${p.row.id}: ${error.message}`)
      failed++
    } else {
      ok++
    }
  }
  console.log(`\nApplied: ${ok} ok, ${failed} failed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

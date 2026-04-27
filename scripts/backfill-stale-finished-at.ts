// scripts/backfill-stale-finished-at.ts
//
// Repairs `matches.finished_at` for FIP-only matches that were mis-stamped
// with the cron's `captured_at` instead of the actual play day.
//
// Root cause: pre-fix, padelgod's fip-results-writer + static-reconciler
// fell back to `captured_at` when `started_at + duration` were missing —
// which is always the case for matches scraped via the static results
// widget (no live-poller observation). Effect: every R32/R16/QF was
// stamped with whichever day the cron last ran, instead of each round's
// real play day.
//
// Fix (in code, separately): use `tournament.starts_at + (day_number - 1)
// days` at 12:00 UTC as a tier between "started_at + duration" and
// "captured_at". This script recomputes finished_at for matches already
// in the bad state.
//
// Detection heuristic: any match where finished_at > tournament.ends_at + 1d.
//
// Usage:
//   npx tsx scripts/backfill-stale-finished-at.ts --dry-run
//   npx tsx scripts/backfill-stale-finished-at.ts
//   npx tsx scripts/backfill-stale-finished-at.ts --tournament <uuid>

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  const content = fs.readFileSync(envPath, 'utf8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[key]) process.env[key] = value
  }
}
loadEnv()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const TOUR_IDX = args.indexOf('--tournament')
const TOUR_FILTER = TOUR_IDX >= 0 ? args[TOUR_IDX + 1] : null

const ONE_DAY_MS = 86_400_000

interface MatchRow {
  id: string
  widget_id_composite: string | null
  finished_at: string
  tournament_id: string
}

interface TournamentRow {
  id: string
  starts_at: string | null
  ends_at: string | null
  name: string
}

interface SnapshotRow {
  match_widget_id: string | null
  day_number: number
  captured_at: string
}

function dayCursorIso(startsAtIso: string, dayNumber: number): string {
  const t = new Date(startsAtIso)
  t.setUTCDate(t.getUTCDate() + (dayNumber - 1))
  t.setUTCHours(12, 0, 0, 0)
  return t.toISOString()
}

async function main() {
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Scanning for matches with finished_at past tournament window...`)

  // Step 1: pull tournaments (filtered if --tournament passed)
  let tourQuery = supabase
    .from('tournaments')
    .select('id, starts_at, ends_at, name')
    .not('starts_at', 'is', null)
    .not('ends_at', 'is', null)

  if (TOUR_FILTER) tourQuery = tourQuery.eq('id', TOUR_FILTER)

  const { data: tournaments, error: tErr } = await tourQuery
  if (tErr) {
    console.error('tournaments query failed:', tErr)
    process.exit(1)
  }
  const tours = (tournaments ?? []) as TournamentRow[]
  const tourById = new Map(tours.map((t) => [t.id, t]))

  if (tours.length === 0) {
    console.log('No tournaments matched the filter.')
    return
  }

  console.log(`Loaded ${tours.length} tournaments.`)

  // Step 2: pull candidate matches — those whose finished_at is more than
  // 1 day past their tournament's ends_at. Done in one round-trip per
  // tournament to keep the queries simple.
  const candidates: Array<MatchRow & { tour: TournamentRow }> = []
  for (const tour of tours) {
    if (!tour.ends_at) continue
    const cutoff = new Date(Date.parse(tour.ends_at) + ONE_DAY_MS).toISOString()

    const { data: matches, error: mErr } = await supabase
      .from('matches')
      .select('id, widget_id_composite, finished_at, tournament_id')
      .eq('tournament_id', tour.id)
      .not('finished_at', 'is', null)
      .gt('finished_at', cutoff)

    if (mErr) {
      console.error(`matches query failed (tournament=${tour.id}):`, mErr)
      continue
    }
    for (const m of (matches ?? []) as MatchRow[]) {
      candidates.push({ ...m, tour })
    }
  }

  console.log(`Found ${candidates.length} candidate matches with stale finished_at.`)

  if (candidates.length === 0) return

  // Step 3: pull latest results_snapshots per (tournament, match_widget_id)
  // for the affected tournaments only.
  const tournamentIds = Array.from(new Set(candidates.map((c) => c.tournament_id)))
  const widgetSnapshots = new Map<string, SnapshotRow>() // key: `${tour}:${widgetShort}`

  for (const tid of tournamentIds) {
    const { data: snaps, error: sErr } = await supabase
      .schema('padelgod')
      .from('results_snapshots')
      .select('match_widget_id, day_number, captured_at')
      .eq('tournament_id', tid)

    if (sErr) {
      console.error(`results_snapshots query failed (tournament=${tid}):`, sErr)
      continue
    }
    for (const s of (snaps ?? []) as SnapshotRow[]) {
      if (!s.match_widget_id) continue
      const key = `${tid}:${s.match_widget_id}`
      const prev = widgetSnapshots.get(key)
      if (!prev || s.captured_at > prev.captured_at) widgetSnapshots.set(key, s)
    }
  }

  // Step 4: for each candidate, derive widget short id from widget_id_composite,
  // look up snapshot, compute new finished_at, write.
  let repaired = 0
  let skippedNoComposite = 0
  let skippedNoSnapshot = 0
  let skippedNoStartsAt = 0

  for (const m of candidates) {
    if (!m.widget_id_composite) {
      skippedNoComposite += 1
      continue
    }
    const colonIdx = m.widget_id_composite.indexOf(':')
    if (colonIdx < 0) {
      skippedNoComposite += 1
      continue
    }
    const widgetShort = m.widget_id_composite.slice(colonIdx + 1)
    const snap = widgetSnapshots.get(`${m.tournament_id}:${widgetShort}`)
    if (!snap) {
      skippedNoSnapshot += 1
      continue
    }
    if (!m.tour.starts_at) {
      skippedNoStartsAt += 1
      continue
    }

    const newFinishedAt = dayCursorIso(m.tour.starts_at, snap.day_number)

    if (newFinishedAt === m.finished_at) continue

    console.log(
      `  ${m.tour.name} :: ${widgetShort} :: day=${snap.day_number} :: ${m.finished_at} → ${newFinishedAt}`,
    )

    if (!DRY_RUN) {
      const { error: uErr } = await supabase
        .from('matches')
        .update({ finished_at: newFinishedAt })
        .eq('id', m.id)
      if (uErr) {
        console.error(`  UPDATE failed for ${m.id}:`, uErr)
        continue
      }
    }
    repaired += 1
  }

  console.log('')
  console.log('Summary:')
  console.log(`  Repaired:           ${repaired}${DRY_RUN ? ' (dry run, no writes)' : ''}`)
  console.log(`  Skipped (no composite): ${skippedNoComposite}`)
  console.log(`  Skipped (no snapshot):  ${skippedNoSnapshot}`)
  console.log(`  Skipped (no starts_at): ${skippedNoStartsAt}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

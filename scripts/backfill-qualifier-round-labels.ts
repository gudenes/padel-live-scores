/**
 * Backfill qualifier round labels (R32/R16/QF/SF/F → Q1/Q2/Q3/...) on
 * historical draw_snapshots and public.matches rows captured before the
 * qualifier-aware parser shipped.
 *
 * Pipeline
 *  1. For every (tournament_id, category) in padelgod.draw_snapshots
 *     with draw_type='qualifying' AND round_label IN (R32/R16/QF/SF/F):
 *     - Collect the distinct main-draw labels and map to Q-labels by
 *       descending bracket size (largest = Q1).
 *     - Emit an UPDATE per snapshot row swapping the label.
 *  2. For every public.matches row whose widget_id_composite ends in a
 *     qualifier widget (MQ.../WQ...) AND round IN (R32/R16/QF/SF/F):
 *     - Look up the corrected label from the (tournament, category)
 *       map and UPDATE matches.round in place.
 *
 * Usage:
 *   npx tsx scripts/backfill-qualifier-round-labels.ts             # dry-run
 *   npx tsx scripts/backfill-qualifier-round-labels.ts --apply      # write
 *   npx tsx scripts/backfill-qualifier-round-labels.ts --tournament <id>
 *
 * Idempotent: rerunning after a successful apply is a no-op (rows already
 * have Q-labels and won't match the filters).
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"(.*)"$/, '$1')
    }
  } catch {}
}
loadEnv()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } },
)

const MAIN_DRAW_LABELS = new Set(['R64', 'R32', 'R16', 'QF', 'SF', 'F'])

// Map a sorted-desc list of bracket sizes → Q-labels. Mirrors parseFipEventDraw.
function buildQLabelMap(matchCounts: Map<string, number>): Map<string, string> {
  // matchCounts: round_label → count of matches in that round
  // Sort descending by count → largest round = Q1, etc.
  const sorted = [...matchCounts.entries()].sort((a, b) => b[1] - a[1])
  const out = new Map<string, string>()
  sorted.forEach(([label], idx) => out.set(label, `Q${idx + 1}`))
  return out
}

interface Args {
  apply: boolean
  tournamentId: string | null
  /** When true, skip the snapshot relabel pass (cosmetic / audit-trail
   *  rows; the populator only reads the latest captured_at) and only
   *  fix public.matches. Use when the snapshot pass would take too
   *  long and you only need the user-visible matches fix. */
  matchesOnly: boolean
}
function parseArgs(): Args {
  const apply = process.argv.includes('--apply')
  const matchesOnly = process.argv.includes('--matches-only')
  const tIdx = process.argv.indexOf('--tournament')
  const tournamentId = tIdx >= 0 ? (process.argv[tIdx + 1] ?? null) : null
  return { apply, tournamentId, matchesOnly }
}

async function main() {
  const { apply, tournamentId, matchesOnly } = parseArgs()
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}${tournamentId ? ` | tournament=${tournamentId}` : ''}${matchesOnly ? ' | MATCHES ONLY' : ''}\n`)

  // 1. Pull draw_snapshots for qualifying brackets with stale labels.
  //    Paginated — global query can easily exceed the 10k PostgREST cap.
  const PAGE = 1000
  const snaps: Array<{ id: string; tournament_id: string; category: string; round_label: string; match_widget_id: string | null; captured_at: string }> = []
  for (let start = 0; ; start += PAGE) {
    let snapQ = supabase
      .schema('padelgod')
      .from('draw_snapshots')
      .select('id, tournament_id, category, round_label, match_widget_id, captured_at')
      .eq('draw_type', 'qualifying')
      .in('round_label', ['R64', 'R32', 'R16', 'QF', 'SF', 'F'])
      .order('id', { ascending: true })
      .range(start, start + PAGE - 1)
    if (tournamentId) snapQ = snapQ.eq('tournament_id', tournamentId)
    const { data, error } = await snapQ
    if (error) throw new Error(`draw_snapshots read: ${error.message}`)
    if (!data || data.length === 0) break
    snaps.push(...(data as any))
    if (data.length < PAGE) break
  }
  console.log(`draw_snapshots rows with stale qualifier labels: ${snaps.length}`)

  // 2. Per (tournament, category) build a label remap from the LATEST
  //    captured_at snapshot batch (so we don't conflate multiple versions
  //    of the same bracket).
  type Key = string // `${tid}::${cat}`
  const latestCapturedAt = new Map<Key, string>()
  for (const r of snaps) {
    const k = `${r.tournament_id}::${r.category}`
    const prev = latestCapturedAt.get(k)
    if (!prev || r.captured_at > prev) latestCapturedAt.set(k, r.captured_at)
  }

  // For the latest batch, count matches per round_label per (t, cat).
  const matchCountByKey = new Map<Key, Map<string, number>>()
  for (const r of snaps) {
    const k = `${r.tournament_id}::${r.category}`
    if (r.captured_at !== latestCapturedAt.get(k)) continue
    if (!matchCountByKey.has(k)) matchCountByKey.set(k, new Map())
    const counts = matchCountByKey.get(k)!
    counts.set(r.round_label, (counts.get(r.round_label) ?? 0) + 1)
  }

  // Build remap per key.
  const remapByKey = new Map<Key, Map<string, string>>()
  for (const [k, counts] of matchCountByKey) {
    remapByKey.set(k, buildQLabelMap(counts))
  }

  // Print the remap plan
  console.log('\nRemap plan (per tournament+category):')
  for (const [k, remap] of remapByKey) {
    console.log(`  ${k}`)
    for (const [from, to] of remap) console.log(`    ${from} → ${to}`)
  }

  // 3. Update draw_snapshots in place. We re-label EVERY stale snapshot
  //    (including older captured_at batches) using the latest-batch remap
  //    keyed by the same matchCount mapping. If the older batch has a
  //    label not present in the latest (e.g. bracket grew), we leave it
  //    alone — that's a different parse generation.
  let snapUpdates = 0
  if (!matchesOnly) {
    for (const r of snaps) {
      const k = `${r.tournament_id}::${r.category}`
      const remap = remapByKey.get(k)
      if (!remap) continue
      const newLabel = remap.get(r.round_label)
      if (!newLabel) continue
      snapUpdates++
      if (apply) {
        const { error } = await supabase
          .schema('padelgod')
          .from('draw_snapshots')
          .update({ round_label: newLabel })
          .eq('id', r.id)
        if (error) console.error(`  draw_snapshots update id=${r.id} failed: ${error.message}`)
        if (snapUpdates % 500 === 0) console.log(`  draw_snapshots progress: ${snapUpdates} updated`)
      }
    }
    console.log(`\ndraw_snapshots: ${apply ? 'updated' : 'would update'} ${snapUpdates} rows`)
  } else {
    console.log(`\ndraw_snapshots: skipped (--matches-only)`)
  }

  // 4. Update public.matches. Filter to qualifier widgets with stale labels.
  let mQ = supabase
    .from('matches')
    .select('id, tournament_id, category, round, widget_id_composite')
    .in('round', ['R64', 'R32', 'R16', 'QF', 'SF', 'F'])
    .not('widget_id_composite', 'is', null)
  if (tournamentId) mQ = mQ.eq('tournament_id', tournamentId)
  const { data: matches, error: mErr } = await mQ
  if (mErr) throw new Error(`matches read: ${mErr.message}`)

  // Filter client-side to qualifier widgets only (composite is "<tw>:<mw>";
  // <mw> starts with MQ/WQ for qualifier rows). Safer than a SQL LIKE on
  // a substring of the composite.
  const qualifierMatches = (matches ?? []).filter((m) => {
    const mw = m.widget_id_composite?.split(':').pop() ?? ''
    return /^[MW]Q/i.test(mw)
  })
  console.log(`\npublic.matches rows on qualifier widgets with stale labels: ${qualifierMatches.length}`)

  let matchUpdates = 0
  let matchSkipped = 0
  for (const m of qualifierMatches) {
    const k = `${m.tournament_id}::${m.category}`
    const remap = remapByKey.get(k)
    if (!remap) { matchSkipped++; continue }
    const newLabel = remap.get(m.round!)
    if (!newLabel) { matchSkipped++; continue }
    matchUpdates++
    if (apply) {
      const { error } = await supabase
        .from('matches')
        .update({ round: newLabel })
        .eq('id', m.id)
      if (error) console.error(`  matches update id=${m.id} failed: ${error.message}`)
    } else {
      console.log(`  ${m.widget_id_composite}: ${m.round} → ${newLabel}`)
    }
  }
  console.log(`\npublic.matches: ${apply ? 'updated' : 'would update'} ${matchUpdates} rows (skipped ${matchSkipped} with no remap)`)

  if (!apply) console.log('\nRe-run with --apply to write changes.')
}

main().catch((e) => { console.error(e); process.exit(1) })

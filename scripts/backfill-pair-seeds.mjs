// One-off backfill: fill `public.matches.pair1_seed` / `pair2_seed`
// from the latest `padelgod.draw_snapshots` row per match_widget_id.
// Runs against every widget-composite match across all tournaments
// (live + recently-finished), with NULL-only writes so we never
// clobber a value already present.
//
// After the populator deploys this becomes a no-op, but running it
// here surfaces seeds immediately on existing rows (any UI rolling
// out today doesn't want to wait for the next :47 cycle).

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

async function loadEnv() {
  const text = await fs.readFile(path.resolve('.env.local'), 'utf8')
  for (const line of text.split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}
await loadEnv()
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const apply = process.argv.includes('--apply')

const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
const { data: tournaments } = await sb.from('tournaments')
  .select('id, name, level')
  .gte('ends_at', cutoff)
  .like('level', 'fip_%')

console.log(`${apply ? '[APPLY]' : '[DRY RUN]'} Backfill pair seeds across ${tournaments?.length ?? 0} FIP-tier tournaments (ends_at >= ${cutoff})\n`)

const totals = { tournaments: 0, withSnapshots: 0, candidates: 0, written: 0, alreadySet: 0 }

for (const t of tournaments ?? []) {
  // Latest draw_snapshot row per match_widget_id (fip_event_page only)
  const { data: ds } = await sb
    .schema('padelgod')
    .from('draw_snapshots')
    .select('match_widget_id, team1_seed, team2_seed, captured_at')
    .eq('tournament_id', t.id)
    .eq('source', 'fip_event_page')
    .not('match_widget_id', 'is', null)
    .order('captured_at', { ascending: false })
    .limit(2000)
  const latest = new Map()
  for (const r of ds ?? []) {
    if (!latest.has(r.match_widget_id)) latest.set(r.match_widget_id, r)
  }
  if (latest.size === 0) continue
  totals.tournaments++
  totals.withSnapshots++

  // Matches with widget composites for this tournament
  const { data: matches } = await sb.from('matches')
    .select('id, widget_id_composite, pair1_seed, pair2_seed')
    .eq('tournament_id', t.id)
    .not('widget_id_composite', 'is', null)
  if (!matches?.length) continue

  let tWritten = 0, tAlreadySet = 0
  for (const m of matches) {
    const tail = m.widget_id_composite?.split(':').pop()
    const ds = latest.get(tail)
    if (!ds) continue
    const patch = {}
    if (m.pair1_seed == null && ds.team1_seed != null) patch.pair1_seed = ds.team1_seed
    if (m.pair2_seed == null && ds.team2_seed != null) patch.pair2_seed = ds.team2_seed
    if (Object.keys(patch).length === 0) {
      if ((m.pair1_seed != null || m.pair2_seed != null)) tAlreadySet++
      continue
    }
    totals.candidates++
    if (!apply) continue
    const { error } = await sb.from('matches').update(patch).eq('id', m.id)
    if (!error) { totals.written++; tWritten++ }
  }
  if (tWritten > 0 || apply === false) {
    console.log(`▸ ${t.name.slice(0, 50).padEnd(50)} ${(t.level ?? '?').padEnd(13)} ${apply ? `wrote ${tWritten}` : `would write ${[...latest.values()].filter(d => d.team1_seed != null || d.team2_seed != null).length} (matched matches)`}`)
  }
}

console.log()
console.log('═══════════════════════════════════════════════════════════════')
console.log(`Tournaments processed: ${totals.tournaments}`)
console.log(`${apply ? 'Wrote' : 'Would write'} pair seeds: ${apply ? totals.written : totals.candidates}`)
if (apply) console.log(`(rows already had at least one seed: ${totals.alreadySet})`)
console.log('═══════════════════════════════════════════════════════════════')
if (!apply) console.log('\nRe-run with --apply to commit.')

// Cross-pipeline duplicate cleanup, narrow flavour: delete a no-source
// match row (no padelapi_id, no widget_id_composite) when an exact
// (category, court, court_order) twin exists with a widget_id_composite.
// The twin's existence is the safety condition — we only drop the
// no-source copy when its data lives on the widget side too.
//
// Why these rows exist
// --------------------
// Two padelgod ingest paths (FIP entry-list / draw populator vs Crionet
// widget reconciler) create rows ~24 min apart. The FIP-side row is
// inserted first with full names + no widget id; the Crionet-side row
// inserts ~24 min later with abbreviated names + a widget id. Pair
// order sometimes flips between the two sources, which is enough to
// trip the existing dedup-fip-same-court token-overlap heuristic.
// Result: every R16/QF/SF/F slot ends up with TWO rows in public.matches
// and the public app's tournament detail page shows the no-source copy
// (which never receives a scheduled_at).
//
// The narrow gate (`same court + same court_order + widget twin
// exists`) makes this safe — court+court_order is a venue-level
// identity, not a heuristic.
//
// Usage:
//   node scripts/dedup-no-source-with-widget-twin.mjs                       # dry-run all live
//   node scripts/dedup-no-source-with-widget-twin.mjs --apply               # apply all live
//   node scripts/dedup-no-source-with-widget-twin.mjs <tournament-id>       # dry-run one
//   node scripts/dedup-no-source-with-widget-twin.mjs <tournament-id> --apply

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
const oneTournament = process.argv.find(a => /^[0-9a-f-]{36}$/i.test(a))

// 1. Pick tournaments to process
let tournaments
if (oneTournament) {
  const { data } = await sb.from('tournaments').select('id, name, level').eq('id', oneTournament)
  tournaments = data ?? []
} else {
  const today = new Date().toISOString().slice(0, 10)
  const { data } = await sb.from('tournaments')
    .select('id, name, level')
    .lte('starts_at', today)
    .gte('ends_at', today)
    .order('level').order('name')
  tournaments = data ?? []
}

console.log(`${apply ? '[APPLY]' : '[DRY RUN]'} Cross-pipeline dedup across ${tournaments.length} tournament(s)\n`)

const totals = { tournamentsTouched: 0, matchesDeleted: 0, setsDeleted: 0, gamesDeleted: 0, pairsScanned: 0 }

for (const t of tournaments) {
  // Pull every match in the tournament with the columns we need
  const { data: matches } = await sb.from('matches')
    .select('id, status, category, court, court_order, round, padelapi_id, widget_id_composite')
    .eq('tournament_id', t.id)

  if (!matches?.length) continue

  // Group by (category, court, court_order). Only process buckets where
  // BOTH a no-source row AND a widget-bearing row coexist.
  const buckets = new Map()
  for (const m of matches) {
    if (m.court == null || m.court_order == null) continue  // gate on identity
    const k = `${m.category ?? '?'}|${m.court}|${m.court_order}`
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(m)
  }

  const targets = []
  for (const [, rows] of buckets) {
    const noSource = rows.filter(r => !r.padelapi_id && !r.widget_id_composite)
    const widgetSide = rows.filter(r => r.widget_id_composite) // widget-only OR merged
    if (noSource.length > 0 && widgetSide.length > 0) {
      // Safe condition met: a widget twin exists. Mark the no-source rows for deletion.
      for (const ns of noSource) targets.push(ns)
    }
  }
  if (targets.length === 0) continue

  totals.tournamentsTouched++
  totals.pairsScanned += targets.length
  console.log(`▸ ${t.name}  (${t.level})`)
  console.log(`   no-source twins to delete: ${targets.length}`)

  // Bucket display so the operator can sanity-check
  const byBucket = {}
  for (const m of targets) {
    const k = `${m.category} ${m.round ?? '?'}`
    byBucket[k] = (byBucket[k] || 0) + 1
  }
  for (const [k, n] of Object.entries(byBucket).sort()) {
    console.log(`     ${k.padEnd(28)} ${n}`)
  }

  if (!apply) {
    console.log()
    continue
  }

  // Delete child rows first (sets/games) to satisfy any FK constraints.
  let deleted = 0
  for (const m of targets) {
    try {
      const { count: sn } = await sb.from('sets').delete({ count: 'exact' }).eq('match_id', m.id)
      totals.setsDeleted += sn ?? 0
      const { count: gn } = await sb.from('games').delete({ count: 'exact' }).eq('match_id', m.id)
      totals.gamesDeleted += gn ?? 0
      const { error } = await sb.from('matches').delete().eq('id', m.id)
      if (error) throw new Error(error.message)
      deleted++
    } catch (e) {
      console.log(`     ✗ ${m.id.slice(0, 8)}: ${e.message}`)
    }
  }
  totals.matchesDeleted += deleted
  console.log(`     ✓ deleted ${deleted}/${targets.length}\n`)
}

console.log('═══════════════════════════════════════════════════════════════')
console.log(`${apply ? 'Applied' : 'Would delete'}:`)
console.log(`  tournaments touched: ${totals.tournamentsTouched}`)
console.log(`  no-source rows:      ${totals.pairsScanned}`)
if (apply) {
  console.log(`  matches deleted:     ${totals.matchesDeleted}`)
  console.log(`  sets deleted:        ${totals.setsDeleted}`)
  console.log(`  games deleted:       ${totals.gamesDeleted}`)
}
console.log('═══════════════════════════════════════════════════════════════')
if (!apply) {
  console.log('\nRe-run with --apply to commit.')
}

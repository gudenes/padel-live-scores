// Coverage audit: for every tournament that has matches, classify which
// pipeline produced the rows. Goal: find tournaments where the LEGACY
// static-reconciler is the SOLE source — those would be orphaned by a
// hard-disable of reconcileDraws.

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

// 1. Active + recently-finished tournaments (≤ 7 days past ends_at).
//    Old finished tournaments don't matter for the cutover decision.
const cutoff = new Date(Date.now() - 7*86400_000).toISOString().slice(0,10)
const { data: tournaments } = await sb.from('tournaments')
  .select('id, name, level, country, starts_at, ends_at')
  .gte('ends_at', cutoff)
  .order('level').order('ends_at', { ascending: false })

console.log(`Tournaments with ends_at ≥ ${cutoff}: ${tournaments?.length ?? 0}\n`)

const summary = {
  populatorOnly: 0,         // widget rows only — safe to disable reconciler
  reconcilerOnly: 0,        // legacy rows only — would orphan
  bothPipelines: 0,         // both, with widget rows present (the dup case)
  noMatches: 0,             // tournament has no rows yet
}
const concerns = []

for (const t of tournaments ?? []) {
  // Real-composite rows from fip-draw-populator
  const { count: widgetCount } = await sb.from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', t.id)
    .not('widget_id_composite', 'is', null)

  // Legacy reconciler rows — widget_id_composite NULL but a "draw:*" sidecar exists
  const { count: anyCount } = await sb.from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', t.id)

  const { count: legacyComposite } = await sb.from('entity_external_ids')
    .select('entity_id', { count: 'exact', head: true })
    .eq('entity_type', 'match')
    .like('external_id', 'draw:%')

  // Sample no-source rows in this tournament + whether they have a "draw:" sidecar
  const { data: noSourceRows } = await sb.from('matches')
    .select('id, round, category, court')
    .eq('tournament_id', t.id)
    .is('widget_id_composite', null)
    .is('padelapi_id', null)
    .limit(10)

  let legacyHits = 0
  for (const m of noSourceRows ?? []) {
    const { count: hit } = await sb.from('entity_external_ids')
      .select('entity_id', { count: 'exact', head: true })
      .eq('entity_type', 'match').eq('entity_id', m.id)
      .like('external_id', 'draw:%')
    if (hit && hit > 0) legacyHits++
  }
  // Extrapolate: if every sampled no-source has a legacy sidecar, the rest probably do too
  const noSourceCount = anyCount - widgetCount
  const looksLegacy = noSourceRows?.length === 0 ? false :
    legacyHits === noSourceRows.length

  let bucket
  if ((anyCount ?? 0) === 0) bucket = 'noMatches'
  else if (widgetCount > 0 && noSourceCount === 0) bucket = 'populatorOnly'
  else if (widgetCount === 0 && noSourceCount > 0) bucket = 'reconcilerOnly'
  else if (widgetCount > 0 && noSourceCount > 0) bucket = 'bothPipelines'
  else bucket = 'noMatches'

  summary[bucket]++

  if (bucket === 'reconcilerOnly') {
    concerns.push({ t, anyCount, noSourceCount, widgetCount, looksLegacy, legacyHits })
  }

  const flag =
    bucket === 'populatorOnly' ? '✓ populator only' :
    bucket === 'reconcilerOnly' ? '⚠ RECONCILER ONLY' :
    bucket === 'bothPipelines' ? '· both' :
    '· empty'
  console.log(`  ${flag.padEnd(22)} ${(t.level ?? '?').padEnd(13)} ${(t.country ?? '??').padEnd(3)} ${t.name.slice(0, 50).padEnd(50)} widget=${widgetCount} no-source=${noSourceCount}`)
}

console.log()
console.log('═══════════════════════════════════════════════════════════════')
console.log(`Summary across ${tournaments?.length ?? 0} tournaments (last 7 days):`)
console.log(`  populator only:    ${summary.populatorOnly}  ✓ safe`)
console.log(`  both pipelines:    ${summary.bothPipelines}  · widget side preserved on disable`)
console.log(`  reconciler only:   ${summary.reconcilerOnly}  ⚠ would orphan if disabled`)
console.log(`  no matches:        ${summary.noMatches}`)
console.log('═══════════════════════════════════════════════════════════════')

if (concerns.length) {
  console.log('\n⚠ Tournaments that depend on legacy reconciler:')
  for (const c of concerns) {
    console.log(`   ${c.t.name}  (${c.t.level}, ${c.t.country})`)
    console.log(`     ${c.t.starts_at?.slice(0,10)} → ${c.t.ends_at?.slice(0,10)}  ·  no-source=${c.noSourceCount}, sidecar match=${c.legacyHits}/${Math.min(10, c.noSourceCount)}`)
  }
}

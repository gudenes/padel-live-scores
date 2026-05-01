// Dry-run summary: how many padelapi-only rows would be deleted from
// each currently-running tournament if we ran delete-padelapi-only-from-
// tournament across all of them.
//
// Read-only. Use scripts/delete-padelapi-only-from-tournament.mjs to
// actually delete (per-tournament, with --apply).

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

const today = new Date().toISOString().slice(0, 10)
const { data: tournaments } = await sb.from('tournaments')
  .select('id, name, level, country, starts_at, ends_at')
  .lte('starts_at', today)
  .gte('ends_at', today)
  .order('level', { ascending: true })
  .order('name', { ascending: true })

console.log(`Currently live: ${tournaments?.length ?? 0} tournaments\n`)

let totalToDelete = 0
const summaries = []

for (const t of tournaments ?? []) {
  // Padelapi-only rows = padelapi_id set, widget_id_composite null
  const { data: targets } = await sb.from('matches')
    .select('id, status, round, category')
    .eq('tournament_id', t.id)
    .not('padelapi_id', 'is', null)
    .is('widget_id_composite', null)

  // Total rows in tournament for context
  const { count: totalCount } = await sb.from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', t.id)

  // Bucket the targets by round for the breakdown
  const byBucket = {}
  for (const m of targets ?? []) {
    const k = `${m.category ?? '?'} ${m.round ?? '?'}`
    byBucket[k] = (byBucket[k] || 0) + 1
  }

  summaries.push({
    name: t.name,
    level: t.level,
    country: t.country,
    total: totalCount ?? 0,
    targets: targets?.length ?? 0,
    breakdown: byBucket,
  })

  totalToDelete += targets?.length ?? 0
}

// Render
for (const s of summaries) {
  const flag = s.targets === 0 ? '✓ clean' : `⚠ ${s.targets} to delete`
  console.log(`${flag.padEnd(20)} ${s.name}  (${s.level}, ${s.country})`)
  console.log(`  total rows: ${s.total}  ·  padelapi-only: ${s.targets}`)
  if (s.targets > 0) {
    for (const [k, n] of Object.entries(s.breakdown).sort()) {
      console.log(`    ${k.padEnd(28)} ${n}`)
    }
  }
  console.log()
}

console.log('═══════════════════════════════════════════════════════════════')
console.log(`TOTAL padelapi-only rows across ${tournaments?.length ?? 0} live tournaments: ${totalToDelete}`)
console.log('═══════════════════════════════════════════════════════════════')
console.log('\nTo apply per tournament:')
for (const s of summaries) {
  if (s.targets === 0) continue
  const id = (tournaments ?? []).find(t => t.name === s.name)?.id
  console.log(`  node scripts/delete-padelapi-only-from-tournament.mjs ${id} --apply  # ${s.name}`)
}

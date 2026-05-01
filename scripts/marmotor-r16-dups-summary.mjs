// Summarise the R16 duplicate situation in Marmotor: each match appears
// twice — once as widget (with scheduled_at correctly populated) and
// once as no-source (the twin shown on the tournament detail page,
// which lacks scheduled_at). Confirm the count + show created_at to
// see which side arrived first.

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

const T = 'ff200835-44d3-4c2f-8d6b-07a9e6f45793'

const { data } = await sb.from('matches')
  .select(`
    id, status, court, court_order, category, scheduled_at, schedule_label,
    widget_id_composite, padelapi_id, last_updated_by, created_at, updated_at,
    pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name
  `)
  .eq('tournament_id', T)
  .in('round', ['Round of 16', 'R16'])
  .order('category')
  .order('court')
  .order('court_order')

function classify(m) {
  if (m.padelapi_id && m.widget_id_composite) return 'merged'
  if (m.padelapi_id) return 'padelapi-only'
  if (m.widget_id_composite) return 'widget-only'
  return 'no-source'
}

const counts = { widget: 0, merged: 0, 'no-source': 0, 'padelapi-only': 0 }
for (const m of data ?? []) {
  const c = classify(m)
  counts[c === 'widget-only' ? 'widget' : c] = (counts[c === 'widget-only' ? 'widget' : c] || 0) + 1
}
console.log('Marmotor R16 row counts by source:')
for (const [k, n] of Object.entries(counts)) console.log(`  ${k.padEnd(15)} ${n}`)
console.log(`  TOTAL           ${data?.length ?? 0}\n`)

// Pair widget+no-source by (court, court_order, category)
const groups = new Map()
for (const m of data ?? []) {
  const k = `${m.category}|${m.court}|${m.court_order}`
  if (!groups.has(k)) groups.set(k, [])
  groups.get(k).push(m)
}

console.log('Per (category, court, co) bucket — paired widget vs no-source:')
let pairedDups = 0
let noSourceOrphans = 0
let widgetSingletons = 0
for (const [k, rows] of [...groups].sort()) {
  const sources = rows.map(classify)
  const hasWidget = sources.some(s => s === 'widget-only' || s === 'merged')
  const hasNoSource = sources.some(s => s === 'no-source')
  if (hasWidget && hasNoSource) pairedDups++
  else if (!hasWidget && hasNoSource) noSourceOrphans++
  else if (hasWidget && !hasNoSource) widgetSingletons++

  if (rows.length > 1) {
    console.log(`\n  ${k}  (${rows.length} rows)`)
    for (const m of rows) {
      const tail = m.widget_id_composite?.split(':').pop() ?? '-'
      const sched = m.scheduled_at?.slice(0, 16).replace('T', ' ') ?? 'NULL'
      console.log(`    ${m.id.slice(0, 8)} ${classify(m).padEnd(13)} widget=${tail.padEnd(6)} sched=${sched.padEnd(17)} created=${m.created_at?.slice(0, 16)} updated=${m.updated_at?.slice(0, 16)}`)
    }
  }
}

console.log(`\nSummary:`)
console.log(`  paired duplicates (widget + no-source twin): ${pairedDups}`)
console.log(`  no-source orphans (no widget twin):           ${noSourceOrphans}`)
console.log(`  widget singletons (no no-source dup):         ${widgetSingletons}`)

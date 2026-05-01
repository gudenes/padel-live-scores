// Why are MD028, MD029, MD023 missing from public.matches even though
// padelgod's OOP captured them? Three places to check:
//   1. draw_snapshots — does the Crionet draw widget include them?
//   2. entity_external_ids — was a match row ever linked to them?
//   3. results_snapshots — did Crionet's results widget see them?

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

const TOURNAMENT_ID = 'bbf33680-573c-4a33-9532-092346b7bd46'
const MISSING = ['MD028', 'MD029', 'MD023']

console.log('Checking the 3 missing widget IDs:', MISSING.join(', '), '\n')

// 1. Latest draw snapshot for this tournament
const { data: latestDraw } = await sb
  .schema('padelgod')
  .from('draw_snapshots')
  .select('captured_at')
  .eq('tournament_id', TOURNAMENT_ID)
  .order('captured_at', { ascending: false })
  .limit(1)

if (!latestDraw?.length) {
  console.log('❌ NO draw_snapshots rows for this tournament — that\'s the gap.')
} else {
  const latestAt = latestDraw[0].captured_at
  console.log(`Latest draw_snapshot: ${latestAt}`)

  const { data: drawRows, error: e } = await sb
    .schema('padelgod')
    .from('draw_snapshots')
    .select('*')
    .eq('tournament_id', TOURNAMENT_ID)
    .eq('captured_at', latestAt)

  if (e) console.log('  err:', e.message)
  else {
    console.log(`  ${drawRows?.length} rows captured`)
    if (drawRows?.[0]) console.log('  cols:', Object.keys(drawRows[0]))

    // Search for our missing widget IDs
    const widgetCol = drawRows?.[0]?.match_widget_id !== undefined
      ? 'match_widget_id'
      : drawRows?.[0]?.widget_id !== undefined ? 'widget_id' : null
    if (widgetCol) {
      const found = (drawRows ?? []).filter(r => MISSING.includes(r[widgetCol]))
      console.log(`\n  Missing widgets in draw: ${found.length}`)
      for (const r of found) {
        console.log(`    ${r[widgetCol]}: ${JSON.stringify(r).slice(0, 200)}`)
      }
      const allWidgets = [...new Set((drawRows ?? []).map(r => r[widgetCol]).filter(Boolean))].sort()
      console.log(`  All widget IDs in draw (${allWidgets.length}): ${allWidgets.join(', ')}`)
    }
  }
}
console.log()

// 2. entity_external_ids for these widget composites
console.log('── entity_external_ids lookup ──')
for (const w of MISSING) {
  const composite = `FIP-2026-bbf33680:${w}`
  const { data } = await sb.from('entity_external_ids')
    .select('entity_type, entity_id, source, external_id')
    .eq('source', 'widget')
    .ilike('external_id', `%${w}`)
  console.log(`  ${w}: ${data?.length ?? 0} sidecar rows`)
  for (const r of data ?? []) console.log(`    → ${r.external_id}  ${r.entity_type}=${r.entity_id?.slice(0,8)}`)
}
console.log()

// 3. matches table widget_id_composite scan for this tournament
const { data: dbMatches } = await sb.from('matches')
  .select('id, widget_id_composite, court, court_order')
  .eq('tournament_id', TOURNAMENT_ID)
  .not('widget_id_composite', 'is', null)
const widgetsInDb = new Set((dbMatches ?? []).map(m => m.widget_id_composite?.split(':').pop()).filter(Boolean))
console.log('Widget suffixes already in public.matches for this tournament:')
const sorted = [...widgetsInDb].sort()
console.log(`  ${sorted.length} entries: ${sorted.join(', ')}`)
console.log()
for (const w of MISSING) {
  console.log(`  ${w} present in matches? ${widgetsInDb.has(w) ? '✓' : '❌'}`)
}

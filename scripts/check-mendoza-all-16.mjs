// Look at all 16 Mendoza day-3 matches to see why some got scheduled_at
// and the 3 missing did not. Check last_updated_by + updated_at for clues.

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

const T = 'bbf33680-573c-4a33-9532-092346b7bd46'

// All 16 widgets from OOP day 3
const ALL_16 = ['MD016','MD017','MD018','MD019','MD020','MD021','MD022','MD023','MD024','MD025','MD026','MD027','MD028','MD029','MD030','MD031']

const { data } = await sb.from('matches')
  .select(`
    id, status, court, court_order, round,
    scheduled_at, finished_at, started_at, schedule_label,
    last_updated_by, created_at, updated_at,
    widget_id_composite
  `)
  .eq('tournament_id', T)
  .in('round', ['Round of 32', 'R32'])
  .order('court')
  .order('court_order')

const rows = (data ?? []).filter(m => {
  const tail = m.widget_id_composite?.split(':').pop()
  return tail && ALL_16.includes(tail)
})

// Group by court+co for output
rows.sort((a, b) => {
  if (a.court !== b.court) return (a.court ?? '').localeCompare(b.court ?? '')
  return (a.court_order ?? 0) - (b.court_order ?? 0)
})

console.log('All 16 R32 matches in DB (sorted by court, court_order):\n')
console.log('court           co widget   scheduled_at              schedule_label       updated_by  updated_at')
console.log('─'.repeat(130))
for (const m of rows) {
  const tail = m.widget_id_composite?.split(':').pop()
  const sch = m.scheduled_at ? m.scheduled_at.slice(0, 19).replace('T', ' ') : 'NULL'.padEnd(19)
  console.log(`${(m.court ?? '?').padEnd(15)} ${String(m.court_order ?? '-').padStart(2)} ${tail?.padEnd(8)} ${sch.padEnd(25)} ${(m.schedule_label ?? 'NULL').padEnd(20)} ${(m.last_updated_by ?? 'NULL').padEnd(11)} ${(m.updated_at ?? 'NULL').slice(0,19)}`)
}
console.log()

// Compare with OOP — fetch latest day-3 OOP rows
const { data: oopRows } = await sb
  .schema('padelgod')
  .from('oop_snapshots')
  .select('captured_at, court, court_position, scheduled_label, match_widget_id, day_number')
  .eq('tournament_id', T)
  .eq('day_number', 3)
  .order('captured_at', { ascending: false })

// Pick latest snapshot's day-3 rows
const latestAt = oopRows?.[0]?.captured_at
const latestDay3 = (oopRows ?? []).filter(r => r.captured_at === latestAt)

console.log('OOP scheduled_label per widget (from latest snapshot):')
const byWidget = new Map()
for (const r of latestDay3) byWidget.set(r.match_widget_id, r)
for (const w of ALL_16) {
  const o = byWidget.get(w)
  console.log(`  ${w} → ${(o?.court ?? '?').padEnd(15)} cp=${o?.court_position ?? '-'}  "${o?.scheduled_label ?? 'null'}"`)
}

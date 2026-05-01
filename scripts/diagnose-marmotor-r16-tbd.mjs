// Why are BMW Marmotor R16 matches showing TBD on the tournament detail
// page? Check both the OOP capture (does padelgod know these matches)
// and the public.matches state (status / scheduled_at / widget linkage).

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

const { data: tours } = await sb.from('tournaments')
  .select('id, name, level, country, timezone, starts_at, ends_at')
  .ilike('name', '%MARMOTOR%')
  .gte('ends_at', '2026-04-29')
for (const t of tours ?? []) console.log('  candidate:', t.name, t.level, t.id)
const tour = (tours ?? []).find(t => t.level === 'fip_silver')
if (!tour) { console.error('No fip_silver Marmotor found'); process.exit(1) }
console.log(`Tournament: ${tour.name}`)
console.log(`  id=${tour.id}  tz=${tour.timezone ?? '(null)'}  ${tour.starts_at?.slice(0,10)} → ${tour.ends_at?.slice(0,10)}\n`)

// 1. R16 matches in DB
const { data: r16 } = await sb.from('matches')
  .select(`
    id, status, court, court_order, round, category,
    scheduled_at, finished_at, schedule_label,
    last_updated_by, updated_at,
    widget_id_composite, padelapi_id,
    pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name,
    pair1_player1:players!matches_pair1_player1_id_fkey(name),
    pair1_player2:players!matches_pair1_player2_id_fkey(name),
    pair2_player1:players!matches_pair2_player1_id_fkey(name),
    pair2_player2:players!matches_pair2_player2_id_fkey(name)
  `)
  .eq('tournament_id', tour.id)
  .in('round', ['Round of 16', 'R16'])
  .order('category')
  .order('court')
  .order('court_order')

console.log(`R16 matches in DB: ${r16?.length ?? 0}\n`)
const stats = { withScheduled: 0, withoutScheduled: 0, withWidget: 0, withCourtOrder: 0 }
for (const m of r16 ?? []) {
  const widgetTail = m.widget_id_composite?.split(':').pop() ?? null
  const src = m.padelapi_id && m.widget_id_composite ? 'merged' : m.padelapi_id ? 'padelapi' : m.widget_id_composite ? 'widget' : 'no-source'
  const players = []
  for (const pair of [1, 2]) {
    for (const pos of [1, 2]) {
      const fk = m[`pair${pair}_player${pos}`]?.name
      const inline = m[`pair${pair}_player${pos}_name`]
      players.push((fk ?? inline ?? '—').slice(0, 22))
    }
  }
  if (m.scheduled_at) stats.withScheduled++; else stats.withoutScheduled++
  if (widgetTail) stats.withWidget++
  if (m.court_order != null) stats.withCourtOrder++
  const sched = m.scheduled_at ? m.scheduled_at.slice(0, 16).replace('T', ' ') : 'NULL'.padEnd(16)
  console.log(`  ${(m.category ?? '?').padEnd(6)} ${(m.court ?? '?').slice(0, 22).padEnd(22)} co=${String(m.court_order ?? '-').padStart(2)} ${(widgetTail ?? '?').padEnd(7)} ${src.padEnd(8)} sched=${sched.padEnd(18)} label="${m.schedule_label ?? 'NULL'}"`)
  console.log(`    ${players[0]}/${players[1]} vs ${players[2]}/${players[3]}`)
}
console.log()
console.log(`Stats: ${stats.withScheduled} with scheduled_at · ${stats.withoutScheduled} without · ${stats.withWidget} with widget · ${stats.withCourtOrder} with court_order\n`)

// 2. OOP capture for the R16 widget IDs — does padelgod know about these
const r16WidgetTails = new Set((r16 ?? []).map(m => m.widget_id_composite?.split(':').pop()).filter(Boolean))
console.log(`R16 widget tails to look up in OOP: ${[...r16WidgetTails].sort().join(', ')}\n`)

const { data: oopRows } = await sb
  .schema('padelgod')
  .from('oop_snapshots')
  .select('captured_at, day_number, day_date, court, court_position, scheduled_label, round_label, category, status, match_widget_id')
  .eq('tournament_id', tour.id)
  .in('match_widget_id', [...r16WidgetTails])
  .order('captured_at', { ascending: false })

if (!oopRows?.length) {
  console.log('❌ NO OOP rows captured for any R16 widget — that\'s why scheduled_at is null')
  console.log('   Either:')
  console.log('   (a) Marmotor\'s OOP page doesn\'t publish R16 schedule yet (matches start tomorrow?)')
  console.log('   (b) The padelgod oop-fetcher is failing for this tournament')
} else {
  // Take latest snapshot per widget
  const latestByWidget = new Map()
  for (const r of oopRows) {
    const cur = latestByWidget.get(r.match_widget_id)
    if (!cur || r.captured_at > cur.captured_at) latestByWidget.set(r.match_widget_id, r)
  }
  console.log(`OOP coverage: ${latestByWidget.size}/${r16WidgetTails.size} R16 widgets have at least one OOP row`)
  console.log()
  for (const w of [...r16WidgetTails].sort()) {
    const o = latestByWidget.get(w)
    if (!o) console.log(`  ${w}  ❌ never captured by OOP`)
    else console.log(`  ${w}  day=${o.day_number} date=${o.day_date} court="${o.court}" cp=${o.court_position} label="${o.scheduled_label}"  captured=${o.captured_at?.slice(0,16)}`)
  }
}

// 3. Latest OOP snapshot for the tournament — what days/rounds does it cover today?
console.log('\n── Latest OOP snapshot full distribution ──')
const { data: latestRow } = await sb
  .schema('padelgod')
  .from('oop_snapshots')
  .select('captured_at')
  .eq('tournament_id', tour.id)
  .order('captured_at', { ascending: false })
  .limit(1)
const latestAt = latestRow?.[0]?.captured_at
console.log(`Latest snapshot captured_at: ${latestAt}`)

const { data: latestAll } = await sb
  .schema('padelgod')
  .from('oop_snapshots')
  .select('day_number, day_date, round_label, category')
  .eq('tournament_id', tour.id)
  .eq('captured_at', latestAt)

const breakdown = new Map()
for (const r of latestAll ?? []) {
  const k = `day=${r.day_number ?? '?'} date=${r.day_date ?? 'null'} round=${r.round_label ?? '?'} cat=${r.category ?? '?'}`
  breakdown.set(k, (breakdown.get(k) ?? 0) + 1)
}
for (const [k, n] of [...breakdown].sort()) console.log(`  ${k} → ${n}`)

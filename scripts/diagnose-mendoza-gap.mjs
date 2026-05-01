// Compare OOP-captured matches against public.matches for FIP Silver
// Mendoza on 2026-05-01 (day 3) so we can find the 3 missing rows.

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

// 1. Find the Mendoza tournament
const { data: tour } = await sb.from('tournaments')
  .select('id, name, level, starts_at, ends_at')
  .ilike('name', '%MENDOZA%')
  .gte('ends_at', '2026-04-29')
  .single()

if (!tour) { console.error('Mendoza tournament not found'); process.exit(1) }
console.log(`Tournament: ${tour.name}  ${tour.id}`)
console.log(`  ${tour.starts_at?.slice(0,10)} → ${tour.ends_at?.slice(0,10)}\n`)

// 2. Inspect a sample row to learn the column shape
const { data: anySnap } = await sb
  .schema('padelgod')
  .from('oop_snapshots')
  .select('*')
  .eq('tournament_id', tour.id)
  .limit(1)
console.log('oop_snapshots cols:', Object.keys(anySnap?.[0] ?? {}))
console.log()

// 3. Get the latest snapshot rows for day 3 (2026-05-01).
//    First find the most recent captured_at for this tournament.
const { data: latestRow } = await sb
  .schema('padelgod')
  .from('oop_snapshots')
  .select('captured_at')
  .eq('tournament_id', tour.id)
  .order('captured_at', { ascending: false })
  .limit(1)
const latestAt = latestRow?.[0]?.captured_at
console.log(`Latest OOP snapshot for tournament: ${latestAt}\n`)

const { data: oopRows } = await sb
  .schema('padelgod')
  .from('oop_snapshots')
  .select('*')
  .eq('tournament_id', tour.id)
  .eq('captured_at', latestAt)

// Latest snapshot only had day 4. Find any snapshot that captured day 3.
const { data: day3Rows } = await sb
  .schema('padelgod')
  .from('oop_snapshots')
  .select('captured_at, day_number, day_date, court, court_position, scheduled_label, round_label, category, status, match_widget_id, team1_player1_name, team1_player2_name, team2_player1_name, team2_player2_name')
  .eq('tournament_id', tour.id)
  .eq('day_number', 3)
  .order('captured_at', { ascending: false })
  .limit(50)

// Group by captured_at and pick the snapshot with the most day-3 rows
const byCapture = new Map()
for (const r of day3Rows ?? []) {
  const k = r.captured_at
  if (!byCapture.has(k)) byCapture.set(k, [])
  byCapture.get(k).push(r)
}
console.log('Snapshots that captured day 3:')
for (const [cap, rows] of byCapture) {
  console.log(`  ${cap} → ${rows.length} rows`)
}
console.log()

// Use the snapshot with the most day-3 rows
let latestDay3 = null, biggest = 0
for (const [cap, rows] of byCapture) {
  if (rows.length > biggest) { biggest = rows.length; latestDay3 = cap }
}
const oopToday = byCapture.get(latestDay3) ?? []
console.log(`Using snapshot ${latestDay3} → ${oopToday.length} day-3 rows\n`)
// Sort by court + court_position to read the schedule top-down
oopToday.sort((a, b) => {
  if (a.court !== b.court) return (a.court ?? '').localeCompare(b.court ?? '')
  return (a.court_position ?? 0) - (b.court_position ?? 0)
})
for (const m of oopToday) {
  const t1 = `${m.team1_player1_name ?? '?'}/${m.team1_player2_name ?? '?'}`
  const t2 = `${m.team2_player1_name ?? '?'}/${m.team2_player2_name ?? '?'}`
  console.log(`  ${(m.court ?? '?').padEnd(15)} cp=${String(m.court_position ?? '-').padStart(2)}  ${(m.scheduled_label ?? '').padEnd(20)} ${(m.round_label ?? '').padEnd(8)} ${(m.category ?? '?').padEnd(6)} widget=${m.match_widget_id ?? 'null'}  ${t1.padEnd(40)} vs ${t2}`)
}
console.log()

// 4. public.matches for the tournament whose scheduled_at OR finished_at is on 2026-05-01 in some tz
//    (server uses UTC day window for matches-by-date; let's just bracket
//     a wide window so we don't miss anything.)
const startUtc = '2026-05-01T00:00:00Z'
const endUtc   = '2026-05-02T03:00:00Z'  // Argentina is UTC-3, give buffer

const { data: pub } = await sb.from('matches')
  .select(`
    id, status, court, court_order, scheduled_at, finished_at, round, category,
    pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name,
    pair1_player1:players!matches_pair1_player1_id_fkey(name),
    pair1_player2:players!matches_pair1_player2_id_fkey(name),
    pair2_player1:players!matches_pair2_player1_id_fkey(name),
    pair2_player2:players!matches_pair2_player2_id_fkey(name),
    padelapi_id, widget_id_composite, last_updated_by
  `)
  .eq('tournament_id', tour.id)
  .or(`and(scheduled_at.gte.${startUtc},scheduled_at.lt.${endUtc}),and(finished_at.gte.${startUtc},finished_at.lt.${endUtc})`)
  .order('scheduled_at', { ascending: true })

console.log(`public.matches rows in window: ${pub?.length ?? 0}`)
for (const m of pub ?? []) {
  const n = (p, fk, fb) => fk?.name ?? p ?? fb ?? '—'
  const t1 = `${n(m.pair1_player1_name, m.pair1_player1)}/${n(m.pair1_player2_name, m.pair1_player2)}`
  const t2 = `${n(m.pair2_player1_name, m.pair2_player1)}/${n(m.pair2_player2_name, m.pair2_player2)}`
  const src = m.padelapi_id && m.widget_id_composite ? 'merged' : m.padelapi_id ? 'padelapi' : m.widget_id_composite ? 'widget' : 'no-source'
  console.log(`  ${m.id.slice(0,8)} ${(m.court ?? '?').padEnd(15)} co=${String(m.court_order ?? '-').padStart(2)} ${(m.status ?? '?').padEnd(10)} ${src.padEnd(9)} ${t1.padEnd(40)} vs ${t2}`)
}
console.log()

// 5. What's in OOP that ISN'T in public.matches? Match by token overlap
//    on player names since court+round can differ slightly.
function tokens(name) {
  if (!name) return new Set()
  return new Set(
    String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .split(/\s+/).filter(t => t.length >= 3)
  )
}
function matchTokens(m) {
  const all = new Set()
  for (const slot of ['pair1_player1', 'pair1_player2', 'pair2_player1', 'pair2_player2']) {
    const fk = m[slot]?.name
    const inline = m[`${slot}_name`]
    for (const t of tokens(fk ?? inline)) all.add(t)
  }
  return all
}
function oopTokens(om) {
  const all = new Set()
  for (const k of ['team1_player1_name', 'team1_player2_name', 'team2_player1_name', 'team2_player2_name']) {
    for (const t of tokens(om[k])) all.add(t)
  }
  return all
}

console.log('── Diff: OOP rows with no good DB match ──\n')
for (const om of oopToday) {
  const oTokens = oopTokens(om)
  let best = null, bestOverlap = 0
  for (const m of pub ?? []) {
    const mTokens = matchTokens(m)
    let overlap = 0
    for (const t of oTokens) if (mTokens.has(t)) overlap++
    if (overlap > bestOverlap) { bestOverlap = overlap; best = m }
  }
  const status = bestOverlap >= 2 ? '✓' : '❌'
  const t1 = `${om.team1_player1_name ?? '?'}/${om.team1_player2_name ?? '?'}`
  const t2 = `${om.team2_player1_name ?? '?'}/${om.team2_player2_name ?? '?'}`
  console.log(`  ${status} ${(om.court ?? '?').padEnd(15)} cp=${String(om.court_position ?? '-').padStart(2)} widget=${(om.match_widget_id ?? 'null').padEnd(20)} ${t1.padEnd(40)} vs ${t2.padEnd(40)} → overlap=${bestOverlap} ${best ? `db=${best.id.slice(0,8)}` : 'no-match'}`)
}

// Audit seed coverage end-to-end across the pipeline:
//   1. padelgod.draw_snapshots — does the FIP/Crionet scraper capture seeds?
//   2. padelgod.entry_list_snapshots — same question for entry list
//   3. public.tournament_draws — do seeds make it to the canonical bracket?
//   4. public.matches — does the populator surface seeds at the match level?

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
  .select('id, name, level')
  .lte('starts_at', today).gte('ends_at', today)
  .order('level').order('name')

console.log(`Live tournaments: ${tournaments?.length ?? 0}\n`)
console.log(`${'tournament'.padEnd(50)} ${'level'.padEnd(13)} ${'draw_snap'.padEnd(15)} ${'entry_list'.padEnd(15)} ${'tour_draws'.padEnd(15)}`)
console.log('─'.repeat(110))

let totals = { draw_snap_total: 0, draw_snap_seeded: 0, entry_total: 0, entry_seeded: 0, td_total: 0, td_seeded: 0 }

for (const t of tournaments ?? []) {
  // 1. draw_snapshots seed coverage (latest snapshot per match)
  const { data: ds } = await sb.schema('padelgod').from('draw_snapshots')
    .select('match_widget_id, team1_seed, team2_seed, captured_at, source')
    .eq('tournament_id', t.id)
    .eq('source', 'fip_event_page')
    .order('captured_at', { ascending: false })
    .limit(2000)
  // Pick latest per match_widget_id
  const latestDs = new Map()
  for (const r of ds ?? []) {
    if (!latestDs.has(r.match_widget_id)) latestDs.set(r.match_widget_id, r)
  }
  const dsRows = [...latestDs.values()]
  const dsSeeded = dsRows.filter(r => r.team1_seed != null || r.team2_seed != null).length
  const dsLabel = dsRows.length > 0 ? `${dsSeeded}/${dsRows.length}` : '—'
  totals.draw_snap_total += dsRows.length
  totals.draw_snap_seeded += dsSeeded

  // 2. entry_list_snapshots seed coverage (latest snapshot per player)
  const { data: el } = await sb.schema('padelgod').from('entry_list_snapshots')
    .select('fip_id, seed, captured_at')
    .eq('tournament_id', t.id)
    .order('captured_at', { ascending: false })
    .limit(2000)
  const latestEl = new Map()
  for (const r of el ?? []) {
    if (!r.fip_id) continue
    if (!latestEl.has(r.fip_id)) latestEl.set(r.fip_id, r)
  }
  const elRows = [...latestEl.values()]
  const elSeeded = elRows.filter(r => r.seed != null).length
  const elLabel = elRows.length > 0 ? `${elSeeded}/${elRows.length}` : '—'
  totals.entry_total += elRows.length
  totals.entry_seeded += elSeeded

  // 3. tournament_draws (canonical bracket)
  const { data: td } = await sb.from('tournament_draws')
    .select('seed')
    .eq('tournament_id', t.id)
  const tdSeeded = (td ?? []).filter(r => r.seed != null).length
  const tdLabel = td?.length ? `${tdSeeded}/${td.length}` : '—'
  totals.td_total += td?.length ?? 0
  totals.td_seeded += tdSeeded

  console.log(`${t.name.slice(0,48).padEnd(50)} ${(t.level ?? '?').padEnd(13)} ${dsLabel.padEnd(15)} ${elLabel.padEnd(15)} ${tdLabel.padEnd(15)}`)
}

console.log()
console.log('═══════════════════════════════════════════════════════════════')
console.log(`Totals across live tournaments:`)
console.log(`  padelgod.draw_snapshots:          ${totals.draw_snap_seeded}/${totals.draw_snap_total} matches with at least one seeded team`)
console.log(`  padelgod.entry_list_snapshots:    ${totals.entry_seeded}/${totals.entry_total} player entries with seed`)
console.log(`  public.tournament_draws:          ${totals.td_seeded}/${totals.td_total} bracket positions with seed`)
console.log()
console.log(`Public.matches: NO seed columns exist on this table — seeds are not surfaced at the match level.`)
console.log('═══════════════════════════════════════════════════════════════')

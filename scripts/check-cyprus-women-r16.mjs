// The 2 Cyprus padelapi-only rows that have player names are women R16.
// Check whether the widget side already has those exact pairings — if
// yes, deleting the padelapi rows is safe (twin remains); if no, those
// 2 rows carry unique data we'd lose.

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

const T = '60048bc0-d694-4a11-97db-fada859ecbdf'

// All women R16 rows
const { data } = await sb.from('matches')
  .select(`
    id, padelapi_id, widget_id_composite, status, court, scheduled_at,
    pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name,
    pair1_player1:players!matches_pair1_player1_id_fkey(name),
    pair1_player2:players!matches_pair1_player2_id_fkey(name),
    pair2_player1:players!matches_pair2_player1_id_fkey(name),
    pair2_player2:players!matches_pair2_player2_id_fkey(name)
  `)
  .eq('tournament_id', T)
  .eq('round', 'Round of 16')
  .eq('category', 'women')

console.log(`Cyprus women's R16 rows in DB: ${data?.length ?? 0}`)
for (const m of data ?? []) {
  const src = m.padelapi_id && m.widget_id_composite ? 'merged' : m.padelapi_id ? 'padelapi-only' : m.widget_id_composite ? 'widget-only' : 'no-source'
  const players = []
  for (const pair of [1, 2]) {
    for (const pos of [1, 2]) {
      const fk = m[`pair${pair}_player${pos}`]?.name
      const inline = m[`pair${pair}_player${pos}_name`]
      players.push(fk ?? inline ?? '—')
    }
  }
  const sched = m.scheduled_at ? m.scheduled_at.slice(0, 16).replace('T', ' ') : '—'
  console.log(`\n  ${m.id.slice(0,8)} ${src.padEnd(13)} court=${m.court ?? '—'}  sched=${sched}`)
  console.log(`    ${players[0]}/${players[1]} vs ${players[2]}/${players[3]}`)
}

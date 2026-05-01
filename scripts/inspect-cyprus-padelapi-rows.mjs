// Spot-check the 24 Cyprus padelapi-only rows to confirm they're
// placeholders (empty players, midnight UTC) before deletion.

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

const { data } = await sb.from('matches')
  .select(`
    id, status, round, category, court, scheduled_at, finished_at, winner_pair,
    pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name,
    pair1_player1:players!matches_pair1_player1_id_fkey(name),
    pair1_player2:players!matches_pair1_player2_id_fkey(name),
    pair2_player1:players!matches_pair2_player1_id_fkey(name),
    pair2_player2:players!matches_pair2_player2_id_fkey(name),
    sets(id)
  `)
  .eq('tournament_id', T)
  .not('padelapi_id', 'is', null)
  .is('widget_id_composite', null)
  .order('round')

const stats = { withPlayers: 0, midnightUtc: 0, withSets: 0, finished: 0 }
console.log(`24 padelapi-only rows in Cyprus I:\n`)
for (const m of data ?? []) {
  const players = []
  let anyName = false
  for (const pair of [1, 2]) {
    for (const pos of [1, 2]) {
      const fk = m[`pair${pair}_player${pos}`]?.name
      const inline = m[`pair${pair}_player${pos}_name`]
      const n = fk ?? inline ?? '—'
      if (n !== '—') anyName = true
      players.push(n)
    }
  }
  if (anyName) stats.withPlayers++
  const isMidnight = m.scheduled_at && new Date(m.scheduled_at).getUTCHours() === 0 && new Date(m.scheduled_at).getUTCMinutes() === 0
  if (isMidnight) stats.midnightUtc++
  if (m.sets?.length > 0) stats.withSets++
  if (['finished', 'retired', 'walkover'].includes(m.status)) stats.finished++

  const sched = m.scheduled_at ? m.scheduled_at.slice(0, 16).replace('T', ' ') : '—'
  console.log(`  ${m.id.slice(0,8)} ${(m.category ?? '?').padEnd(6)} ${(m.round ?? '?').padEnd(15)} ${(m.status ?? '?').padEnd(10)} sched=${sched.padEnd(17)}${isMidnight ? ' ⏱midnight' : ''}  sets=${m.sets?.length ?? 0}`)
  console.log(`     ${players[0]}/${players[1]} vs ${players[2]}/${players[3]}`)
}

console.log()
console.log(`Summary of the 24 rows:`)
console.log(`  with any player name: ${stats.withPlayers}/24`)
console.log(`  midnight UTC scheduled_at: ${stats.midnightUtc}/24`)
console.log(`  with sets: ${stats.withSets}/24`)
console.log(`  finished/retired/walkover: ${stats.finished}/24`)

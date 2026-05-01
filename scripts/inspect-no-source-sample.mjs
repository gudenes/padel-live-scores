// Quick look at a few "no-source" rows so we can see what they actually
// contain and figure out where they came from.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

async function loadEnv() {
  const text = await fs.readFile(path.resolve('.env.local'), 'utf8')
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}

await loadEnv()
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// 1. Total no-source matches in FIP-tier tournaments
const { data: fipTournaments } = await sb
  .from('tournaments')
  .select('id')
  .like('level', 'fip_%')
  .gte('ends_at', '2026-03-01')
const fipIds = (fipTournaments ?? []).map(t => t.id)

const { count: totalNoSource } = await sb
  .from('matches')
  .select('id', { count: 'exact', head: true })
  .is('padelapi_id', null)
  .is('widget_id_composite', null)
  .in('tournament_id', fipIds.slice(0, 100))  // PostgREST limit on .in

// Better: just count without tournament filter for global picture
const { count: totalGlobalNoSource } = await sb
  .from('matches')
  .select('id', { count: 'exact', head: true })
  .is('padelapi_id', null)
  .is('widget_id_composite', null)

console.log(`Total "no-source" rows in DB: ${totalGlobalNoSource}`)
console.log()

// 2. Pull 10 samples from FIP tournaments to look at
const { data: samples } = await sb
  .from('matches')
  .select(`
    id, tournament_id, status, round, category, court, scheduled_at,
    pair1_player1_id, pair1_player1_name,
    pair1_player2_id, pair1_player2_name,
    pair2_player1_id, pair2_player1_name,
    pair2_player2_id, pair2_player2_name,
    last_updated_by, created_at, updated_at,
    pair1_player1:pair1_player1_id(name),
    pair1_player2:pair1_player2_id(name),
    pair2_player1:pair2_player1_id(name),
    pair2_player2:pair2_player2_id(name)
  `)
  .is('padelapi_id', null)
  .is('widget_id_composite', null)
  .order('created_at', { ascending: false })
  .limit(8)

console.log('── Recent "no-source" samples (newest first) ──\n')
for (const m of samples ?? []) {
  const { data: t } = await sb.from('tournaments').select('name, level, source').eq('id', m.tournament_id).single()
  console.log(`  ${m.id.slice(0, 8)}..  tournament="${t?.name ?? '?'}" (${t?.level}, source=${t?.source})`)
  console.log(`    round="${m.round}" cat=${m.category} court=${m.court ?? '—'} status=${m.status}`)
  console.log(`    sched=${m.scheduled_at?.slice(0, 16) ?? '—'}  last_updated_by=${m.last_updated_by ?? '—'}`)
  console.log(`    created=${m.created_at?.slice(0, 16)}  updated=${m.updated_at?.slice(0, 16)}`)
  const players = []
  for (const pair of [1, 2]) {
    for (const pos of [1, 2]) {
      const nameFromFK = m[`pair${pair}_player${pos}`]?.name
      const nameInline = m[`pair${pair}_player${pos}_name`]
      const id = m[`pair${pair}_player${pos}_id`]
      if (nameFromFK) players.push(`${nameFromFK} [FK=${id?.slice(0, 8)}..]`)
      else if (nameInline) players.push(`"${nameInline}" [no FK]`)
      else players.push('—')
    }
  }
  console.log(`    pair 1: ${players[0]} / ${players[1]}`)
  console.log(`    pair 2: ${players[2]} / ${players[3]}`)
  console.log()
}

// 3. Aggregate by last_updated_by and creation date to spot patterns
console.log('── Aggregate breakdown ──\n')
const { data: agg } = await sb
  .from('matches')
  .select('last_updated_by, created_at')
  .is('padelapi_id', null)
  .is('widget_id_composite', null)
  .limit(2000)

const byUpdater = {}
const byMonth = {}
for (const r of agg ?? []) {
  const u = r.last_updated_by ?? '(null)'
  byUpdater[u] = (byUpdater[u] || 0) + 1
  const m = r.created_at?.slice(0, 7) ?? '?'
  byMonth[m] = (byMonth[m] || 0) + 1
}

console.log('  By last_updated_by:')
for (const [u, c] of Object.entries(byUpdater).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${u.padEnd(20)} ${c}`)
}
console.log()
console.log('  By creation month:')
for (const [m, c] of Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`    ${m}  ${c}`)
}

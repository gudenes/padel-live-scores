// Audit how many FIP-tier match rows have a midnight-UTC scheduled_at
// (HH:MM:SS = 00:00:00). That's the padelapi placeholder convention —
// a known date but no time. Padelgod's fip-oop-writer Pass B currently
// only fills rows where scheduled_at IS NULL, so these placeholders
// stay stuck even when OOP knows the real time.

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
  .like('level', 'fip_%')
  .order('name')

let totalPlaceholders = 0
const ROWS = []

for (const t of tournaments ?? []) {
  const { data: matches } = await sb.from('matches')
    .select('id, scheduled_at, schedule_label, status, court, court_order, round, category, widget_id_composite, padelapi_id')
    .eq('tournament_id', t.id)
    .not('scheduled_at', 'is', null)

  const placeholders = (matches ?? []).filter(m => {
    const d = new Date(m.scheduled_at)
    return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0
  })

  if (placeholders.length === 0) continue
  totalPlaceholders += placeholders.length
  console.log(`▸ ${t.name}  (${t.level}) — ${placeholders.length} placeholders`)
  for (const m of placeholders) {
    const src = m.padelapi_id && m.widget_id_composite ? 'merged' :
                m.padelapi_id ? 'padelapi' :
                m.widget_id_composite ? 'widget' : 'no-source'
    const tail = m.widget_id_composite?.split(':').pop() ?? '-'
    console.log(`   ${m.id.slice(0,8)} ${(m.category ?? '?').padEnd(6)} ${(m.round ?? '?').padEnd(15)} ${src.padEnd(8)} ${tail.padEnd(6)} sched=${m.scheduled_at?.slice(0,16)} label="${m.schedule_label ?? ''}"`)
    ROWS.push({ tournamentId: t.id, tournamentName: t.name, ...m })
  }
}

console.log(`\nTotal placeholders across ${tournaments?.length ?? 0} live FIP-tier tournaments: ${totalPlaceholders}`)

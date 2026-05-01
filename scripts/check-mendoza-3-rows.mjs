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

const { data } = await sb.from('matches')
  .select(`
    id, status, court, court_order, round, category,
    scheduled_at, finished_at, started_at,
    pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name,
    pair1_player1:players!matches_pair1_player1_id_fkey(name),
    pair1_player2:players!matches_pair1_player2_id_fkey(name),
    pair2_player1:players!matches_pair2_player1_id_fkey(name),
    pair2_player2:players!matches_pair2_player2_id_fkey(name),
    widget_id_composite, padelapi_id, last_updated_by, schedule_label
  `)
  .eq('tournament_id', T)
  .or('widget_id_composite.ilike.%MD028,widget_id_composite.ilike.%MD029,widget_id_composite.ilike.%MD023')

for (const m of data ?? []) {
  const widgetTail = m.widget_id_composite?.split(':').pop()
  const n = (p, fk) => fk?.name ?? p ?? '—'
  const t1 = `${n(m.pair1_player1_name, m.pair1_player1)}/${n(m.pair1_player2_name, m.pair1_player2)}`
  const t2 = `${n(m.pair2_player1_name, m.pair2_player1)}/${n(m.pair2_player2_name, m.pair2_player2)}`
  console.log(`${widgetTail}  ${m.id.slice(0,8)}`)
  console.log(`  status=${m.status}  round=${m.round}  category=${m.category}`)
  console.log(`  court=${m.court}  court_order=${m.court_order}`)
  console.log(`  scheduled_at=${m.scheduled_at}`)
  console.log(`  schedule_label=${m.schedule_label}`)
  console.log(`  finished_at=${m.finished_at}  started_at=${m.started_at}`)
  console.log(`  last_updated_by=${m.last_updated_by}`)
  console.log(`  ${t1} vs ${t2}`)
  console.log()
}

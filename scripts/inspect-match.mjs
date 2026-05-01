// Pull a single match by id with full source / schedule / player context.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
async function loadEnv() {
  const text = await fs.readFile(path.resolve('.env.local'), 'utf8')
  for (const line of text.split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq+1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}
await loadEnv()
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const id = process.argv[2]
if (!id) { console.error('Usage: node inspect-match.mjs <match-id>'); process.exit(1) }

const { data: m } = await sb.from('matches')
  .select(`
    *,
    tournament:tournaments(id, name, level, country, timezone, starts_at, ends_at),
    pair1_player1:players!matches_pair1_player1_id_fkey(id, name, country),
    pair1_player2:players!matches_pair1_player2_id_fkey(id, name, country),
    pair2_player1:players!matches_pair2_player1_id_fkey(id, name, country),
    pair2_player2:players!matches_pair2_player2_id_fkey(id, name, country),
    sets(id, set_number, set_score, pair1_games, pair2_games, score_source)
  `)
  .eq('id', id)
  .maybeSingle()

if (!m) { console.error('No match'); process.exit(1) }
console.log('Match:', m.id)
console.log('  tournament:', m.tournament?.name, `(${m.tournament?.level}, tz=${m.tournament?.timezone})`)
console.log('  status:', m.status, ' round:', m.round, ' category:', m.category)
console.log('  court:', m.court, ' court_order:', m.court_order)
console.log('  scheduled_at:', m.scheduled_at, ' schedule_label:', m.schedule_label)
console.log('  finished_at:', m.finished_at, ' started_at:', m.started_at)
console.log('  winner_pair:', m.winner_pair, ' coverage:', m.coverage)
console.log('  sources: padelapi_id=', m.padelapi_id, ' widget_id_composite=', m.widget_id_composite)
console.log('  last_updated_by:', m.last_updated_by, ' updated_at:', m.updated_at, ' created_at:', m.created_at)
console.log('  pair1:', m.pair1_player1?.name ?? m.pair1_player1_name, '/', m.pair1_player2?.name ?? m.pair1_player2_name)
console.log('  pair2:', m.pair2_player1?.name ?? m.pair2_player1_name, '/', m.pair2_player2?.name ?? m.pair2_player2_name)
console.log('  sets:', m.sets?.length ?? 0)
for (const s of m.sets ?? []) {
  console.log(`    set ${s.set_number}: ${s.set_score} (${s.pair1_games}-${s.pair2_games})  source=${s.score_source}`)
}

// Check for any sibling row in same tournament with overlapping players
const { data: siblings } = await sb.from('matches')
  .select(`
    id, status, round, category, court, court_order, scheduled_at, padelapi_id, widget_id_composite,
    pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name,
    pair1_player1:players!matches_pair1_player1_id_fkey(name),
    pair1_player2:players!matches_pair1_player2_id_fkey(name),
    pair2_player1:players!matches_pair2_player1_id_fkey(name),
    pair2_player2:players!matches_pair2_player2_id_fkey(name)
  `)
  .eq('tournament_id', m.tournament_id)
  .eq('round', m.round)
  .eq('category', m.category)
  .neq('id', m.id)

if (siblings?.length) {
  console.log(`\nSame-round siblings in same tournament: ${siblings.length}`)
  // Token overlap
  function tokens(name) {
    if (!name) return new Set()
    return new Set(String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/).filter(t => t.length >= 3))
  }
  function rowTokens(r) {
    const all = new Set()
    for (const slot of ['pair1_player1', 'pair1_player2', 'pair2_player1', 'pair2_player2']) {
      const fk = r[slot]?.name
      const inline = r[`${slot}_name`]
      for (const t of tokens(fk ?? inline)) all.add(t)
    }
    return all
  }
  const myTokens = rowTokens(m)
  for (const s of siblings) {
    const sTokens = rowTokens(s)
    let overlap = 0
    for (const t of myTokens) if (sTokens.has(t)) overlap++
    if (overlap === 0) continue
    const src = s.padelapi_id && s.widget_id_composite ? 'merged' : s.padelapi_id ? 'padelapi' : s.widget_id_composite ? 'widget' : 'no-source'
    console.log(`  ${s.id.slice(0,8)} ${src.padEnd(11)} court=${s.court ?? '—'} co=${s.court_order ?? '—'} sched=${s.scheduled_at?.slice(0,16) ?? 'null'} overlap=${overlap}`)
    const players = []
    for (const pair of [1,2]) for (const pos of [1,2]) {
      players.push((s[`pair${pair}_player${pos}`]?.name ?? s[`pair${pair}_player${pos}_name`] ?? '—').slice(0,22))
    }
    console.log(`     ${players[0]}/${players[1]} vs ${players[2]}/${players[3]}`)
  }
}

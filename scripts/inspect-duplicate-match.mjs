// Side-by-side comparison of two match rows the user suspects are duplicates.
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

const ids = process.argv.slice(2)
if (ids.length === 0) {
  console.error('Usage: node scripts/inspect-duplicate-match.mjs <match-id> [<match-id> ...]')
  process.exit(1)
}

const { data: rows, error } = await sb
  .from('matches')
  .select(`
    id, padelapi_id, external_id, widget_id_composite,
    tournament_id, status, round, court, category, schedule_label,
    scheduled_at, started_at, finished_at, winner_pair, last_updated_by,
    pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id,
    pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name,
    pair1_player1:pair1_player1_id(name, country, fip_id),
    pair1_player2:pair1_player2_id(name, country, fip_id),
    pair2_player1:pair2_player1_id(name, country, fip_id),
    pair2_player2:pair2_player2_id(name, country, fip_id),
    sets(id, set_number, set_score, pair1_games, pair2_games, score_source),
    created_at, updated_at
  `)
  .in('id', ids)

if (error) {
  console.error(error)
  process.exit(1)
}

if (!rows || rows.length === 0) {
  console.log('No rows found for those IDs.')
  process.exit(0)
}

// Look up the tournament too
const tournamentIds = [...new Set(rows.map(r => r.tournament_id))]
const { data: tournaments } = await sb
  .from('tournaments')
  .select('id, name, level, source')
  .in('id', tournamentIds)

const tMap = new Map((tournaments || []).map(t => [t.id, t]))

function fmt(p) {
  if (!p) return '—'
  return `${p.name}${p.country ? ` (${p.country})` : ''}${p.fip_id ? ` [fip=${p.fip_id}]` : ''}`
}

for (const r of rows) {
  const t = tMap.get(r.tournament_id)
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`Match ${r.id}`)
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`Tournament:           ${t?.name} (${t?.level}, source=${t?.source})`)
  console.log(`Source IDs:`)
  console.log(`  padelapi_id:        ${r.padelapi_id ?? '—'}`)
  console.log(`  external_id:        ${r.external_id ?? '—'}`)
  console.log(`  widget_id_composite:${r.widget_id_composite ?? '—'}`)
  console.log(`Status / round / court:`)
  console.log(`  status:             ${r.status}`)
  console.log(`  round:              "${r.round}"`)
  console.log(`  category:           ${r.category ?? '—'}`)
  console.log(`  court:              ${r.court ?? '—'}`)
  console.log(`  schedule_label:     "${r.schedule_label ?? '—'}"`)
  console.log(`  scheduled_at:       ${r.scheduled_at ?? '—'}`)
  console.log(`  started_at:         ${r.started_at ?? '—'}`)
  console.log(`  finished_at:        ${r.finished_at ?? '—'}`)
  console.log(`  winner_pair:        ${r.winner_pair ?? '—'}`)
  console.log(`  last_updated_by:    ${r.last_updated_by ?? '—'}`)
  console.log(`Players:`)
  console.log(`  pair 1:`)
  console.log(`    p1: ${fmt(r.pair1_player1)} ${r.pair1_player1_id ? `(${r.pair1_player1_id})` : `name="${r.pair1_player1_name ?? '—'}"`}`)
  console.log(`    p2: ${fmt(r.pair1_player2)} ${r.pair1_player2_id ? `(${r.pair1_player2_id})` : `name="${r.pair1_player2_name ?? '—'}"`}`)
  console.log(`  pair 2:`)
  console.log(`    p1: ${fmt(r.pair2_player1)} ${r.pair2_player1_id ? `(${r.pair2_player1_id})` : `name="${r.pair2_player1_name ?? '—'}"`}`)
  console.log(`    p2: ${fmt(r.pair2_player2)} ${r.pair2_player2_id ? `(${r.pair2_player2_id})` : `name="${r.pair2_player2_name ?? '—'}"`}`)
  console.log(`Sets: ${r.sets?.length ?? 0}`)
  for (const s of (r.sets || []).sort((a, b) => a.set_number - b.set_number)) {
    console.log(`    set ${s.set_number}: ${s.set_score ?? `${s.pair1_games}-${s.pair2_games}`} (source=${s.score_source})`)
  }
  console.log(`Timestamps:`)
  console.log(`  created_at:         ${r.created_at}`)
  console.log(`  updated_at:         ${r.updated_at}`)
  console.log()
}

// Compare entity_external_ids for both
console.log('═══ entity_external_ids registered for these matches ═══')
const { data: registered } = await sb
  .from('entity_external_ids')
  .select('entity_id, source, external_id, metadata, first_seen_at, last_seen_at')
  .eq('entity_type', 'match')
  .in('entity_id', ids)

if (!registered || registered.length === 0) {
  console.log('  (none)')
} else {
  for (const r of registered) {
    console.log(`  ${r.entity_id} → source=${r.source} external_id=${r.external_id} metadata=${JSON.stringify(r.metadata)}`)
  }
}

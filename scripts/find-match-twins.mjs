// Given a match ID, find every other row in the same tournament that has
// 2+ player UUID overlaps with it. That's the strongest signal for "same
// physical match, multiple rows".
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

const seedId = process.argv[2]
if (!seedId) {
  console.error('Usage: node scripts/find-match-twins.mjs <match-id>')
  process.exit(1)
}

const { data: seed } = await sb
  .from('matches')
  .select('id, tournament_id, round, category, padelapi_id, widget_id_composite, scheduled_at, court, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name')
  .eq('id', seedId)
  .single()

if (!seed) {
  console.error('seed not found')
  process.exit(1)
}

const seedPlayerIds = [seed.pair1_player1_id, seed.pair1_player2_id, seed.pair2_player1_id, seed.pair2_player2_id].filter(Boolean)
const seedPlayerNames = [seed.pair1_player1_name, seed.pair1_player2_name, seed.pair2_player1_name, seed.pair2_player2_name].filter(Boolean).map(n => n.toLowerCase().trim())

console.log(`Seed match: ${seed.id}`)
console.log(`  tournament: ${seed.tournament_id}`)
console.log(`  round: ${seed.round}, category: ${seed.category}, court: ${seed.court}`)
console.log(`  padelapi_id: ${seed.padelapi_id ?? '—'}, widget: ${seed.widget_id_composite ?? '—'}`)
console.log(`  scheduled_at: ${seed.scheduled_at}`)
console.log(`  player UUIDs: ${seedPlayerIds.length ? seedPlayerIds.join(', ') : '— none'}`)
console.log(`  player names (raw): ${seedPlayerNames.join(' | ') || '—'}`)
console.log()

// Pull all matches in the same tournament + round + category
const { data: candidates } = await sb
  .from('matches')
  .select(`
    id, padelapi_id, external_id, widget_id_composite, status,
    round, category, court, scheduled_at, schedule_label,
    pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id,
    pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name,
    pair1_player1:pair1_player1_id(name),
    pair1_player2:pair1_player2_id(name),
    pair2_player1:pair2_player1_id(name),
    pair2_player2:pair2_player2_id(name),
    last_updated_by, created_at
  `)
  .eq('tournament_id', seed.tournament_id)
  .neq('id', seed.id)

const matches = []
for (const c of candidates ?? []) {
  // Same round + category check (round normalization is loose: contains R32 / Round of 32)
  const rNorm = (s) => (s ?? '').toLowerCase().replace(/\s+/g, '')
  const seedR = rNorm(seed.round)
  const candR = rNorm(c.round)
  // Treat "r32" and "roundof32" as equivalent
  const sameRound = seedR === candR
    || (seedR.includes('32') && candR.includes('32'))
    || (seedR.includes('16') && candR.includes('16'))
    || (seedR.includes('quarter') && candR.includes('quarter')) || (seedR === 'qf' && candR === 'qf')
    || (seedR.includes('semi') && candR.includes('semi')) || (seedR === 'sf' && candR === 'sf')
    || (seedR.includes('final') && candR.includes('final')) || (seedR === 'f' && candR === 'f')
  if (!sameRound) continue
  if (c.category !== seed.category) continue

  const candPlayerIds = [c.pair1_player1_id, c.pair1_player2_id, c.pair2_player1_id, c.pair2_player2_id].filter(Boolean)
  const candPlayerNames = [c.pair1_player1?.name, c.pair1_player2?.name, c.pair2_player1?.name, c.pair2_player2?.name]
    .filter(Boolean)
    .map(n => n.toLowerCase().trim())
    .concat([c.pair1_player1_name, c.pair1_player2_name, c.pair2_player1_name, c.pair2_player2_name].filter(Boolean).map(n => n.toLowerCase().trim()))

  const idOverlap = candPlayerIds.filter(id => seedPlayerIds.includes(id)).length
  // Name-based fallback for matches without UUIDs
  const nameOverlap = candPlayerNames.filter(n => seedPlayerNames.some(sn => sn === n || sn.includes(n) || n.includes(sn))).length

  if (idOverlap >= 2 || (seedPlayerIds.length === 0 && nameOverlap >= 2)) {
    matches.push({ candidate: c, idOverlap, nameOverlap })
  }
}

console.log(`Twin candidates (≥2 player overlap): ${matches.length}`)
console.log()
for (const { candidate: c, idOverlap, nameOverlap } of matches) {
  const players = [c.pair1_player1?.name, c.pair1_player2?.name, c.pair2_player1?.name, c.pair2_player2?.name]
    .map((n, i) => n ?? [c.pair1_player1_name, c.pair1_player2_name, c.pair2_player1_name, c.pair2_player2_name][i] ?? '?')
  console.log(`──────────────────────────────────────────────────────────────`)
  console.log(`  ${c.id}  (overlap: ${idOverlap} ids, ${nameOverlap} names)`)
  console.log(`    round=${c.round} court=${c.court ?? '—'} status=${c.status}`)
  console.log(`    sched=${c.scheduled_at ?? '—'} label="${c.schedule_label ?? '—'}"`)
  console.log(`    padelapi=${c.padelapi_id ?? '—'} widget=${c.widget_id_composite ?? '—'}`)
  console.log(`    last_updated_by=${c.last_updated_by ?? '—'} created=${c.created_at}`)
  console.log(`    players: ${players[0]} / ${players[1]}  vs  ${players[2]} / ${players[3]}`)
}

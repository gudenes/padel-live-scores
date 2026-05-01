// What-if simulation: show what a tournament's bracket would look like
// if every `padelapi-only` row were removed.
//
// Read-only.

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

function normRound(raw) {
  if (!raw) return null
  const c = String(raw).trim().toLowerCase()
  const m = {
    r128: 'R128', 'round of 128': 'R128',
    r64: 'R64', 'round of 64': 'R64',
    r32: 'R32', 'round of 32': 'R32',
    r16: 'R16', 'round of 16': 'R16',
    qf: 'QF', quarter: 'QF', quarters: 'QF', quarterfinals: 'QF', 'quarter-finals': 'QF', quarterfinal: 'QF',
    sf: 'SF', semifinals: 'SF', 'semi-finals': 'SF', semifinal: 'SF',
    f: 'F', final: 'F', finals: 'F',
    q1: 'Q1', q2: 'Q2', q3: 'Q3',
  }
  return m[c] ?? null
}

const STRUCTURAL_CAP = { F: 1, SF: 2, QF: 4, R16: 8, R32: 16, R64: 32, R128: 64 }
const ROUND_ORDER = ['Q1', 'Q2', 'Q3', 'R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F']

function classifySource(m) {
  if (m.padelapi_id && m.widget_id_composite) return 'merged'
  if (m.padelapi_id) return 'padelapi-only'
  if (m.widget_id_composite) return 'widget-only'
  return 'no-source'
}

await loadEnv()
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const tournamentId = process.argv[2]
if (!tournamentId) {
  console.error('Usage: node scripts/simulate-remove-padelapi-only.mjs <tournament-id>')
  process.exit(1)
}

const { data: t } = await sb.from('tournaments').select('*').eq('id', tournamentId).single()
const { data: matches } = await sb
  .from('matches')
  .select(`
    id, padelapi_id, widget_id_composite, status, round, category, court, scheduled_at, winner_pair, finished_at,
    pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id,
    pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name,
    pair1_player1:pair1_player1_id(name),
    pair1_player2:pair1_player2_id(name),
    pair2_player1:pair2_player1_id(name),
    pair2_player2:pair2_player2_id(name),
    sets(id)
  `)
  .eq('tournament_id', tournamentId)

console.log('═══════════════════════════════════════════════════════════════')
console.log(`SIMULATION — Remove all padelapi-only rows`)
console.log(`${t.name}  ·  ${t.level}  ·  ends ${t.ends_at?.slice(0, 10)}`)
console.log('═══════════════════════════════════════════════════════════════')
console.log()

const padelapiOnly = matches.filter(m => classifySource(m) === 'padelapi-only')
const remaining = matches.filter(m => classifySource(m) !== 'padelapi-only')

console.log(`Total rows now:                 ${matches.length}`)
console.log(`  ✗ would be removed (padelapi-only): ${padelapiOnly.length}`)
console.log(`  ✓ would remain:                     ${remaining.length}`)
console.log()

// Bucket BEFORE and AFTER by (round, category)
function bucket(rows) {
  const b = new Map()
  for (const m of rows) {
    if (m.status === 'bye') continue
    const r = normRound(m.round) ?? '???'
    const cat = m.category ?? '?'
    const k = `${cat}|${r}`
    if (!b.has(k)) b.set(k, [])
    b.get(k).push(m)
  }
  return b
}
const bBefore = bucket(matches)
const bAfter = bucket(remaining)

const allKeys = new Set([...bBefore.keys(), ...bAfter.keys()])
const sortedKeys = [...allKeys].sort((a, b) => {
  const [ca, ra] = a.split('|')
  const [cb, rb] = b.split('|')
  if (ca !== cb) return ca === 'men' ? -1 : 1
  const ia = ROUND_ORDER.indexOf(ra)
  const ib = ROUND_ORDER.indexOf(rb)
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
})

console.log('── Per-round comparison ──\n')
console.log(`  ${'cat'.padEnd(6)} ${'rnd'.padEnd(5)}  ${'before'.padStart(7)}    ${'after'.padStart(7)}    cap   what gets lost`)
console.log(`  ${'─'.repeat(80)}`)

for (const k of sortedKeys) {
  const [cat, round] = k.split('|')
  const before = bBefore.get(k) ?? []
  const after = bAfter.get(k) ?? []
  const cap = STRUCTURAL_CAP[round]
  const beforeStr = `${before.length}/${cap ?? '?'}`
  const afterStr = `${after.length}/${cap ?? '?'}`

  // What gets removed from this bucket?
  const removed = before.filter(m => classifySource(m) === 'padelapi-only')

  let lostNote = ''
  if (removed.length === 0) {
    lostNote = '(no change)'
  } else if (after.length === 0) {
    lostNote = `❌ ROUND DISAPPEARS — ${removed.length} padelapi-only rows were the only source`
  } else if (cap && after.length < cap) {
    lostNote = `⚠ NOW UNDERFILLED — was ${before.length}/${cap}, now ${after.length}/${cap}`
  } else if (cap && after.length === cap) {
    lostNote = `✓ now exactly at cap`
  } else if (cap && after.length > cap) {
    lostNote = `still over cap (+${after.length - cap})`
  } else {
    lostNote = `${removed.length} removed`
  }

  console.log(`  ${cat.padEnd(6)} ${round.padEnd(5)}  ${beforeStr.padStart(7)} → ${afterStr.padStart(7)}    ${(cap ?? '?').toString().padEnd(3)}   ${lostNote}`)
}

console.log()
console.log('── Detail: what would be removed in each round ──\n')

// Show details for each (cat, round) where padelapi-only rows exist
for (const k of sortedKeys) {
  const [cat, round] = k.split('|')
  const before = bBefore.get(k) ?? []
  const removed = before.filter(m => classifySource(m) === 'padelapi-only')
  if (removed.length === 0) continue
  const after = bAfter.get(k) ?? []
  console.log(`▸ ${cat} ${round}  (would remove ${removed.length}, leaving ${after.length})`)
  for (const m of removed) {
    const players = []
    for (const pair of [1, 2]) {
      for (const pos of [1, 2]) {
        const nameFK = m[`pair${pair}_player${pos}`]?.name
        const nameInline = m[`pair${pair}_player${pos}_name`]
        players.push(nameFK ?? nameInline ?? '—')
      }
    }
    const sched = m.scheduled_at ? m.scheduled_at.slice(0, 16).replace('T', ' ') : '—'
    const isMidnight = m.scheduled_at && new Date(m.scheduled_at).getUTCHours() === 0
    console.log(`    padelapi=${m.padelapi_id}  ${m.id.slice(0, 8)}..  status=${m.status}  court=${m.court ?? '—'}  sched=${sched}${isMidnight ? ' (midnight)' : ''}`)
    console.log(`      ${players[0]} / ${players[1]}  vs  ${players[2]} / ${players[3]}`)
  }
  console.log()
}

// Summary: which rounds would lose ALL their data?
console.log('── Final summary ──\n')
const orphanedRounds = []
const underfilledRounds = []
const unaffectedRounds = []
for (const k of sortedKeys) {
  const [cat, round] = k.split('|')
  const before = bBefore.get(k) ?? []
  const after = bAfter.get(k) ?? []
  const cap = STRUCTURAL_CAP[round]
  const removed = before.filter(m => classifySource(m) === 'padelapi-only')
  if (removed.length === 0) continue
  if (after.length === 0) orphanedRounds.push(`${cat} ${round}`)
  else if (cap && after.length < cap) underfilledRounds.push(`${cat} ${round} (${after.length}/${cap})`)
  else unaffectedRounds.push(`${cat} ${round}`)
}

if (orphanedRounds.length) {
  console.log(`❌ Rounds that would DISAPPEAR entirely: ${orphanedRounds.length}`)
  for (const r of orphanedRounds) console.log(`     ${r}`)
}
if (underfilledRounds.length) {
  console.log(`⚠ Rounds that would be UNDERFILLED:    ${underfilledRounds.length}`)
  for (const r of underfilledRounds) console.log(`     ${r}`)
}
if (unaffectedRounds.length) {
  console.log(`✓ Rounds where removal is safe:         ${unaffectedRounds.length}`)
  for (const r of unaffectedRounds) console.log(`     ${r}`)
}

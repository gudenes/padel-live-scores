// Deep-dive on a single tournament: list every match row, categorize by
// source pipeline, cluster physical matches across rows, and surface
// discrepancies between padelapi vs padelgod for the same physical match.

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
    qf: 'QF', quarter: 'QF', quarters: 'QF', quarterfinals: 'QF', 'quarter-finals': 'QF',
    sf: 'SF', semifinals: 'SF', 'semi-finals': 'SF',
    f: 'F', final: 'F', finals: 'F',
    q1: 'Q1', q2: 'Q2', q3: 'Q3',
  }
  return m[c] ?? null
}

function classifySource(m) {
  const hasPadelapi = m.padelapi_id != null
  const hasWidget = m.widget_id_composite != null
  if (hasPadelapi && hasWidget) return 'merged'
  if (hasPadelapi) return 'padelapi-only'
  if (hasWidget) return 'widget-only'
  return 'no-source'
}

function lastNameToken(rawName) {
  if (!rawName) return null
  let n = String(rawName).trim()
  if (!n) return null
  n = n.replace(/^(?:[A-Za-zÀ-ÿ]{1,3}\.\s*)+/, '').trim()
  if (!n) return null
  const parts = n.split(/\s+/)
  let last = parts[parts.length - 1]
  last = last.normalize('NFD').replace(/[̀-ͯ]/g, '')
  last = last.replace(/[^a-zA-ZñÑ]/g, '').toLowerCase()
  return last || null
}

await loadEnv()
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
)

const tournamentId = process.argv[2]
if (!tournamentId) {
  console.error('Usage: node scripts/investigate-tournament.mjs <tournament-id>')
  process.exit(1)
}

const { data: tournament } = await supabase
  .from('tournaments')
  .select('*')
  .eq('id', tournamentId)
  .single()

if (!tournament) {
  console.error('Tournament not found')
  process.exit(1)
}

console.log('═══════════════════════════════════════════════════════════════')
console.log(`Tournament: ${tournament.name}`)
console.log('═══════════════════════════════════════════════════════════════')
console.log(`  ID:              ${tournament.id}`)
console.log(`  Level:           ${tournament.level}`)
console.log(`  Source:          ${tournament.source}`)
console.log(`  Country:         ${tournament.country}`)
console.log(`  Dates:           ${tournament.starts_at?.slice(0, 10)} → ${tournament.ends_at?.slice(0, 10)}`)
console.log(`  Status:          ${tournament.status}`)
console.log(`  Timezone:        ${tournament.timezone ?? '— (none stored)'}`)
console.log(`  padelapi_id:     ${tournament.padelapi_id ?? '—'}`)
console.log(`  fip_id:          ${tournament.fip_id ?? '—'}`)
console.log(`  matchscorer URL: ${tournament.matchscorer_url ?? '—'}`)
console.log(`  url:             ${tournament.url ?? '—'}`)
console.log()

// Pull all matches for this tournament
const { data: matches } = await supabase
  .from('matches')
  .select(`
    id, padelapi_id, external_id, widget_id_composite,
    status, round, court, category, schedule_label,
    scheduled_at, started_at, finished_at, winner_pair, last_updated_by,
    pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id,
    pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name,
    pair1_player1:pair1_player1_id(name),
    pair1_player2:pair1_player2_id(name),
    pair2_player1:pair2_player1_id(name),
    pair2_player2:pair2_player2_id(name),
    sets(id, set_number, set_score, pair1_games, pair2_games, score_source),
    created_at, updated_at
  `)
  .eq('tournament_id', tournamentId)
  .order('round')
  .order('category')

if (!matches) {
  console.log('No matches.')
  process.exit(0)
}

console.log(`Total match rows: ${matches.length}`)
console.log()

// 1. By source pattern
const bySource = { 'padelapi-only': 0, 'widget-only': 0, 'merged': 0, 'no-source': 0 }
for (const m of matches) bySource[classifySource(m)]++
console.log('── By source pattern ──')
for (const [k, v] of Object.entries(bySource)) {
  console.log(`  ${k.padEnd(16)} ${v}`)
}
console.log()

// 2. By round + category, with structural cap check
const STRUCTURAL_CAP = { F: 1, SF: 2, QF: 4, R16: 8, R32: 16, R64: 32, R128: 64 }
const byRoundCat = new Map()
for (const m of matches) {
  if (m.status === 'bye') continue
  const r = normRound(m.round)
  if (!r) continue
  const k = `${m.category ?? '?'} ${r}`
  if (!byRoundCat.has(k)) byRoundCat.set(k, [])
  byRoundCat.get(k).push(m)
}

console.log('── By round (oversize rounds flagged) ──')
const sortedKeys = [...byRoundCat.keys()].sort()
for (const k of sortedKeys) {
  const rows = byRoundCat.get(k)
  const cat = k.split(' ')[0]
  const round = k.split(' ')[1]
  const cap = STRUCTURAL_CAP[round]
  const flag = cap && rows.length > cap ? `⚠ +${rows.length - cap}` : '  ok'
  const sources = rows.reduce((acc, m) => {
    acc[classifySource(m)] = (acc[classifySource(m)] || 0) + 1
    return acc
  }, {})
  const sourceStr = Object.entries(sources).filter(([_, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(' ')
  console.log(`  ${flag.padEnd(8)} ${k.padEnd(14)} ${rows.length.toString().padStart(3)}/${cap ?? '?'}  ${sourceStr}`)
}
console.log()

// 3. Cluster by player signature within each (cat, round)
console.log('── Physical match clusters (showing duplicates only) ──')
console.log()

let totalDuplicateClusters = 0
for (const k of sortedKeys) {
  const rows = byRoundCat.get(k)
  // Build clusters by last-name signature
  const sig = (m) => {
    const tokens = []
    for (const pair of [1, 2]) {
      for (const pos of [1, 2]) {
        const nameFromFK = m[`pair${pair}_player${pos}`]?.name
        const nameInline = m[`pair${pair}_player${pos}_name`]
        const tok = lastNameToken(nameFromFK ?? nameInline)
        if (tok) tokens.push(tok)
      }
    }
    if (tokens.length < 3) return null
    return tokens.sort().join('|')
  }
  const bySig = new Map()
  const unsignable = []
  for (const m of rows) {
    const s = sig(m)
    if (!s) { unsignable.push(m); continue }
    if (!bySig.has(s)) bySig.set(s, [])
    bySig.get(s).push(m)
  }
  // Pass B: also cluster by ≥2 player UUID overlap when sig missed
  // (not implemented here for brevity — most duplicates have 4 UUIDs)

  for (const [s, group] of bySig) {
    if (group.length === 1) continue
    totalDuplicateClusters++
    console.log(`${k} [${s}]`)
    for (const m of group) {
      const src = classifySource(m)
      const sched = m.scheduled_at ? m.scheduled_at.slice(0, 16).replace('T', ' ') : '— no time'
      const isMidnight = m.scheduled_at && new Date(m.scheduled_at).getUTCHours() === 0 && new Date(m.scheduled_at).getUTCMinutes() === 0
      const timeFlag = isMidnight ? ' (midnight UTC ⚠)' : ''
      const setsCount = m.sets?.length ?? 0
      const idTag = src === 'padelapi-only' ? `padelapi=${m.padelapi_id}`
        : src === 'widget-only' ? `widget=${m.widget_id_composite}`
        : src === 'merged' ? `padelapi=${m.padelapi_id} + widget=${m.widget_id_composite}`
        : 'no source-id'
      console.log(`    ${src.padEnd(14)} ${m.id.slice(0, 8)}.. round="${m.round?.slice(0, 12) ?? '—'}" court=${m.court ?? '—'} sched=${sched}${timeFlag} sets=${setsCount} status=${m.status}`)
      console.log(`                   ${idTag}`)
    }
    console.log()
  }
}

if (totalDuplicateClusters === 0) {
  console.log('  (no duplicate clusters found)')
}

// 4. Singleton rows breakdown — what are the un-duplicated rows?
console.log()
console.log('── Singleton rows (single physical match per row) ──')
let singletons = 0
let singletonSources = { 'padelapi-only': 0, 'widget-only': 0, 'merged': 0, 'no-source': 0 }
for (const k of sortedKeys) {
  const rows = byRoundCat.get(k)
  const sig = (m) => {
    const tokens = []
    for (const pair of [1, 2]) {
      for (const pos of [1, 2]) {
        const nameFromFK = m[`pair${pair}_player${pos}`]?.name
        const nameInline = m[`pair${pair}_player${pos}_name`]
        const tok = lastNameToken(nameFromFK ?? nameInline)
        if (tok) tokens.push(tok)
      }
    }
    if (tokens.length < 3) return null
    return tokens.sort().join('|')
  }
  const bySig = new Map()
  for (const m of rows) {
    const s = sig(m) ?? `__unsigned_${m.id}`
    if (!bySig.has(s)) bySig.set(s, [])
    bySig.get(s).push(m)
  }
  for (const [, group] of bySig) {
    if (group.length === 1) {
      singletons++
      singletonSources[classifySource(group[0])]++
    }
  }
}
console.log(`  Total singletons: ${singletons}`)
for (const [k, v] of Object.entries(singletonSources)) {
  if (v > 0) console.log(`    ${k.padEnd(14)} ${v}`)
}

// 5. Padelapi vs padelgod time-quality side-by-side for the matches that have both
console.log()
console.log('── Time-quality comparison (matches with both pipelines) ──')
console.log()
let mergedGoodTime = 0
let mergedMidnightTime = 0
let mergedNoTime = 0
const mergedRows = matches.filter(m => classifySource(m) === 'merged')
for (const m of mergedRows) {
  if (!m.scheduled_at) { mergedNoTime++; continue }
  const d = new Date(m.scheduled_at)
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) mergedMidnightTime++
  else mergedGoodTime++
}
console.log(`  Merged rows (have both padelapi_id + widget_id_composite): ${mergedRows.length}`)
console.log(`    with real scheduled_at:    ${mergedGoodTime}`)
console.log(`    with midnight UTC:         ${mergedMidnightTime}`)
console.log(`    with no scheduled_at:      ${mergedNoTime}`)

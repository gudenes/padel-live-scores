// Read-only summary breakdown of match duplicates by source-id pattern.
// Builds on audit-match-duplicates.mjs but rolls everything up into a
// table you can read at a glance.

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

function normalizeRoundShort(raw) {
  if (!raw) return null
  const cleaned = String(raw).trim().toLowerCase()
  const map = {
    r128: 'R128', 'round of 128': 'R128',
    r64: 'R64', 'round of 64': 'R64',
    r32: 'R32', 'round of 32': 'R32',
    r16: 'R16', 'round of 16': 'R16',
    qf: 'QF', quarter: 'QF', quarters: 'QF', quarterfinals: 'QF', 'quarter-finals': 'QF', 'quarter finals': 'QF',
    sf: 'SF', semifinals: 'SF', 'semi-finals': 'SF', 'semi finals': 'SF',
    f: 'F', final: 'F', finals: 'F',
    q1: 'Q1', q2: 'Q2', q3: 'Q3',
  }
  return map[cleaned] ?? null
}
const STRUCTURAL_CAP = { F: 1, SF: 2, QF: 4, R16: 8, R32: 16, R64: 32, R128: 64 }

function classifySource(m) {
  const hasPadelapi = m.padelapi_id != null
  const hasWidget = m.widget_id_composite != null
  if (hasPadelapi && hasWidget) return 'merged'
  if (hasPadelapi) return 'padelapi-only'
  if (hasWidget) return 'widget-only'
  return 'no-source'
}

await loadEnv()
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// Pull all FIP-tier tournaments + their matches (active or recent)
const { data: tournaments } = await supabase
  .from('tournaments')
  .select('id, name, level, ends_at')
  .like('level', 'fip_%')
  .gte('ends_at', '2026-03-01')
  .order('ends_at', { ascending: false })

const aggregateByLevel = {}
const aggregateBySourcePattern = { 'merged': 0, 'padelapi-only': 0, 'widget-only': 0, 'no-source': 0 }
let tournamentsWithDuplicates = 0
let totalExtraRows = 0
const top10 = []

for (const t of tournaments) {
  const { data: matches } = await supabase
    .from('matches')
    .select('id, padelapi_id, widget_id_composite, round, category, status')
    .eq('tournament_id', t.id)
    .neq('status', 'bye')

  if (!matches?.length) continue

  // Group by (category, round-canonical)
  const groups = new Map()
  for (const m of matches) {
    const r = normalizeRoundShort(m.round)
    if (!r) continue
    const k = `${m.category ?? 'unknown'}__${r}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(m)
  }

  let extraRowsThisTournament = 0
  const sourceTallyThisTournament = { 'merged': 0, 'padelapi-only': 0, 'widget-only': 0, 'no-source': 0 }

  for (const [, rows] of groups) {
    const round = rows[0]?.round
    const r = normalizeRoundShort(round)
    const cap = STRUCTURAL_CAP[r] ?? Infinity
    if (rows.length > cap) {
      extraRowsThisTournament += rows.length - cap
      // Tally source patterns of the EXCESS rows (sorted: drop merged first since they're "real")
      for (const m of rows) {
        sourceTallyThisTournament[classifySource(m)]++
      }
    }
  }

  if (extraRowsThisTournament > 0) {
    tournamentsWithDuplicates++
    totalExtraRows += extraRowsThisTournament
    aggregateByLevel[t.level] = (aggregateByLevel[t.level] || 0) + extraRowsThisTournament
    for (const [k, v] of Object.entries(sourceTallyThisTournament)) {
      aggregateBySourcePattern[k] += v
    }
    top10.push({
      name: t.name,
      level: t.level,
      ends: t.ends_at,
      extraRows: extraRowsThisTournament,
      sources: sourceTallyThisTournament,
    })
  }
}

top10.sort((a, b) => b.extraRows - a.extraRows)

console.log('═══════════════════════════════════════════════════════════════')
console.log('FIP MATCH DUPLICATE AUDIT — SUMMARY')
console.log('═══════════════════════════════════════════════════════════════')
console.log()
console.log(`Tournaments scanned (FIP tiers, ends_at >= 2026-03-01): ${tournaments.length}`)
console.log(`Tournaments with duplicates: ${tournamentsWithDuplicates}`)
console.log(`Total extra match rows: ${totalExtraRows}`)
console.log()
console.log('── Extra rows by tier ──')
for (const [level, count] of Object.entries(aggregateByLevel).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${level.padEnd(20)} ${count}`)
}
console.log()
console.log('── Source pattern tally (across all duplicated rounds) ──')
const total = Object.values(aggregateBySourcePattern).reduce((a, b) => a + b, 0)
for (const [pattern, count] of Object.entries(aggregateBySourcePattern).sort((a, b) => b[1] - a[1])) {
  const pct = total ? ((count / total) * 100).toFixed(0) : 0
  console.log(`  ${pattern.padEnd(16)} ${count.toString().padStart(4)}  (${pct}%)`)
}
console.log()
console.log('── Top 10 worst-offender tournaments ──')
for (const t of top10.slice(0, 10)) {
  const sourceStr = Object.entries(t.sources).filter(([_, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(' ')
  console.log(`  +${t.extraRows.toString().padStart(3)}  ${t.level.padEnd(12)} ${t.name.slice(0, 50).padEnd(50)} (${t.ends})`)
  console.log(`         sources: ${sourceStr}`)
}
console.log()

// Sanity check for currently-running tournaments. For each one, list
// every (round, category) pair with the row count, the structural cap
// for that round, and the source-pattern breakdown. Flags rounds that
// are over capacity, under capacity, or have non-merged padelapi rows.
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
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
)

// Currently happening: starts_at <= today AND ends_at >= today
const today = new Date().toISOString().slice(0, 10)
const { data: tournaments } = await supabase
  .from('tournaments')
  .select('id, name, level, country, starts_at, ends_at, draw_size_md, draw_size_qd')
  .lte('starts_at', today)
  .gte('ends_at', today)
  .order('level', { ascending: true })
  .order('name', { ascending: true })

console.log('═══════════════════════════════════════════════════════════════')
console.log(`SANITY CHECK — TOURNAMENTS RUNNING ON ${today}`)
console.log('═══════════════════════════════════════════════════════════════')
console.log()

if (!tournaments?.length) {
  console.log('No live tournaments today.')
  process.exit(0)
}

console.log(`Live tournaments: ${tournaments.length}\n`)

let totalAnomalies = 0

for (const t of tournaments) {
  const { data: matches } = await supabase
    .from('matches')
    .select('id, padelapi_id, widget_id_composite, status, round, category')
    .eq('tournament_id', t.id)

  if (!matches?.length) continue

  // Bucket by (round, category)
  const buckets = new Map()
  let bye = 0
  for (const m of matches) {
    if (m.status === 'bye') { bye++; continue }
    const r = normRound(m.round)
    const k = `${r ?? '???'}|${m.category ?? '?'}`
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(m)
  }

  console.log('─────────────────────────────────────────────────────────────')
  console.log(`${t.name}  ·  ${t.level}  ·  ${t.country}`)
  console.log(`  ${t.starts_at?.slice(0, 10)} → ${t.ends_at?.slice(0, 10)}  ·  ${matches.length} match rows  (bye=${bye})`)
  console.log(`  draw_size_md=${t.draw_size_md ?? '—'}  draw_size_qd=${t.draw_size_qd ?? '—'}`)

  const sortedKeys = [...buckets.keys()].sort((a, b) => {
    const ra = a.split('|')[0]
    const rb = b.split('|')[0]
    const ca = a.split('|')[1]
    const cb = b.split('|')[1]
    if (ca !== cb) return ca === 'men' ? -1 : 1
    const ia = ROUND_ORDER.indexOf(ra)
    const ib = ROUND_ORDER.indexOf(rb)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })

  let anyAnomalyHere = false
  for (const k of sortedKeys) {
    const [round, cat] = k.split('|')
    const rows = buckets.get(k)
    const cap = STRUCTURAL_CAP[round]
    const sources = rows.reduce((a, m) => { a[classifySource(m)] = (a[classifySource(m)] || 0) + 1; return a }, {})
    const sourceStr = Object.entries(sources).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(' ')

    let flag = ''
    if (cap) {
      if (rows.length > cap) flag = `⚠ +${rows.length - cap} OVER`
      else if (rows.length < cap) flag = `· -${cap - rows.length} under`
      else flag = '✓ exact'
    } else {
      flag = '? no cap (qualifier)'
    }
    if (rows.length > (cap ?? Infinity) || (sources['padelapi-only'] ?? 0) > 0) {
      anyAnomalyHere = true
      totalAnomalies++
    }

    console.log(`    ${cat.padEnd(6)} ${round.padEnd(5)}  ${rows.length.toString().padStart(3)}/${(cap ?? '?').toString().padEnd(3)}  ${flag.padEnd(15)}  ${sourceStr}`)
  }

  if (anyAnomalyHere) console.log()
  else console.log()
}

console.log('═══════════════════════════════════════════════════════════════')
console.log(`Anomalies (over-cap or padelapi-only present): ${totalAnomalies}`)
console.log('═══════════════════════════════════════════════════════════════')

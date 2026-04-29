// Find tournaments where the same match exists as multiple rows.
//
// Each round in a real tournament has a fixed structural size:
//   F  = 1 match per category   (men/women)
//   SF = 2,  QF = 4,  R16 = 8,  R32 = 16,  R64 = 32,  R128 = 64
//
// Walk every tournament, group its matches by (category, canonical
// round), and flag any group whose row count exceeds the structural
// limit. Only counts non-bye matches — `status='bye'` rows are
// legitimate placeholders.
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

const STRUCTURAL_LIMIT = {
  F: 1, SF: 2, QF: 4, R16: 8, R32: 16, R64: 32, R128: 64,
  // Qualifying rounds vary widely (depends on draw size + Q draw size +
  // entries) — skip them in this audit. Only main draw is checked.
}

async function main() {
  await loadEnv()
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
  )

  // Active or recent tournaments
  const cutoff = new Date(Date.now() - 60 * 86400000).toISOString()
  const { data: tournaments } = await s
    .from('tournaments')
    .select('id, name, level, ends_at')
    .gte('ends_at', cutoff)
    .order('ends_at', { ascending: false })

  console.log(`Audited tournaments: ${tournaments?.length ?? 0}\n`)

  let suspectCount = 0
  let totalExtraRows = 0
  for (const t of tournaments ?? []) {
    const { data: matches } = await s
      .from('matches')
      .select('id, round, category, status, padelapi_id, widget_id_composite, scheduled_at, finished_at')
      .eq('tournament_id', t.id)
    if (!matches || matches.length === 0) continue

    // Group by (category, canonical round). Skip bye rows.
    const buckets = new Map()
    for (const m of matches) {
      if (m.status === 'bye') continue
      const rn = normalizeRoundShort(m.round)
      if (!rn || !STRUCTURAL_LIMIT[rn]) continue // qualifiers / unknown
      const key = `${m.category}|${rn}`
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key).push(m)
    }

    const overrun = []
    for (const [key, rows] of buckets) {
      const [cat, rn] = key.split('|')
      const limit = STRUCTURAL_LIMIT[rn]
      if (rows.length > limit) {
        overrun.push({ cat, rn, count: rows.length, limit, sample: rows.slice(0, 3) })
        totalExtraRows += rows.length - limit
      }
    }

    if (overrun.length === 0) continue
    suspectCount++
    console.log(`⚠ ${t.name}`)
    console.log(`  ${t.id}  (ends ${t.ends_at?.slice(0, 10)})`)
    for (const o of overrun) {
      console.log(`  ${o.cat} ${o.rn}: ${o.count} rows (expected ≤ ${o.limit})`)
      o.sample.forEach((m) => {
        const sig =
          m.padelapi_id && m.widget_id_composite ? `padelapi=${m.padelapi_id} + widget=${m.widget_id_composite}`
          : m.padelapi_id ? `padelapi=${m.padelapi_id}`
          : m.widget_id_composite ? `widget=${m.widget_id_composite}`
          : 'no source-id'
        console.log(`    ${m.id.slice(0, 8)}.. round="${m.round}" status=${m.status} ${sig}`)
      })
    }
    console.log()
  }

  console.log(`\n=== Summary ===`)
  console.log(`Tournaments with duplicate matches: ${suspectCount}`)
  console.log(`Total extra rows: ${totalExtraRows}`)
}

main().catch((e) => { console.error(e); process.exit(1) })

// List padelapi-only FIP match rows that are STILL in over-capacity
// rounds after the same-court dedup. For each, show what other rows
// share the same (round, category) bucket so we can decide case-by-case.

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

const STRUCTURAL_CAP = { F: 1, SF: 2, QF: 4, R16: 8, R32: 16, R64: 32, R128: 64 }

function classifySource(m) {
  if (m.padelapi_id && m.widget_id_composite) return 'merged'
  if (m.padelapi_id) return 'padelapi-only'
  if (m.widget_id_composite) return 'widget-only'
  return 'no-source'
}

function lastNameToken(rawName) {
  if (!rawName) return null
  let n = String(rawName).trim()
  if (!n || n === '—') return null
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

// 1. Find FIP tournaments with extras
const { data: tournaments } = await supabase
  .from('tournaments')
  .select('id, name, level')
  .like('level', 'fip_%')
  .gte('ends_at', '2026-03-01')

let totalReported = 0

for (const t of tournaments ?? []) {
  const { data: matches } = await supabase
    .from('matches')
    .select(`
      id, padelapi_id, widget_id_composite, status, round, court, category, scheduled_at, winner_pair, finished_at,
      pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id,
      pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name,
      pair1_player1:pair1_player1_id(name),
      pair1_player2:pair1_player2_id(name),
      pair2_player1:pair2_player1_id(name),
      pair2_player2:pair2_player2_id(name)
    `)
    .eq('tournament_id', t.id)
  if (!matches?.length) continue

  // Bucket by (round, category)
  const buckets = new Map()
  for (const m of matches) {
    if (m.status === 'bye') continue
    const r = normRound(m.round)
    if (!r) continue
    const k = `${r}|${m.category ?? '?'}`
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(m)
  }

  for (const [bk, rows] of buckets) {
    const [round, cat] = bk.split('|')
    const cap = STRUCTURAL_CAP[round]
    if (!cap || rows.length <= cap) continue

    // Bucket is over capacity. Find padelapi-only rows in it.
    const padelapiOnly = rows.filter(m => classifySource(m) === 'padelapi-only')
    if (padelapiOnly.length === 0) continue

    if (totalReported === 0) {
      console.log('═══════════════════════════════════════════════════════════════')
      console.log('REMAINING PADELAPI-ONLY ROWS IN OVER-CAPACITY FIP CLUSTERS')
      console.log('═══════════════════════════════════════════════════════════════\n')
    }

    console.log(`⚠ ${t.name}  ${cat} ${round}  (${rows.length}/${cap})`)
    const sourceCounts = rows.reduce((a, m) => { a[classifySource(m)] = (a[classifySource(m)] || 0) + 1; return a }, {})
    console.log(`  bucket sources: ${Object.entries(sourceCounts).map(([k, v]) => `${k}=${v}`).join(' ')}`)

    for (const m of padelapiOnly) {
      const players = []
      for (const pair of [1, 2]) {
        for (const pos of [1, 2]) {
          const name = m[`pair${pair}_player${pos}`]?.name ?? m[`pair${pair}_player${pos}_name`] ?? '—'
          players.push(name)
        }
      }
      const sched = m.scheduled_at ? m.scheduled_at.slice(0, 16).replace('T', ' ') : '—'
      const isMidnight = m.scheduled_at && new Date(m.scheduled_at).getUTCHours() === 0
      console.log(`  ── padelapi=${m.padelapi_id}  id=${m.id.slice(0, 8)}..`)
      console.log(`     court=${m.court ?? '—'}  status=${m.status}  sched=${sched}${isMidnight ? ' (midnight)' : ''}  winner=${m.winner_pair ?? '—'}`)
      console.log(`     ${players[0]} / ${players[1]}  vs  ${players[2]} / ${players[3]}`)

      // Look for likely twin: same bucket, has widget composite, ≥1 player overlap by name token
      const myTokens = new Set()
      for (const pair of [1, 2]) {
        for (const pos of [1, 2]) {
          const t = lastNameToken(m[`pair${pair}_player${pos}`]?.name ?? m[`pair${pair}_player${pos}_name`])
          if (t) myTokens.add(t)
        }
      }
      const widgetTwins = []
      for (const o of rows) {
        if (o.id === m.id) continue
        if (!o.widget_id_composite) continue
        const oTokens = new Set()
        for (const pair of [1, 2]) {
          for (const pos of [1, 2]) {
            const tk = lastNameToken(o[`pair${pair}_player${pos}`]?.name ?? o[`pair${pair}_player${pos}_name`])
            if (tk) oTokens.add(tk)
          }
        }
        const overlap = [...myTokens].filter(t => oTokens.has(t)).length
        if (overlap >= 1) widgetTwins.push({ o, overlap, tokens: [...oTokens] })
      }
      // Also look for no-source rows with overlap (could be old orphans of same match)
      const noSourceTwins = []
      for (const o of rows) {
        if (o.id === m.id) continue
        if (classifySource(o) !== 'no-source') continue
        const oTokens = new Set()
        for (const pair of [1, 2]) {
          for (const pos of [1, 2]) {
            const tk = lastNameToken(o[`pair${pair}_player${pos}`]?.name ?? o[`pair${pair}_player${pos}_name`])
            if (tk) oTokens.add(tk)
          }
        }
        const overlap = [...myTokens].filter(t => oTokens.has(t)).length
        if (overlap >= 1) noSourceTwins.push({ o, overlap, tokens: [...oTokens] })
      }

      if (widgetTwins.length > 0) {
        for (const tw of widgetTwins) {
          const sched = tw.o.scheduled_at ? tw.o.scheduled_at.slice(0, 16).replace('T', ' ') : '—'
          console.log(`     LIKELY WIDGET TWIN (overlap=${tw.overlap}): ${tw.o.id.slice(0, 8)}.. court=${tw.o.court ?? '—'} sched=${sched} status=${tw.o.status}`)
          console.log(`        widget=${tw.o.widget_id_composite}`)
        }
      } else if (noSourceTwins.length > 0) {
        for (const tw of noSourceTwins) {
          console.log(`     LIKELY NO-SOURCE TWIN (overlap=${tw.overlap}): ${tw.o.id.slice(0, 8)}.. court=${tw.o.court ?? '—'} status=${tw.o.status}`)
        }
      } else {
        console.log(`     ❌ No twin found in same (round,cat) bucket — could be orphan`)
      }
      console.log()
      totalReported++
    }
  }
}

console.log(`\nTotal padelapi-only rows reported: ${totalReported}`)

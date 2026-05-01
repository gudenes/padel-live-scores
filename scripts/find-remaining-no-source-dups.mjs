// Find no-source rows that are STILL duplicates after the
// court+court_order dedup. These are pairs where the no-source side
// has court=null or court_order=null (so the previous gate skipped
// them) but a clear widget twin exists by player-name token overlap.

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

function tokens(name) {
  if (!name) return new Set()
  return new Set(
    String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .split(/\s+/).filter(t => t.length >= 3)
  )
}
function rowTokens(m) {
  const all = new Set()
  for (const slot of ['pair1_player1', 'pair1_player2', 'pair2_player1', 'pair2_player2']) {
    const fk = m[slot]?.name
    const inline = m[`${slot}_name`]
    for (const t of tokens(fk ?? inline)) all.add(t)
  }
  return all
}

const today = new Date().toISOString().slice(0, 10)
const { data: tournaments } = await sb.from('tournaments')
  .select('id, name, level')
  .lte('starts_at', today).gte('ends_at', today)

let totalNoSourceDups = 0
let totalNoSourceLone = 0

for (const t of tournaments ?? []) {
  const { data: matches } = await sb.from('matches')
    .select(`
      id, status, category, court, court_order, round, padelapi_id, widget_id_composite,
      pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name,
      pair1_player1:players!matches_pair1_player1_id_fkey(name),
      pair1_player2:players!matches_pair1_player2_id_fkey(name),
      pair2_player1:players!matches_pair2_player1_id_fkey(name),
      pair2_player2:players!matches_pair2_player2_id_fkey(name)
    `)
    .eq('tournament_id', t.id)

  if (!matches?.length) continue

  // No-source rows that have NO court+court_order — these escaped the prior gate
  const noSource = (matches ?? []).filter(m => !m.padelapi_id && !m.widget_id_composite)
  if (noSource.length === 0) continue

  // For each no-source row, look for a widget twin by category + round + ≥3 token overlap
  const widgetSide = (matches ?? []).filter(m => m.widget_id_composite)
  let dupsHere = 0
  let loneHere = 0
  const dupLines = []
  for (const ns of noSource) {
    const nsTokens = rowTokens(ns)
    if (nsTokens.size < 3) continue  // not enough signal
    let bestTwin = null, bestOverlap = 0
    for (const w of widgetSide) {
      if (w.category !== ns.category) continue
      if ((w.round ?? '') !== (ns.round ?? '')) continue
      const wTokens = rowTokens(w)
      let overlap = 0
      for (const tk of nsTokens) if (wTokens.has(tk)) overlap++
      if (overlap > bestOverlap) { bestOverlap = overlap; bestTwin = w }
    }
    if (bestOverlap >= 3 && bestTwin) {
      dupsHere++
      const summarise = (m) => {
        const players = []
        for (const pair of [1, 2]) for (const pos of [1, 2]) {
          const fk = m[`pair${pair}_player${pos}`]?.name
          const inline = m[`pair${pair}_player${pos}_name`]
          players.push((fk ?? inline ?? '—').slice(0, 18))
        }
        return `${players[0]}/${players[1]} vs ${players[2]}/${players[3]}`
      }
      dupLines.push(`    ${ns.id.slice(0,8)} (no-source, court=${ns.court ?? '—'}, co=${ns.court_order ?? '—'})  ${summarise(ns)}`)
      dupLines.push(`    ↔ ${bestTwin.id.slice(0,8)} (widget=${bestTwin.widget_id_composite?.split(':').pop()}, court=${bestTwin.court ?? '—'}, co=${bestTwin.court_order ?? '—'}, overlap=${bestOverlap})  ${summarise(bestTwin)}`)
    } else {
      loneHere++
    }
  }
  if (dupsHere || loneHere) {
    console.log(`\n▸ ${t.name}  (${t.level})`)
    console.log(`   no-source rows: ${noSource.length}  ·  with widget twin: ${dupsHere}  ·  no twin found: ${loneHere}`)
    for (const line of dupLines) console.log(line)
  }
  totalNoSourceDups += dupsHere
  totalNoSourceLone += loneHere
}

console.log()
console.log('═══════════════════════════════════════════════════════════════')
console.log(`Across live tournaments:`)
console.log(`  no-source rows with widget twin (NEW dedup candidates): ${totalNoSourceDups}`)
console.log(`  no-source rows without twin (genuine orphans, leave alone): ${totalNoSourceLone}`)
console.log('═══════════════════════════════════════════════════════════════')

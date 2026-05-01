// Second-pass dedup: no-source rows that have NULL court / court_order
// (so the prior court+co gate didn't catch them) but match a widget
// twin via category + round + ≥6 player-name token overlap. Same goal
// as dedup-no-source-with-widget-twin.mjs — the gate is just looser
// because court isn't populated on the no-source side.
//
// The token threshold is high (≥6) because we're trading the strict
// venue-level identity (court+co) for fuzzy player-name matching, and
// false-positive deletes here would be irreversible. Real twins
// observed in the wild had 10–13 tokens overlapping, so 6 leaves
// plenty of margin for partial-name variants while rejecting
// coincidental matches.

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

const apply = process.argv.includes('--apply')

const TOKEN_THRESHOLD = 6

// Normalise round labels so "Quarterfinals" and "QF" compare equal —
// the FIP-side populator writes long form, the widget reconciler writes
// short form, and exact-string equality would split them into separate
// dedup buckets. Mirrors normalizeRoundShort in
// padelgod/src/workers/fip-oop-writer.ts.
function normRound(raw) {
  if (!raw) return null
  const c = String(raw).trim().toLowerCase()
  const map = {
    r128: 'R128', 'round of 128': 'R128',
    r64: 'R64', 'round of 64': 'R64',
    r32: 'R32', 'round of 32': 'R32',
    r16: 'R16', 'round of 16': 'R16',
    qf: 'QF', quarter: 'QF', quarters: 'QF', quarterfinal: 'QF', quarterfinals: 'QF', 'quarter-finals': 'QF', 'quarter finals': 'QF',
    sf: 'SF', semifinal: 'SF', semifinals: 'SF', 'semi-finals': 'SF', 'semi finals': 'SF',
    f: 'F', final: 'F', finals: 'F',
    q1: 'Q1', q2: 'Q2', q3: 'Q3',
  }
  return map[c] ?? c
}

function tokens(name) {
  if (!name) return new Set()
  return new Set(
    String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .split(/\s+/).filter(t => t.length >= 3),
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

console.log(`${apply ? '[APPLY]' : '[DRY RUN]'} Token-overlap dedup across ${tournaments?.length ?? 0} live tournament(s)`)
console.log(`Threshold: token overlap ≥ ${TOKEN_THRESHOLD}\n`)

const totals = { tournamentsTouched: 0, deleted: 0, sets: 0, games: 0 }

for (const t of tournaments ?? []) {
  const { data: matches } = await sb.from('matches')
    .select(`
      id, status, category, round, court, court_order, padelapi_id, widget_id_composite,
      pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name,
      pair1_player1:players!matches_pair1_player1_id_fkey(name),
      pair1_player2:players!matches_pair1_player2_id_fkey(name),
      pair2_player1:players!matches_pair2_player1_id_fkey(name),
      pair2_player2:players!matches_pair2_player2_id_fkey(name)
    `)
    .eq('tournament_id', t.id)
  if (!matches?.length) continue

  const noSource = matches.filter(m => !m.padelapi_id && !m.widget_id_composite)
  const widgetSide = matches.filter(m => m.widget_id_composite)
  if (noSource.length === 0 || widgetSide.length === 0) continue

  const targets = []
  for (const ns of noSource) {
    const nsTokens = rowTokens(ns)
    if (nsTokens.size < TOKEN_THRESHOLD) continue
    let bestTwin = null, bestOverlap = 0
    const nsRound = normRound(ns.round)
    for (const w of widgetSide) {
      if (w.category !== ns.category) continue
      if (normRound(w.round) !== nsRound) continue
      const wTokens = rowTokens(w)
      let overlap = 0
      for (const tk of nsTokens) if (wTokens.has(tk)) overlap++
      if (overlap > bestOverlap) { bestOverlap = overlap; bestTwin = w }
    }
    if (bestOverlap >= TOKEN_THRESHOLD && bestTwin) {
      targets.push({ ns, twin: bestTwin, overlap: bestOverlap })
    }
  }
  if (targets.length === 0) continue

  totals.tournamentsTouched++
  console.log(`▸ ${t.name}  (${t.level})  — ${targets.length} no-source rows to merge into widget twins`)
  for (const { ns, twin, overlap } of targets) {
    const summarise = (m) => {
      const players = []
      for (const pair of [1, 2]) for (const pos of [1, 2]) {
        const fk = m[`pair${pair}_player${pos}`]?.name
        const inline = m[`pair${pair}_player${pos}_name`]
        players.push((fk ?? inline ?? '—').slice(0, 22))
      }
      return `${players[0]}/${players[1]} vs ${players[2]}/${players[3]}`
    }
    console.log(`   delete ${ns.id.slice(0,8)} (no-source, ${ns.round}, ${ns.category}) — ${summarise(ns)}`)
    console.log(`     twin ${twin.id.slice(0,8)} (widget=${twin.widget_id_composite?.split(':').pop()}, court=${twin.court}, co=${twin.court_order}) overlap=${overlap}`)

    if (!apply) continue

    try {
      const { count: sn } = await sb.from('sets').delete({ count: 'exact' }).eq('match_id', ns.id)
      totals.sets += sn ?? 0
      const { count: gn } = await sb.from('games').delete({ count: 'exact' }).eq('match_id', ns.id)
      totals.games += gn ?? 0
      const { error } = await sb.from('matches').delete().eq('id', ns.id)
      if (error) throw new Error(error.message)
      totals.deleted++
    } catch (e) {
      console.log(`     ✗ ${e.message}`)
    }
  }
  console.log()
}

console.log('═══════════════════════════════════════════════════════════════')
console.log(`${apply ? 'Applied' : 'Would delete'}:`)
console.log(`  tournaments touched: ${totals.tournamentsTouched}`)
console.log(`  no-source rows: ${apply ? totals.deleted : '(see above)'}`)
if (apply) {
  console.log(`  sets deleted:   ${totals.sets}`)
  console.log(`  games deleted:  ${totals.games}`)
}
console.log('═══════════════════════════════════════════════════════════════')
if (!apply) console.log('\nRe-run with --apply to commit.')

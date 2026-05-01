// Cleanup pass for STALE no-source rows: delete any no-source row in a
// (round, category) bucket whose widget+merged side already meets or
// exceeds the structural cap for the round. Those buckets have NO
// room for more matches by definition; a no-source row sitting on top
// is leftover from a pre-resolution legacy reconciler write that no
// longer reflects reality (typically pre-qualifier R16/QF placeholders
// where the actual players were filled in via Q3 winners).
//
// Safety: at-cap on the widget side IS the safety condition. R16 has
// exactly 8 slots; if widget already holds all 8, any extra row in
// that bucket is redundant by structural contract. The widget side
// (Crionet live OOP / results) is canonical for "who's actually in
// this slot right now"; legacy reconciler can lag by hours-to-days
// because it reads the FIP draw page which doesn't update as
// qualifiers play. Token-overlap with widget rows is a coincidence,
// not a signal — observed in the wild: orphan A. Demetriou (Cyprus
// local) sharing "andres" with the Cohen-side opponent Andres
// Fernandez Lanchares.

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

const STRUCTURAL_CAP = { F: 1, SF: 2, QF: 4, R16: 8, R32: 16, R64: 32, R128: 64 }

function normRound(raw) {
  if (!raw) return null
  const c = String(raw).trim().toLowerCase()
  const m = {
    r128: 'R128', 'round of 128': 'R128',
    r64: 'R64', 'round of 64': 'R64',
    r32: 'R32', 'round of 32': 'R32',
    r16: 'R16', 'round of 16': 'R16',
    qf: 'QF', quarter: 'QF', quarters: 'QF', quarterfinals: 'QF', quarterfinal: 'QF', 'quarter-finals': 'QF',
    sf: 'SF', semifinals: 'SF', semifinal: 'SF', 'semi-finals': 'SF',
    f: 'F', final: 'F', finals: 'F',
    q1: 'Q1', q2: 'Q2', q3: 'Q3',
  }
  return m[c] ?? null
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

console.log(`${apply ? '[APPLY]' : '[DRY RUN]'} Stale no-source cleanup across ${tournaments?.length ?? 0} live tournaments\n`)

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

  // Bucket by (normalised round, category)
  const buckets = new Map()
  for (const m of matches) {
    const r = normRound(m.round)
    if (!r) continue
    const k = `${m.category}|${r}`
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(m)
  }

  const targets = []
  for (const [bk, rows] of buckets) {
    const [, round] = bk.split('|')
    const cap = STRUCTURAL_CAP[round]
    if (!cap) continue
    const widgetSide = rows.filter(r => r.widget_id_composite)
    const noSource = rows.filter(r => !r.padelapi_id && !r.widget_id_composite)
    if (widgetSide.length < cap) continue       // bucket not at cap → not stale-by-cap
    if (noSource.length === 0) continue

    // Bucket is at-cap on the widget side — every no-source row here is
    // redundant by structural contract. Compute the max token overlap
    // with widget rows for diagnostics only (so the operator can spot
    // a true positive vs. coincidental name collision in the log).
    for (const ns of noSource) {
      const nsTokens = rowTokens(ns)
      let maxOverlap = 0
      for (const w of widgetSide) {
        const wTokens = rowTokens(w)
        let n = 0
        for (const tk of nsTokens) if (wTokens.has(tk)) n++
        if (n > maxOverlap) maxOverlap = n
      }
      targets.push({ ns, bucket: bk, cap, widgetSize: widgetSide.length, maxOverlap })
    }
  }
  if (targets.length === 0) continue

  totals.tournamentsTouched++
  console.log(`▸ ${t.name}  (${t.level}) — ${targets.length} stale orphans`)
  for (const x of targets) {
    const players = []
    for (const pair of [1,2]) for (const pos of [1,2]) {
      players.push((x.ns[`pair${pair}_player${pos}`]?.name ?? x.ns[`pair${pair}_player${pos}_name`] ?? '—').slice(0,22))
    }
    console.log(`   ${apply ? '✓' : '·'} ${x.ns.id.slice(0,8)} ${x.bucket} (widget side ${x.widgetSize}/${x.cap}, max-overlap=${x.maxOverlap})`)
    console.log(`     ${players[0]}/${players[1]} vs ${players[2]}/${players[3]}`)
    if (!apply) continue
    try {
      const { count: sn } = await sb.from('sets').delete({ count: 'exact' }).eq('match_id', x.ns.id)
      totals.sets += sn ?? 0
      const { count: gn } = await sb.from('games').delete({ count: 'exact' }).eq('match_id', x.ns.id)
      totals.games += gn ?? 0
      const { error } = await sb.from('matches').delete().eq('id', x.ns.id)
      if (error) throw new Error(error.message)
      totals.deleted++
    } catch (e) { console.log(`     ✗ ${e.message}`) }
  }
  console.log()
}

console.log('═══════════════════════════════════════════════════════════════')
console.log(`Tournaments touched: ${totals.tournamentsTouched}`)
console.log(`${apply ? 'Deleted' : 'Would delete'}: ${apply ? totals.deleted : '(see above)'}`)
if (apply) {
  console.log(`Sets:  ${totals.sets}`)
  console.log(`Games: ${totals.games}`)
}
console.log('═══════════════════════════════════════════════════════════════')
if (!apply) console.log('\nRe-run with --apply to commit.')

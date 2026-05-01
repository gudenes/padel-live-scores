// Targeted FIP cross-pipeline merge: catches the duplicates that
// dedup-pattern-b-multi-pipeline.mjs missed because the cluster
// signature requires ≥3 last-name tokens.
//
// Pattern: padelapi creates a placeholder row with only 2-of-4 players
// resolved (Pair 1 has UUIDs, Pair 2 names are empty/'—'). Padelgod
// later writes the actual played match with all 4 inline names but no
// player UUIDs. The two rows have the SAME court + round + category
// for the same physical match, but the dedup script's last-name token
// signature for the padelapi row only had 2 tokens (below the ≥3
// threshold) so it skipped clustering.
//
// This script identifies pairs where:
//   - Both rows belong to the same FIP-tier tournament
//   - Same normalized round (R128/R64/R32/R16/QF/SF/F + Q1/Q2/Q3)
//   - Same category (men/women)
//   - Same court (string equal, both non-null)
//   - At least 1 last-name token overlap between the two rows
//   - One has padelapi_id and the other has widget_id_composite
//
// The widget row wins as survivor (better data, real time). The
// padelapi_id is migrated onto the survivor before the padelapi row
// is deleted.
//
// Defaults to dry-run; pass --apply to mutate.
// Optional --tournament <id> to restrict to one tournament.

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
    qf: 'QF', quarter: 'QF', quarters: 'QF', quarterfinal: 'QF', quarterfinals: 'QF', 'quarter-finals': 'QF',
    sf: 'SF', semi: 'SF', semis: 'SF', semifinal: 'SF', semifinals: 'SF', 'semi-finals': 'SF',
    f: 'F', final: 'F', finals: 'F',
    q1: 'Q1', q2: 'Q2', q3: 'Q3',
  }
  return m[c] ?? null
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

function tokenize(m, playerNameById) {
  const tokens = new Set()
  for (let pair = 1; pair <= 2; pair++) {
    for (let pos = 1; pos <= 2; pos++) {
      const id = m[`pair${pair}_player${pos}_id`]
      const inline = m[`pair${pair}_player${pos}_name`]
      const resolved = id ? playerNameById.get(id) : null
      const tok = lastNameToken(resolved ?? inline)
      if (tok) tokens.add(tok)
    }
  }
  return tokens
}

function isMidnightUTC(iso) {
  if (!iso) return false
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0
}

await loadEnv()
const apply = process.argv.includes('--apply')
const tournamentArg = (() => {
  const i = process.argv.indexOf('--tournament')
  return i >= 0 ? process.argv[i + 1] : null
})()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
)

console.log(`${apply ? '[APPLY]' : '[DRY RUN]'} FIP same-court cross-pipeline merge${tournamentArg ? ` (tournament=${tournamentArg})` : ''}\n`)

// 1. FIP-tier tournaments
let q = supabase.from('tournaments').select('id, name, level').like('level', 'fip_%')
if (tournamentArg) q = q.eq('id', tournamentArg)
const { data: tournaments } = await q
console.log(`FIP-tier tournaments scanned: ${tournaments?.length ?? 0}\n`)

let totalPairs = 0
let totalApplied = 0
let totalFailed = 0
const planByTournament = []

for (const t of tournaments ?? []) {
  // Pull all matches for this tournament
  const { data: matches } = await supabase
    .from('matches')
    .select('id, padelapi_id, widget_id_composite, status, round, category, court, scheduled_at, winner_pair, finished_at, last_updated_by, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name')
    .eq('tournament_id', t.id)

  if (!matches || matches.length === 0) continue

  // Resolve player names for FK references
  const playerIds = new Set()
  for (const m of matches) {
    for (const f of [m.pair1_player1_id, m.pair1_player2_id, m.pair2_player1_id, m.pair2_player2_id]) {
      if (f) playerIds.add(f)
    }
  }
  const playerNameById = new Map()
  if (playerIds.size > 0) {
    const { data: players } = await supabase.from('players').select('id, name, display_name').in('id', [...playerIds])
    for (const p of players ?? []) playerNameById.set(p.id, p.display_name ?? p.name)
  }

  // Bucket by (round, category, court). Court must be non-null on both sides.
  const buckets = new Map()
  for (const m of matches) {
    const r = normRound(m.round)
    if (!r) continue
    if (!m.court || m.court === '') continue
    const k = `${r}|${m.category ?? '?'}|${m.court}`
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(m)
  }

  const tournamentPairs = []

  for (const [bk, rows] of buckets) {
    // We need at least one padelapi-only row AND at least one widget-only row in the bucket
    const padelapiOnly = rows.filter(m => m.padelapi_id && !m.widget_id_composite)
    const widgetOnly = rows.filter(m => m.widget_id_composite && !m.padelapi_id)
    if (padelapiOnly.length === 0 || widgetOnly.length === 0) continue

    // Try to pair them by ≥1 token overlap. Greedy: each pair consumes
    // both rows (a padelapi row can match exactly one widget row).
    const usedPadelapi = new Set()
    const usedWidget = new Set()

    for (const w of widgetOnly) {
      if (usedWidget.has(w.id)) continue
      const wTokens = tokenize(w, playerNameById)
      for (const p of padelapiOnly) {
        if (usedPadelapi.has(p.id)) continue
        const pTokens = tokenize(p, playerNameById)
        let overlap = 0
        for (const t of pTokens) if (wTokens.has(t)) overlap++
        if (overlap >= 1) {
          // Match!
          usedPadelapi.add(p.id)
          usedWidget.add(w.id)
          tournamentPairs.push({
            survivor: w,        // widget row wins
            duplicate: p,       // padelapi row gets removed
            tokenOverlap: overlap,
            wTokens: [...wTokens],
            pTokens: [...pTokens],
            bucketKey: bk,
          })
          break
        }
      }
    }
  }

  if (tournamentPairs.length === 0) continue
  totalPairs += tournamentPairs.length
  planByTournament.push({ tournament: t, pairs: tournamentPairs })
}

console.log(`Cross-pipeline merge candidates: ${totalPairs}\n`)

// 2. Print plan
for (const tp of planByTournament) {
  console.log(`⚠ ${tp.tournament.name} (${tp.tournament.level})`)
  for (const p of tp.pairs) {
    const [round, cat, court] = p.bucketKey.split('|')
    const sschd = p.survivor.scheduled_at?.slice(0, 16).replace('T', ' ') ?? '—'
    const dschd = p.duplicate.scheduled_at?.slice(0, 16).replace('T', ' ') ?? '—'
    const dmidnight = isMidnightUTC(p.duplicate.scheduled_at) ? ' (midnight ⚠)' : ''
    console.log(`  ${cat} ${round} court=${court} (overlap=${p.tokenOverlap})`)
    console.log(`    keep   ${p.survivor.id.slice(0, 8)}.. widget=${p.survivor.widget_id_composite}  status=${p.survivor.status}  sched=${sschd}  tokens=[${p.wTokens.join(',')}]`)
    console.log(`    delete ${p.duplicate.id.slice(0, 8)}.. padelapi=${p.duplicate.padelapi_id}  status=${p.duplicate.status}  sched=${dschd}${dmidnight}  tokens=[${p.pTokens.join(',')}]`)
  }
  console.log()
}

if (!apply) {
  console.log(`[DRY RUN] No writes. Re-run with --apply to execute.`)
  process.exit(0)
}

// 3. Apply
console.log(`\n[APPLY] Executing plan…\n`)
let merged = 0, fieldUpdates = 0, deleted = 0, setsDeleted = 0, gamesDeleted = 0, failed = 0
for (const tp of planByTournament) {
  for (const p of tp.pairs) {
    try {
      // Children: if survivor has 0 sets and dupe has some, migrate; else delete dupe's children
      const { count: survSetCount } = await supabase
        .from('sets').select('id', { count: 'exact', head: true }).eq('match_id', p.survivor.id)
      const { count: dupSetCount } = await supabase
        .from('sets').select('id', { count: 'exact', head: true }).eq('match_id', p.duplicate.id)

      if ((survSetCount ?? 0) === 0 && (dupSetCount ?? 0) > 0) {
        const { error: e1 } = await supabase.from('sets').update({ match_id: p.survivor.id }).eq('match_id', p.duplicate.id)
        if (e1) throw new Error(`sets migrate: ${e1.message}`)
        const { error: e2 } = await supabase.from('games').update({ match_id: p.survivor.id }).eq('match_id', p.duplicate.id)
        if (e2) throw new Error(`games migrate: ${e2.message}`)
      } else if ((dupSetCount ?? 0) > 0) {
        const { count: sn, error: e1 } = await supabase.from('sets').delete({ count: 'exact' }).eq('match_id', p.duplicate.id)
        if (e1) throw new Error(`sets delete: ${e1.message}`)
        setsDeleted += sn ?? 0
        const { count: gn, error: e2 } = await supabase.from('games').delete({ count: 'exact' }).eq('match_id', p.duplicate.id)
        if (e2) throw new Error(`games delete: ${e2.message}`)
        gamesDeleted += gn ?? 0
      }

      // Delete padelapi row
      const { error: e3 } = await supabase.from('matches').delete().eq('id', p.duplicate.id)
      if (e3) throw new Error(`match delete: ${e3.message}`)
      deleted++

      // Migrate fields onto survivor: padelapi_id, plus any field where survivor is null
      // and dupe has a value. Special case: scheduled_at — only migrate if survivor has
      // none (we never overwrite a real time with the padelapi date-only sentinel).
      const migrate = { padelapi_id: p.duplicate.padelapi_id }
      const FIELDS = ['finished_at', 'winner_pair']
      for (const f of FIELDS) {
        if (p.survivor[f] != null) continue
        if (p.duplicate[f] != null) migrate[f] = p.duplicate[f]
      }
      if (!p.survivor.scheduled_at && p.duplicate.scheduled_at && !isMidnightUTC(p.duplicate.scheduled_at)) {
        migrate.scheduled_at = p.duplicate.scheduled_at
      }
      const { error: e4 } = await supabase.from('matches').update(migrate).eq('id', p.survivor.id)
      if (e4) throw new Error(`survivor update: ${e4.message}`)
      merged++
      if (Object.keys(migrate).length > 0) fieldUpdates++
    } catch (e) {
      console.error(`  ✗ ${p.duplicate.id.slice(0, 8)}.. → ${p.survivor.id.slice(0, 8)}.. — ${e.message}`)
      failed++
    }
  }
}
console.log(`\nDone.`)
console.log(`  merged:        ${merged}`)
console.log(`  field updates: ${fieldUpdates}`)
console.log(`  deleted:       ${deleted}`)
console.log(`  sets deleted:  ${setsDeleted}`)
console.log(`  games deleted: ${gamesDeleted}`)
console.log(`  failed:        ${failed}`)
totalApplied = merged
totalFailed = failed

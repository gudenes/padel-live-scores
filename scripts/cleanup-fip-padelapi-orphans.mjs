// Cleanup pass: drop FIP-tier match rows that came from padelapi.
//
// After the dedup-pattern-b run on 2026-05-01, padelapi-only FIP rows
// remained — either because the dedup heuristic couldn't cluster them
// with their padelgod twin (last-name token / UUID-overlap pass missed)
// or because no padelgod twin exists yet for that match.
//
// This script targets matches where ALL of:
//   - tournament.level LIKE 'fip_%'
//   - matches.padelapi_id IS NOT NULL  (created by padelapi)
//   - matches.widget_id_composite IS NULL  (no padelgod twin linked)
//
// For each candidate, looks for a fuzzier padelgod twin in the same
// tournament + round + category using either:
//   (a) ≥2-of-4 player UUID overlap (relaxed from dedup-pattern-b's ≥3)
//   (b) court + scheduled date match
// If a twin is found, migrates non-null fields onto it (preferring the
// padelapi row's data when widget row is null) then deletes the
// padelapi row.
// If no twin found, the padelapi row is deleted outright — padelgod
// will create the row when it sees the match (or it's a stale
// orphan from a tournament that already finished).
//
// Defaults to dry-run; pass --apply to mutate.

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

function isMidnightUTC(iso) {
  if (!iso) return false
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0
}

await loadEnv()
const apply = process.argv.includes('--apply')
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
)

console.log(`${apply ? '[APPLY]' : '[DRY RUN]'} FIP padelapi orphan cleanup\n`)

// 1. Pull all FIP-tier tournaments
const { data: tournaments } = await supabase
  .from('tournaments')
  .select('id, name, level, ends_at')
  .like('level', 'fip_%')
  .order('ends_at', { ascending: false })

console.log(`FIP-tier tournaments scanned: ${tournaments?.length ?? 0}`)

// Pre-build lookup
const tournamentById = new Map((tournaments ?? []).map(t => [t.id, t]))
const tournamentIds = (tournaments ?? []).map(t => t.id)

// 2. Pull all candidate rows in a single query — paginated
const candidates = []
const PAGE = 1000
let from = 0
while (true) {
  const { data: page, error } = await supabase
    .from('matches')
    .select('id, padelapi_id, widget_id_composite, tournament_id, round, category, court, scheduled_at, status, winner_pair, finished_at, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id')
    .not('padelapi_id', 'is', null)
    .is('widget_id_composite', null)
    .in('tournament_id', tournamentIds.slice(0, 100))  // chunked below
    .range(from, from + PAGE - 1)
  if (error) {
    console.error('query error', error)
    process.exit(1)
  }
  if (!page || page.length === 0) break
  candidates.push(...page)
  if (page.length < PAGE) break
  from += PAGE
}

// Re-do without the tournament-id chunk if we hit the in() limit
// (use a different strategy: pull all FIP matches via tournament join)
if (tournamentIds.length > 100) {
  // Simpler: fetch all candidates by paginating without tournament filter,
  // then filter in JS
  candidates.length = 0
  from = 0
  while (true) {
    const { data: page, error } = await supabase
      .from('matches')
      .select('id, padelapi_id, widget_id_composite, tournament_id, round, category, court, scheduled_at, status, winner_pair, finished_at, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id')
      .not('padelapi_id', 'is', null)
      .is('widget_id_composite', null)
      .range(from, from + PAGE - 1)
    if (error) { console.error(error); process.exit(1) }
    if (!page || page.length === 0) break
    candidates.push(...page)
    if (page.length < PAGE) break
    from += PAGE
  }
}

const fipCandidates = candidates.filter(m => tournamentById.has(m.tournament_id))
console.log(`Candidate FIP padelapi-only rows: ${fipCandidates.length}\n`)

if (fipCandidates.length === 0) {
  console.log('Nothing to clean up.')
  process.exit(0)
}

// 3. For each candidate, look for a padelgod twin
const breakdown = {
  withTwin: 0,
  withTwinMigrated: 0,
  noTwin: 0,
  noTwinScheduledMidnight: 0,
  noTwinScheduledReal: 0,
  noTwinNoSchedule: 0,
  noTwinFinished: 0,
  byTier: {},
}

const plan = []  // [{ candidate, twin?, migrate?, action: 'merge'|'delete' }]

for (const c of fipCandidates) {
  const tournament = tournamentById.get(c.tournament_id)
  const tier = tournament?.level
  breakdown.byTier[tier] = (breakdown.byTier[tier] ?? 0) + 1

  // Look for a padelgod twin: same tournament + round + category, has widget_id_composite
  const candNorm = normRound(c.round)
  const cIds = new Set(
    [c.pair1_player1_id, c.pair1_player2_id, c.pair2_player1_id, c.pair2_player2_id].filter(Boolean),
  )

  // Pull all widget-keyed matches in same tournament + same category
  const { data: widgetMatches } = await supabase
    .from('matches')
    .select('id, widget_id_composite, round, court, scheduled_at, status, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id')
    .eq('tournament_id', c.tournament_id)
    .not('widget_id_composite', 'is', null)
    .eq('category', c.category)

  let twin = null
  for (const w of widgetMatches ?? []) {
    if (normRound(w.round) !== candNorm) continue
    const wIds = new Set(
      [w.pair1_player1_id, w.pair1_player2_id, w.pair2_player1_id, w.pair2_player2_id].filter(Boolean),
    )
    let overlap = 0
    for (const id of cIds) if (wIds.has(id)) overlap++
    if (overlap >= 2) { twin = w; break }
  }

  if (twin) {
    breakdown.withTwin++
    // Plan a merge: copy non-null fields from candidate onto twin where twin has null,
    // EXCEPT scheduled_at — never replace twin's real scheduled_at with candidate's
    // (candidate's is the bad midnight UTC that started this whole cleanup).
    const migrate = {}
    const FIELDS = ['padelapi_id', 'finished_at', 'court', 'winner_pair', 'status']
    for (const f of FIELDS) {
      if (twin[f] != null) continue
      if (c[f] != null) migrate[f] = c[f]
    }
    // Only migrate scheduled_at if twin has none
    if (!twin.scheduled_at && c.scheduled_at && !isMidnightUTC(c.scheduled_at)) {
      migrate.scheduled_at = c.scheduled_at
    }
    if (Object.keys(migrate).length > 0) breakdown.withTwinMigrated++
    plan.push({ candidate: c, twin, migrate, action: 'merge', tournament })
  } else {
    breakdown.noTwin++
    if (c.scheduled_at && isMidnightUTC(c.scheduled_at)) breakdown.noTwinScheduledMidnight++
    else if (c.scheduled_at) breakdown.noTwinScheduledReal++
    else breakdown.noTwinNoSchedule++
    if (c.status === 'finished' || c.status === 'retired' || c.status === 'walkover') breakdown.noTwinFinished++
    plan.push({ candidate: c, twin: null, action: 'delete', tournament })
  }
}

console.log('── Breakdown ──')
console.log(`  Has padelgod twin (will merge): ${breakdown.withTwin}`)
console.log(`    of which need field migration: ${breakdown.withTwinMigrated}`)
console.log(`  No twin found (will delete): ${breakdown.noTwin}`)
console.log(`    of which scheduled@midnight: ${breakdown.noTwinScheduledMidnight}`)
console.log(`    of which scheduled@real-time: ${breakdown.noTwinScheduledReal}`)
console.log(`    of which no scheduled_at:    ${breakdown.noTwinNoSchedule}`)
console.log(`    of which already finished:    ${breakdown.noTwinFinished}`)
console.log()
console.log('── By tier ──')
for (const [tier, count] of Object.entries(breakdown.byTier).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${tier.padEnd(20)} ${count}`)
}
console.log()

// 4. Sample output: show 10 examples of each action
const merges = plan.filter(p => p.action === 'merge')
const deletes = plan.filter(p => p.action === 'delete')

if (merges.length > 0) {
  console.log(`── Sample merges (${merges.length} total) ──`)
  for (const p of merges.slice(0, 10)) {
    const fields = Object.keys(p.migrate).length ? Object.keys(p.migrate).join(',') : '(none)'
    console.log(`  ${p.tournament?.name?.slice(0, 40).padEnd(40)} ${p.candidate.round?.slice(0, 12).padEnd(12)} migrate=${fields}`)
    console.log(`    candidate ${p.candidate.id.slice(0, 8)}.. padelapi=${p.candidate.padelapi_id} sched=${p.candidate.scheduled_at?.slice(0, 16) ?? '—'}`)
    console.log(`    twin      ${p.twin.id.slice(0, 8)}.. widget=${p.twin.widget_id_composite} sched=${p.twin.scheduled_at?.slice(0, 16) ?? '—'}`)
  }
  console.log()
}

if (deletes.length > 0) {
  console.log(`── Sample deletes (${deletes.length} total) ──`)
  for (const p of deletes.slice(0, 10)) {
    console.log(`  ${p.tournament?.name?.slice(0, 40).padEnd(40)} ${p.candidate.round?.slice(0, 12).padEnd(12)} status=${p.candidate.status} sched=${p.candidate.scheduled_at?.slice(0, 16) ?? '—'}`)
    console.log(`    ${p.candidate.id.slice(0, 8)}.. padelapi=${p.candidate.padelapi_id}`)
  }
  console.log()
}

if (!apply) {
  console.log(`[DRY RUN] No writes. Re-run with --apply to execute.`)
  console.log(`         ${plan.length} rows total: ${merges.length} merges + ${deletes.length} deletes`)
  process.exit(0)
}

// 5. Apply
console.log(`\n[APPLY] Executing plan…\n`)
let merged = 0, fieldUpdates = 0, deleted = 0, setsDeleted = 0, gamesDeleted = 0, failed = 0

for (const p of plan) {
  try {
    if (p.action === 'merge') {
      // Migrate sets/games children if twin has none
      const { count: twinSetCount } = await supabase
        .from('sets').select('id', { count: 'exact', head: true }).eq('match_id', p.twin.id)
      const { count: candSetCount } = await supabase
        .from('sets').select('id', { count: 'exact', head: true }).eq('match_id', p.candidate.id)

      if ((twinSetCount ?? 0) === 0 && (candSetCount ?? 0) > 0) {
        const { error: e1 } = await supabase.from('sets').update({ match_id: p.twin.id }).eq('match_id', p.candidate.id)
        if (e1) throw new Error(`sets migrate: ${e1.message}`)
        const { error: e2 } = await supabase.from('games').update({ match_id: p.twin.id }).eq('match_id', p.candidate.id)
        if (e2) throw new Error(`games migrate: ${e2.message}`)
      } else if ((candSetCount ?? 0) > 0) {
        // Twin already has sets — delete candidate's sets/games
        const { count: sn, error: e1 } = await supabase.from('sets').delete({ count: 'exact' }).eq('match_id', p.candidate.id)
        if (e1) throw new Error(`sets delete: ${e1.message}`)
        setsDeleted += sn ?? 0
        const { count: gn, error: e2 } = await supabase.from('games').delete({ count: 'exact' }).eq('match_id', p.candidate.id)
        if (e2) throw new Error(`games delete: ${e2.message}`)
        gamesDeleted += gn ?? 0
      }

      // Delete the candidate match row
      const { error: e3 } = await supabase.from('matches').delete().eq('id', p.candidate.id)
      if (e3) throw new Error(`match delete: ${e3.message}`)

      // Migrate fields onto twin
      if (Object.keys(p.migrate).length > 0) {
        const { error: e4 } = await supabase.from('matches').update(p.migrate).eq('id', p.twin.id)
        if (e4) throw new Error(`twin update: ${e4.message}`)
        fieldUpdates++
      }
      merged++
      deleted++
    } else {
      // Plain delete: kill children first
      const { count: sn, error: e1 } = await supabase.from('sets').delete({ count: 'exact' }).eq('match_id', p.candidate.id)
      if (e1) throw new Error(`sets delete: ${e1.message}`)
      setsDeleted += sn ?? 0
      const { count: gn, error: e2 } = await supabase.from('games').delete({ count: 'exact' }).eq('match_id', p.candidate.id)
      if (e2) throw new Error(`games delete: ${e2.message}`)
      gamesDeleted += gn ?? 0
      const { error: e3 } = await supabase.from('matches').delete().eq('id', p.candidate.id)
      if (e3) throw new Error(`match delete: ${e3.message}`)
      deleted++
    }
  } catch (e) {
    console.error(`  ✗ ${p.candidate.id.slice(0, 8)}.. ${e.message}`)
    failed++
  }
}

console.log(`\nDone.`)
console.log(`  merged:        ${merged}`)
console.log(`  field updates: ${fieldUpdates}`)
console.log(`  deleted:       ${deleted}`)
console.log(`  sets deleted:  ${setsDeleted}`)
console.log(`  games deleted: ${gamesDeleted}`)
console.log(`  failed:        ${failed}`)

// One-shot: re-apply the OOP writer's new round-overwrite logic to
// existing matches. The previous gap-fill rule left rows stuck on
// the populator's draw-bracket label (e.g. R32) even when the OOP
// for the same widget said something different (e.g. Q3).
//
// Mirrors `buildOopPatch` in
// `padelgod/src/workers/fip-oop-writer.ts` for the round comparison
// — kept inline so this script doesn't need the padelgod build.
//
// Defaults to dry-run; pass --apply to actually mutate.

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
  if (cleaned === '') return null
  const map = {
    r128: 'R128',
    'round of 128': 'R128',
    r64: 'R64',
    'round of 64': 'R64',
    r32: 'R32',
    'round of 32': 'R32',
    r16: 'R16',
    'round of 16': 'R16',
    qf: 'QF',
    quarter: 'QF',
    quarters: 'QF',
    quarterfinals: 'QF',
    'quarter-finals': 'QF',
    'quarter finals': 'QF',
    sf: 'SF',
    semifinals: 'SF',
    'semi-finals': 'SF',
    'semi finals': 'SF',
    f: 'F',
    final: 'F',
    finals: 'F',
    q1: 'Q1',
    q2: 'Q2',
    q3: 'Q3',
  }
  return map[cleaned] ?? null
}

async function main() {
  await loadEnv()
  const apply = process.argv.includes('--apply')
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
  )

  console.log(`${apply ? '[APPLY]' : '[DRY RUN]'} Reconciling round labels…\n`)

  // Latest OOP snapshot per (tournament_id, match_widget_id).
  // Only consider currently-active tournaments to keep the workload
  // focused on what users see today.
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data: oop, error: oopErr } = await supabase
    .schema('padelgod')
    .from('oop_snapshots')
    .select('tournament_id, match_widget_id, round_label, captured_at')
    .gte('captured_at', cutoff)
    .order('captured_at', { ascending: false })
  if (oopErr) throw new Error(`oop_snapshots read failed: ${oopErr.message}`)

  // Dedupe to latest per (tournament_id, match_widget_id)
  const latest = new Map()
  for (const r of oop ?? []) {
    if (!r.match_widget_id || !r.round_label) continue
    const key = `${r.tournament_id}::${r.match_widget_id}`
    if (!latest.has(key)) latest.set(key, r)
  }
  console.log(`Latest OOP rows: ${latest.size}`)

  // Pull widget IDs once per tournament so we can build composites.
  const tournamentIds = [...new Set([...latest.values()].map((o) => o.tournament_id))]
  const { data: widgets } = await supabase
    .schema('padelgod')
    .from('widget_id_cache')
    .select('tournament_id, widget_id')
    .in('tournament_id', tournamentIds)
    .eq('is_active', true)
  const widgetByTournament = new Map(
    (widgets ?? []).map((w) => [w.tournament_id, w.widget_id]),
  )

  // Build the set of composites and read existing matches.
  const composites = []
  for (const o of latest.values()) {
    const w = widgetByTournament.get(o.tournament_id)
    if (!w) continue
    composites.push(`${w}:${o.match_widget_id}`)
  }
  console.log(`Lookup composites: ${composites.length}\n`)

  // Read in chunks of 200 to stay under PostgREST URL limits
  const matches = []
  for (let i = 0; i < composites.length; i += 200) {
    const chunk = composites.slice(i, i + 200)
    const { data, error } = await supabase
      .from('matches')
      .select('id, widget_id_composite, round, tournament_id')
      .in('widget_id_composite', chunk)
    if (error) throw new Error(`matches read failed: ${error.message}`)
    matches.push(...(data ?? []))
  }
  const matchByComposite = new Map(matches.map((m) => [m.widget_id_composite, m]))

  // Compare and plan updates
  const updates = []
  for (const o of latest.values()) {
    const w = widgetByTournament.get(o.tournament_id)
    if (!w) continue
    const composite = `${w}:${o.match_widget_id}`
    const m = matchByComposite.get(composite)
    if (!m) continue
    const oopNorm = normalizeRoundShort(o.round_label)
    const existingNorm = normalizeRoundShort(m.round)
    if (oopNorm && oopNorm !== existingNorm) {
      updates.push({
        matchId: m.id,
        composite,
        from: m.round,
        to: o.round_label,
      })
    }
  }

  console.log(`Round mismatches found: ${updates.length}\n`)
  for (const u of updates.slice(0, 20)) {
    console.log(`  ${u.composite}: ${u.from} → ${u.to}`)
  }
  if (updates.length > 20) console.log(`  …and ${updates.length - 20} more`)
  console.log()

  if (!apply) {
    console.log('[DRY RUN] No writes. Re-run with --apply to execute.')
    return
  }

  let ok = 0
  let failed = 0
  for (const u of updates) {
    const { error } = await supabase
      .from('matches')
      .update({ round: u.to })
      .eq('id', u.matchId)
    if (error) {
      console.log(`  ✗ ${u.matchId}: ${error.message}`)
      failed++
    } else {
      ok++
    }
  }
  console.log(`Done. updated=${ok} failed=${failed}`)
}

main().catch((e) => { console.error(e); process.exit(1) })

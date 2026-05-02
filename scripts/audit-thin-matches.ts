/**
 * Audit thin matches across active padelgod-sourced tournaments.
 *
 * "Thin match" = a match row where at least one pair*_player*_id is NULL
 * but the corresponding pair*_player*_name is set. These indicate the
 * fip-draw-populator couldn't resolve the player name to a public.players
 * FK (short-form mismatch, middle-name mismatch, not in entry list, etc.).
 *
 * Usage:
 *   npx tsx scripts/audit-thin-matches.ts
 *
 * Reports only tournaments with ≥1 thin match.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Lightweight .env.local loader
function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"(.*)"$/, '$1')
    }
  } catch { /* fine */ }
}
loadEnv()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } }
)

async function main() {
  // 1. Find active padelgod-sourced tournaments (ends_at >= 7 days ago)
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: tournaments, error: tErr } = await supabase
    .from('tournaments')
    .select('id, name, level, ends_at')
    .eq('live_source', 'padelgod')
    .gte('ends_at', cutoff)
    .order('ends_at', { ascending: false })

  if (tErr) throw new Error(`tournaments: ${tErr.message}`)
  console.log(`Active padelgod tournaments (ends_at >= ${cutoff.slice(0, 10)}): ${(tournaments ?? []).length}`)

  if (!tournaments || tournaments.length === 0) {
    console.log('No active tournaments found.')
    return
  }

  const tournamentIds = tournaments.map((t) => t.id)

  // 2. Find all thin matches: any pair*_player*_id is NULL but the
  //    corresponding name is set. Use OR conditions on the nulls.
  //
  //    We can't use a single .is() on all 4 columns with OR in PostgREST
  //    easily, so we load matches with all 4 FKs and filter in JS.
  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select(
      'id, tournament_id, widget_id_composite, round, ' +
      'pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, ' +
      'pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name'
    )
    .in('tournament_id', tournamentIds)
    .not('widget_id_composite', 'is', null) // only populator-created rows
    .or(
      'pair1_player1_id.is.null,pair1_player2_id.is.null,' +
      'pair2_player1_id.is.null,pair2_player2_id.is.null'
    )

  if (mErr) throw new Error(`matches: ${mErr.message}`)

  // Filter to only rows that actually have at least one name set where id is null
  // (exclude rows where all names are null — those are legitimate "no players yet")
  const thinMatches = (matches ?? []).filter((m) => {
    const pairs = [
      { id: m.pair1_player1_id, name: m.pair1_player1_name },
      { id: m.pair1_player2_id, name: m.pair1_player2_name },
      { id: m.pair2_player1_id, name: m.pair2_player1_name },
      { id: m.pair2_player2_id, name: m.pair2_player2_name },
    ]
    return pairs.some((p) => p.id == null && p.name != null)
  })

  if (thinMatches.length === 0) {
    console.log('\nNo thin matches found across active tournaments.')
    return
  }

  // 3. Group by tournament
  const byTournament = new Map<string, typeof thinMatches>()
  for (const m of thinMatches) {
    if (!byTournament.has(m.tournament_id)) byTournament.set(m.tournament_id, [])
    byTournament.get(m.tournament_id)!.push(m)
  }

  const tournamentById = new Map((tournaments ?? []).map((t) => [t.id, t]))

  console.log(`\nThin matches found: ${thinMatches.length} across ${byTournament.size} tournament(s)\n`)

  // 4. Report
  const byLevel = new Map<string, { count: number; tournaments: number }>()

  for (const [tid, matchList] of byTournament) {
    const t = tournamentById.get(tid)
    const level = t?.level ?? 'unknown'
    const levelStats = byLevel.get(level) ?? { count: 0, tournaments: 0 }
    levelStats.count += matchList.length
    levelStats.tournaments += 1
    byLevel.set(level, levelStats)

    console.log(`  ${t?.name ?? tid} (${level}, ends ${t?.ends_at?.slice(0, 10) ?? '?'})`)
    console.log(`    Thin matches: ${matchList.length}`)

    // Sample unresolved names
    const unresolvedNames = new Set<string>()
    for (const m of matchList) {
      const pairs = [
        { id: m.pair1_player1_id, name: m.pair1_player1_name },
        { id: m.pair1_player2_id, name: m.pair1_player2_name },
        { id: m.pair2_player1_id, name: m.pair2_player1_name },
        { id: m.pair2_player2_id, name: m.pair2_player2_name },
      ]
      for (const p of pairs) {
        if (p.id == null && p.name) unresolvedNames.add(p.name)
      }
    }
    const sample = Array.from(unresolvedNames).slice(0, 5)
    console.log(`    Sample unresolved names: ${sample.map((n) => `"${n}"`).join(', ')}${unresolvedNames.size > 5 ? ` (+${unresolvedNames.size - 5} more)` : ''}`)
  }

  console.log('\n=== By level ===')
  for (const [level, stats] of [...byLevel.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${level}: ${stats.count} thin matches across ${stats.tournaments} tournament(s)`)
  }

  const THRESHOLD_TOURNAMENTS = 5
  const THRESHOLD_MATCHES = 20
  if (byTournament.size > THRESHOLD_TOURNAMENTS || thinMatches.length > THRESHOLD_MATCHES) {
    console.log(`\n⚠ Count exceeds threshold (>${THRESHOLD_TOURNAMENTS} tournaments or >${THRESHOLD_MATCHES} matches).`)
    console.log('  Consider triggering a wider re-resolution pass.')
  } else {
    console.log(`\nCount within threshold — note as backlog item.`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })

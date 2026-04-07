// scripts/purge-simulated.ts
// One-off cleanup: finds any trace of simulator-created data and deletes it.
// Simulator signatures:
//   - tournaments.source === 'simulated'
//   - tournaments.level === 'simulated'
//   - tournaments.external_id LIKE 'sim_%'
//   - matches.external_id LIKE 'sim_%'
//
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... tsx scripts/purge-simulated.ts

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

// Load .env.local manually so we don't need dotenv as a dep
function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  const content = fs.readFileSync(envPath, 'utf8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[key]) process.env[key] = value
  }
}
loadEnv()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

async function main() {
  console.log('\n=== Inspecting simulator traces ===\n')

  // 1. Tournaments with source = 'simulated'
  const { data: bySource } = await supabase
    .from('tournaments')
    .select('id, name, source, level, external_id')
    .eq('source', 'simulated')
  console.log(`Tournaments with source='simulated': ${bySource?.length ?? 0}`)
  bySource?.forEach((t) => console.log(`  - ${t.id}  ${t.name}  (ext:${t.external_id})`))

  // 2. Tournaments with level = 'simulated'
  const { data: byLevel } = await supabase
    .from('tournaments')
    .select('id, name, source, level, external_id')
    .eq('level', 'simulated')
  console.log(`\nTournaments with level='simulated': ${byLevel?.length ?? 0}`)
  byLevel?.forEach((t) => console.log(`  - ${t.id}  ${t.name}  (source:${t.source ?? 'null'})`))

  // 3. Tournaments with external_id starting with sim_
  const { data: byExt } = await supabase
    .from('tournaments')
    .select('id, name, source, level, external_id')
    .like('external_id', 'sim_%')
  console.log(`\nTournaments with external_id LIKE 'sim_%': ${byExt?.length ?? 0}`)
  byExt?.forEach((t) => console.log(`  - ${t.id}  ${t.name}  (ext:${t.external_id})`))

  // 4. Matches with external_id starting with sim_
  const { data: matchesByExt, count: matchExtCount } = await supabase
    .from('matches')
    .select('id, external_id, tournament_id, status', { count: 'exact' })
    .like('external_id', 'sim_%')
  console.log(`\nMatches with external_id LIKE 'sim_%': ${matchExtCount ?? 0}`)
  if (matchesByExt && matchesByExt.length > 0) {
    const byTournament = new Map<string, number>()
    for (const m of matchesByExt) {
      byTournament.set(m.tournament_id, (byTournament.get(m.tournament_id) ?? 0) + 1)
    }
    console.log(`  spread across ${byTournament.size} tournaments:`)
    for (const [tid, n] of byTournament) console.log(`    ${tid}: ${n} matches`)
  }

  // Collect all tournament IDs to delete
  const tournamentIds = new Set<string>()
  bySource?.forEach((t) => tournamentIds.add(t.id))
  byLevel?.forEach((t) => tournamentIds.add(t.id))
  byExt?.forEach((t) => tournamentIds.add(t.id))

  console.log(`\n=== Summary ===`)
  console.log(`Tournaments to delete: ${tournamentIds.size}`)
  console.log(`Orphan sim_ matches to delete: ${matchExtCount ?? 0}`)

  if (tournamentIds.size === 0 && (matchExtCount ?? 0) === 0) {
    console.log('\nNothing to clean up. Exiting.')
    return
  }

  if (process.argv.includes('--dry-run')) {
    console.log('\nDry run — no deletions performed. Re-run without --dry-run to apply.')
    return
  }

  console.log('\n=== Deleting ===\n')

  // 1. Delete matches with sim_ external_id directly (handles orphans under real tournaments)
  if ((matchExtCount ?? 0) > 0) {
    const { error: delMatchErr, count: deletedMatchCount } = await supabase
      .from('matches')
      .delete({ count: 'exact' })
      .like('external_id', 'sim_%')
    if (delMatchErr) {
      console.error('Failed to delete sim_ matches:', delMatchErr)
      process.exit(1)
    }
    console.log(`Deleted ${deletedMatchCount} matches with sim_ external_id`)
  }

  // 2. Delete the simulated tournaments (will cascade any remaining matches)
  if (tournamentIds.size > 0) {
    const idsArray = [...tournamentIds]
    const { error: delTournErr, count: deletedTournCount } = await supabase
      .from('tournaments')
      .delete({ count: 'exact' })
      .in('id', idsArray)
    if (delTournErr) {
      console.error('Failed to delete tournaments:', delTournErr)
      process.exit(1)
    }
    console.log(`Deleted ${deletedTournCount} tournaments`)
  }

  console.log('\nDone.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

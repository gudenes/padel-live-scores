// scripts/cleanup-broken-matches.ts
//
// Deletes "broken" matches: rows whose status says they were played
// (finished/retired/walkover) but where one of the two pairs has NULL
// player IDs. These show up in the UI as "?/? vs RealName" which is
// useless to users.
//
// CRITERIA (must satisfy ALL):
//   - status IN ('finished', 'retired', 'walkover')  ← supposedly played
//   - At least one player FK is NULL
//
// WHAT IT KEEPS
//   - status = 'bye' rows (legitimate tournament structure)
//   - Finished rows with all players but no sets (metadata is complete,
//     scores can be re-fetched later from padelapi)
//   - Cancelled rows (historical record)
//
// FK CASCADE
// We delete child rows explicitly in order:
//   1. games (referenced via match_id)
//   2. sets (referenced via match_id)
//   3. matches
// This is safer than relying on ON DELETE CASCADE in case the DB
// schema doesn't have it everywhere.
//
// Usage:
//   node --experimental-strip-types scripts/cleanup-broken-matches.ts --dry-run
//   node --experimental-strip-types scripts/cleanup-broken-matches.ts

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Finding broken matches...\n`)

  // Find broken matches: finished-state but missing at least one player FK
  const { data: broken, error } = await supabase
    .from('matches')
    .select(`
      id, status, round, finished_at, tournament_id,
      pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id,
      tournament:tournaments(name, level, source)
    `)
    .in('status', ['finished', 'retired', 'walkover'])
    .or('pair1_player1_id.is.null,pair1_player2_id.is.null,pair2_player1_id.is.null,pair2_player2_id.is.null')

  if (error) {
    console.error('Failed to query matches:', error)
    process.exit(1)
  }

  const brokenList = broken ?? []
  console.log(`Found ${brokenList.length} broken matches\n`)

  if (brokenList.length === 0) {
    console.log('Nothing to clean up. Exiting.')
    return
  }

  // Group by tournament + source for the report
  const bySource: Record<string, number> = {}
  const byTournament = new Map<string, { count: number; level: string; source: string }>()

  for (const m of brokenList) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = (m as any).tournament
    const src = t?.source ?? 'unknown'
    bySource[src] = (bySource[src] ?? 0) + 1
    const tname = t?.name ?? '(unknown tournament)'
    const entry = byTournament.get(tname) ?? { count: 0, level: t?.level ?? '?', source: src }
    entry.count++
    byTournament.set(tname, entry)
  }

  console.log('=== Breakdown ===')
  console.log()
  console.log('By source:')
  for (const [src, count] of Object.entries(bySource)) {
    console.log(`  ${src.padEnd(12)} ${count}`)
  }
  console.log()
  console.log('Top tournaments:')
  const sorted = [...byTournament.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 15)
  for (const [name, info] of sorted) {
    console.log(`  ${info.count.toString().padStart(3)} | ${info.level.padEnd(14)} | ${info.source.padEnd(10)} | ${name.slice(0, 50)}`)
  }

  // Check FK refs on these matches (so we know how many child rows to delete)
  const brokenIds = brokenList.map(m => m.id)
  console.log()
  console.log('=== FK references to delete ===')

  const { count: gamesCount } = await supabase
    .from('games')
    .select('id', { count: 'exact', head: true })
    .in('match_id', brokenIds)
  console.log(`  games: ${gamesCount ?? 0}`)

  const { count: setsCount } = await supabase
    .from('sets')
    .select('id', { count: 'exact', head: true })
    .in('match_id', brokenIds)
  console.log(`  sets:  ${setsCount ?? 0}`)

  // Sanity check: anything user-facing?
  const { count: bookmarkCount } = await supabase
    .from('user_bookmarks')
    .select('id', { count: 'exact', head: true })
    .eq('bookmark_type', 'match')
    .in('target_id', brokenIds)
  if ((bookmarkCount ?? 0) > 0) {
    console.error()
    console.error(`⚠ ABORT: ${bookmarkCount} user_bookmarks reference these matches.`)
    console.error('Resolve manually before running cleanup.')
    process.exit(1)
  }
  console.log(`  user_bookmarks: 0 (safe)`)

  if (dryRun) {
    console.log()
    console.log(`[DRY RUN] Would delete:`)
    console.log(`  - ${gamesCount ?? 0} games`)
    console.log(`  - ${setsCount ?? 0} sets`)
    console.log(`  - ${brokenList.length} matches`)
    console.log()
    console.log('Re-run without --dry-run to execute.')
    return
  }

  // Execute deletion in order: games → sets → matches
  console.log()
  console.log('=== Deleting ===\n')

  // Supabase has a default limit on .in() length — chunk to be safe
  const CHUNK_SIZE = 100
  const chunks: string[][] = []
  for (let i = 0; i < brokenIds.length; i += CHUNK_SIZE) {
    chunks.push(brokenIds.slice(i, i + CHUNK_SIZE))
  }

  let deletedGames = 0
  let deletedSets = 0
  let deletedMatches = 0
  let failed = 0

  for (const chunk of chunks) {
    // 1. Delete games
    const { error: gErr, count: gCount } = await supabase
      .from('games')
      .delete({ count: 'exact' })
      .in('match_id', chunk)
    if (gErr) {
      console.error(`  ✗ games delete failed for chunk:`, gErr.message)
      failed += chunk.length
      continue
    }
    deletedGames += gCount ?? 0

    // 2. Delete sets
    const { error: sErr, count: sCount } = await supabase
      .from('sets')
      .delete({ count: 'exact' })
      .in('match_id', chunk)
    if (sErr) {
      console.error(`  ✗ sets delete failed for chunk:`, sErr.message)
      failed += chunk.length
      continue
    }
    deletedSets += sCount ?? 0

    // 3. Delete matches
    const { error: mErr, count: mCount } = await supabase
      .from('matches')
      .delete({ count: 'exact' })
      .in('id', chunk)
    if (mErr) {
      console.error(`  ✗ matches delete failed for chunk:`, mErr.message)
      failed += chunk.length
      continue
    }
    deletedMatches += mCount ?? 0
  }

  console.log(`✓ Deleted ${deletedGames} games`)
  console.log(`✓ Deleted ${deletedSets} sets`)
  console.log(`✓ Deleted ${deletedMatches} matches`)
  if (failed > 0) {
    console.error(`✗ ${failed} matches failed to delete`)
    process.exit(1)
  }

  console.log()
  console.log('Done.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

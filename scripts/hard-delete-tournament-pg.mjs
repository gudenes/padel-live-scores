// Direct-Postgres version of hard-delete-tournament. Uses DATABASE_URL
// instead of PostgREST so we can SET statement_timeout per session and
// not be killed by the default ~8s limit during lock contention with
// the padelgod workers.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const text = await fs.readFile(path.resolve('.env.local'), 'utf8')
for (const line of text.split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue
  const eq = t.indexOf('='); if (eq === -1) continue
  const k = t.slice(0, eq).trim(); const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  if (!process.env[k]) process.env[k] = v
}

const TARGET = process.argv[2]
const APPLY = process.argv.includes('--apply')
if (!TARGET) {
  console.error('Usage: node scripts/hard-delete-tournament-pg.mjs <tournament-id> [--apply]')
  process.exit(1)
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

// Run each DELETE inside its own transaction with SET LOCAL so that the
// pooler honors the elevated timeout. SET (without LOCAL) is dropped by
// Supavisor; SET LOCAL applies only inside the surrounding transaction.
async function tx(sql, params = []) {
  await client.query('BEGIN')
  try {
    await client.query("SET LOCAL statement_timeout = '120s'")
    await client.query("SET LOCAL lock_timeout = '30s'")
    const r = await client.query(sql, params)
    await client.query('COMMIT')
    return r
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  }
}

const { rows: tours } = await client.query(
  'SELECT id, name, level, padelapi_id, fip_id, starts_at, ends_at FROM tournaments WHERE id = $1',
  [TARGET],
)
if (tours.length === 0) {
  console.error('Tournament not found')
  await client.end()
  process.exit(1)
}
const tour = tours[0]
console.log(`\nTarget: ${tour.name}`)
console.log(`  id=${tour.id}  padelapi_id=${tour.padelapi_id}  fip_id=${tour.fip_id}`)
console.log(`  ${tour.starts_at?.toISOString?.().slice(0,10)} → ${tour.ends_at?.toISOString?.().slice(0,10)}\n`)

// Step list. Ordered so leaf rows die before their parents.
// padelgod.scrape_jobs's children (raw_payloads) cascade automatically.
// entry_list_snapshots / draw_snapshots / results_snapshots / oop_snapshots /
// widget_id_cache are ON DELETE CASCADE from the tournament — so the final
// `DELETE FROM tournaments` will sweep them. unresolved_players is NOT cascade,
// must clear manually.
const STEPS = [
  // public side (already mostly cleared in previous partial run, kept idempotent)
  { label: 'public.games', sql: `DELETE FROM games WHERE match_id IN (SELECT id FROM matches WHERE tournament_id = $1)` },
  { label: 'public.sets', sql: `DELETE FROM sets WHERE match_id IN (SELECT id FROM matches WHERE tournament_id = $1)` },
  { label: 'public.match_stats', sql: `DELETE FROM match_stats WHERE match_id IN (SELECT id FROM matches WHERE tournament_id = $1)` },
  { label: 'public.matches', sql: `DELETE FROM matches WHERE tournament_id = $1` },
  { label: 'public.tournament_draws', sql: `DELETE FROM tournament_draws WHERE tournament_id = $1` },
  // padelgod side — batched because of worker contention + 2min statement_timeout
  { label: 'padelgod.scrape_jobs', batchedTable: { schema: 'padelgod', table: 'scrape_jobs', size: 25 } },
  { label: 'padelgod.unresolved_players', sql: `DELETE FROM padelgod.unresolved_players WHERE tournament_id = $1` },
  // Pre-clear the big CASCADE children before the tournament DELETE so the
  // final cascade has very little to do (otherwise we risk hitting the 2min
  // statement_timeout on the cascade itself).
  { label: 'padelgod.entry_list_snapshots', batchedTable: { schema: 'padelgod', table: 'entry_list_snapshots', size: 500 } },
  { label: 'padelgod.draw_snapshots', batchedTable: { schema: 'padelgod', table: 'draw_snapshots', size: 500 } },
  { label: 'padelgod.results_snapshots', batchedTable: { schema: 'padelgod', table: 'results_snapshots', size: 500 } },
  { label: 'padelgod.oop_snapshots', batchedTable: { schema: 'padelgod', table: 'oop_snapshots', size: 500 } },
  { label: 'padelgod.widget_id_cache', sql: `DELETE FROM padelgod.widget_id_cache WHERE tournament_id = $1` },
  // Final tournament row.
  { label: 'public.tournaments', sql: `DELETE FROM tournaments WHERE id = $1` },
]

if (!APPLY) {
  console.log('[DRY RUN] Pass --apply to execute. Planned steps:')
  for (const s of STEPS) console.log(`  - ${s.label}`)
  await client.end()
  process.exit(0)
}

console.log('[APPLY] Executing...\n')
for (const step of STEPS) {
  try {
    if (step.batchedTable) {
      const { schema, table, size } = step.batchedTable
      let total = 0
      const stepStart = Date.now()
      while (true) {
        const r = await tx(
          `DELETE FROM ${schema}.${table} WHERE id IN (SELECT id FROM ${schema}.${table} WHERE tournament_id = $1 LIMIT ${size})`,
          [TARGET],
        )
        if (!r.rowCount) break
        total += r.rowCount
        process.stdout.write(`    ${schema}.${table}: ${total} deleted (${((Date.now()-stepStart)/1000).toFixed(0)}s elapsed)\n`)
      }
      console.log(`  ✓ ${step.label.padEnd(48)} ${total} (${((Date.now()-stepStart)/1000).toFixed(0)}s)`)
    } else {
      const t0 = Date.now()
      const r = await tx(step.sql, [TARGET])
      console.log(`  ✓ ${step.label.padEnd(48)} ${r.rowCount} (${Date.now()-t0}ms)`)
    }
  } catch (e) {
    console.error(`  ✗ ${step.label}: ${e.message}`)
    await client.end()
    process.exit(1)
  }
}

await client.end()
console.log('\nDone.')

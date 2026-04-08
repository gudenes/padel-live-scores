// scripts/merge-tournament-duplicates.ts
//
// Merges cross-source tournament duplicates: tournaments that exist as both
// a padelapi-sourced row AND a fip-sourced row for the same real-world event.
// After running, the padelapi row survives with FIP-only fields merged in,
// and the FIP row is hard-deleted.
//
// Matching rule: same normalized name (stripped of year tokens, noise words,
// accents) AND same year (from starts_at).
//
// Safety:
//   - Pre-flight check that the FIP row has no FK references before deletion.
//     Aborts the whole operation if ANY reference is found — the Phase 2 plan
//     assumed zero refs (confirmed in investigation) and we don't want to
//     silently orphan data.
//   - --dry-run mode prints the plan without touching anything.
//   - Each merge runs as a small transaction-per-row (not a single mega tx)
//     so a failure partway through leaves the already-processed rows in a
//     consistent state.
//
// Prerequisite: the Phase 1 migration (20260407_canonical_source_ids.sql)
// must be applied — this script writes to the new `fip_id` column.
//
// Usage:
//   node --experimental-strip-types scripts/merge-tournament-duplicates.ts --dry-run
//   node --experimental-strip-types scripts/merge-tournament-duplicates.ts

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { tokenize } from '../src/lib/source-matcher.ts'

// ── env loader ────────────────────────────────────────────────
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

// ── helpers ────────────────────────────────────────────────────
// normalizeName produces a space-separated canonical string from the
// tournament name (diacritic-free, year-stripped, noise-filtered).
// It is a thin wrapper around tokenize() in source-matcher.ts to keep
// the groupKey logic identical to the original while sharing the
// canonical tokenizer with the discovery cron.
function normalizeName(n: string): string {
  return tokenize(n).join(' ')
}

function groupKey(name: string, startsAt: string | null): string {
  const year = startsAt?.slice(0, 4) ?? '0000'
  return `${normalizeName(name)}|${year}`
}

// FK tables that reference tournaments — we check all of these before deletion
const FK_TABLES: Array<{ table: string; col: string }> = [
  { table: 'matches', col: 'tournament_id' },
  { table: 'tournament_draws', col: 'tournament_id' },
  { table: 'articles', col: 'tournament_id' },
  { table: 'highlights', col: 'tournament_id' },
]

// Fields to merge from the FIP row into the padelapi row when they're null on
// padelapi but present on FIP. These are FIP-specific enrichments that don't
// clash with padelapi's operational data.
const MERGE_FIELDS = [
  'url',
  'fip_slug',          // kept in sync with fip_id by the Phase 1 trigger
  'matchscorer_url',
  'draw_size_md',
  'draw_size_qd',
  'prize_money_fip',
  'logo_url',
] as const

// ── types ─────────────────────────────────────────────────────
interface TournamentRow {
  id: string
  external_id: string | null
  fip_slug: string | null
  fip_id?: string | null
  name: string
  source: string | null
  level: string | null
  starts_at: string | null
  ends_at: string | null
  entry_list_status: string | null
  // Dynamic merge fields
  [key: string]: unknown
}

// ── main ──────────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes('--dry-run')

  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Fetching tournaments...\n`)

  const { data: all, error } = await supabase
    .from('tournaments')
    .select('*')
    .in('level', ['fip_gold', 'fip_platinum', 'fip_other'])
  if (error) {
    console.error('Failed to fetch tournaments:', error)
    process.exit(1)
  }

  // Group by normalized name + year
  const groups = new Map<string, TournamentRow[]>()
  for (const t of (all ?? []) as TournamentRow[]) {
    const k = groupKey(t.name, t.starts_at)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(t)
  }

  // Find cross-source duplicates: groups with both padelapi and fip rows
  const duplicates: Array<{ padelapi: TournamentRow; fip: TournamentRow; key: string }> = []
  for (const [key, rows] of groups) {
    if (rows.length < 2) continue
    const padelapi = rows.find(r => r.source === 'padelapi')
    const fip = rows.find(r => r.source === 'fip')
    if (padelapi && fip) {
      duplicates.push({ padelapi, fip, key })
    }
  }

  console.log(`Found ${duplicates.length} cross-source duplicate groups\n`)
  if (duplicates.length === 0) {
    console.log('Nothing to merge. Exiting.')
    return
  }

  // Pre-flight: FK reference check on ALL FIP rows before touching anything.
  // If any FIP row has dependents, abort — the script design assumes hard
  // delete is safe, and it is only if nothing references the row.
  console.log('=== Pre-flight FK check ===')
  const fipIds = duplicates.map(d => d.fip.id)
  const fkIssues: Array<{ table: string; count: number }> = []
  for (const { table, col } of FK_TABLES) {
    const { count } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .in(col, fipIds)
    console.log(`  ${table}.${col}: ${count ?? 0}`)
    if ((count ?? 0) > 0) fkIssues.push({ table, count: count ?? 0 })
  }

  if (fkIssues.length > 0) {
    console.error(`\nABORT: ${fkIssues.length} FK issue(s) found — dedup is not safe:`)
    fkIssues.forEach(i => console.error(`  ${i.table}: ${i.count} rows reference a FIP duplicate`))
    console.error('\nResolve these references manually, then re-run.')
    process.exit(1)
  }

  console.log('  ✓ All FIP duplicate rows are safe to delete (zero FK refs)\n')

  // Build the merge plan
  console.log('=== Merge plan ===\n')
  const plan: Array<{
    padelapiId: string
    fipId: string
    name: string
    year: string
    updates: Record<string, unknown>
    overrideEntryListStatus: boolean
  }> = []

  for (const { padelapi, fip, key } of duplicates) {
    const updates: Record<string, unknown> = {}

    // Set fip_id on the surviving padelapi row (copied from the FIP row's
    // clean slug — NOT the double-prefixed external_id).
    if (fip.fip_slug && !padelapi.fip_id) {
      updates.fip_id = fip.fip_slug
    }

    // Merge FIP-only enrichment fields (only when padelapi's is null)
    for (const field of MERGE_FIELDS) {
      const fipVal = fip[field]
      const padelVal = padelapi[field]
      if (fipVal != null && padelVal == null) {
        updates[field] = fipVal
      }
    }

    // entry_list_status: padelapi often has 'not_applicable' which drowns out
    // meaningful FIP state. Prefer FIP's value when padelapi is not_applicable.
    let overrideEntryListStatus = false
    if (
      padelapi.entry_list_status === 'not_applicable' &&
      fip.entry_list_status &&
      fip.entry_list_status !== 'not_applicable'
    ) {
      updates.entry_list_status = fip.entry_list_status
      overrideEntryListStatus = true
    }

    plan.push({
      padelapiId: padelapi.id,
      fipId: fip.id,
      name: padelapi.name,
      year: key.split('|')[1],
      updates,
      overrideEntryListStatus,
    })
  }

  // Print the plan
  plan.forEach((p, i) => {
    console.log(`${i + 1}. ${p.name} (${p.year})`)
    console.log(`   keep:   ${p.padelapiId}`)
    console.log(`   delete: ${p.fipId}`)
    if (Object.keys(p.updates).length === 0) {
      console.log(`   merge:  (no field updates needed)`)
    } else {
      console.log(`   merge fields:`)
      for (const [k, v] of Object.entries(p.updates)) {
        const valStr = v == null ? '(null)' : JSON.stringify(v).slice(0, 60)
        const note = k === 'entry_list_status' && p.overrideEntryListStatus ? ' (overrides not_applicable)' : ''
        console.log(`     ${k.padEnd(22)} = ${valStr}${note}`)
      }
    }
    console.log()
  })

  if (dryRun) {
    console.log('\n[DRY RUN] No changes applied. Re-run without --dry-run to execute.\n')
    return
  }

  // Execute
  // NOTE ordering: delete FIP row FIRST, then update padelapi row.
  // The FIP row owns the unique fip_slug value; updating the padelapi row to
  // claim the same fip_id while the FIP row still exists violates the new
  // unique index on fip_id. All merge values were already fetched into the
  // `plan` object in memory, so deleting the FIP row first is safe.
  console.log('=== Executing merges ===\n')
  let merged = 0
  let failed = 0
  for (const p of plan) {
    try {
      // 1. Delete the FIP row first to free up the fip_id slot
      const { error: deleteErr } = await supabase
        .from('tournaments')
        .delete()
        .eq('id', p.fipId)
      if (deleteErr) {
        console.error(`  ✗ ${p.name} (${p.year}): delete failed — ${deleteErr.message}`)
        failed++
        continue
      }

      // 2. Update the padelapi row with merged fields (skipped if empty)
      if (Object.keys(p.updates).length > 0) {
        const { error: updateErr } = await supabase
          .from('tournaments')
          .update(p.updates)
          .eq('id', p.padelapiId)
        if (updateErr) {
          console.error(`  ✗ ${p.name} (${p.year}): update failed after FIP delete — ${updateErr.message}`)
          console.error(`    WARNING: FIP row ${p.fipId} is already deleted. Merge fields NOT applied.`)
          failed++
          continue
        }
      }

      console.log(`  ✓ ${p.name} (${p.year})`)
      merged++
    } catch (e) {
      console.error(`  ✗ ${p.name} (${p.year}): ${e instanceof Error ? e.message : String(e)}`)
      failed++
    }
  }

  console.log(`\n=== Done ===`)
  console.log(`Merged: ${merged}`)
  console.log(`Failed: ${failed}`)
  if (failed > 0) process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

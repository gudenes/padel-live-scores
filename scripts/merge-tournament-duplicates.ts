// scripts/merge-tournament-duplicates.ts
//
// Merges cross-source tournament duplicates: tournaments that exist as both
// a padelapi-sourced row AND a fip-sourced row for the same real-world event.
// After running, the padelapi row survives, FIP-only fields are merged in
// (per source-priority rules — FIP wins for fields where it's the primary
// source), and all FK references previously pointing at the FIP row are
// redirected to the padelapi row. The FIP row is then deleted.
//
// Matching rule: same normalized name (stripped of year tokens, noise words,
// accents) AND same year (from starts_at). All FIP/Premier levels are
// considered — the previous implementation's `level IN (...)` filter was
// stale and missed silver / bronze / p1 / p2 events.
//
// FK tables redirected:
//   - matches.tournament_id
//   - tournament_draws.tournament_id
//   - highlights.tournament_id
//   - match_stats_unresolved.resolved_tournament_id
//   - entity_external_ids (polymorphic; entity_type='tournament' rows are
//     redirected, with conflict handling on the
//     UNIQUE(source, entity_type, external_id) constraint — duplicate
//     external IDs on the FIP side are dropped instead of redirected).
//
// Safety:
//   - --dry-run prints the full plan (per-pair updates, FK row counts,
//     external-ID redirects vs drops) without writing anything.
//   - --apply is required to mutate. Each pair runs as a tight sequence
//     (FK redirects → external-ID handling → tournament UPDATE → DELETE
//     FIP row) so a failure mid-pair leaves the row in a consistent
//     state and subsequent pairs continue.
//   - Per-pair failures are logged but don't halt the run; final summary
//     reports merged / failed counts.
//
// Prerequisite: the Phase 1 migration (20260407_canonical_source_ids.sql)
// must be applied — this script writes to the new `fip_id` column.
//
// Usage:
//   node --experimental-strip-types scripts/merge-tournament-duplicates.ts                # dry-run by default
//   node --experimental-strip-types scripts/merge-tournament-duplicates.ts --apply        # actually write

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

// FK tables that reference tournaments. Each row pointing at a FIP-side
// duplicate is UPDATEd to point at the padelapi survivor before the FIP
// row is deleted. Schema defaults to `public`; pass `schema` to target a
// different one (e.g. padelgod's operational tables).
const FK_TABLES: Array<{ table: string; col: string; schema?: string }> = [
  { table: 'matches', col: 'tournament_id' },
  { table: 'tournament_draws', col: 'tournament_id' },
  { table: 'highlights', col: 'tournament_id' },
  { table: 'match_stats_unresolved', col: 'resolved_tournament_id' },
  // Padelgod-schema tables that own a tournament_id. Keep this list in
  // sync with the padelgod schema — any new table that joins to
  // public.tournaments via FK should be added here so dedup runs don't
  // hit RESTRICT errors on unrelated workflow data.
  { table: 'scrape_jobs', col: 'tournament_id', schema: 'padelgod' },
  { table: 'unresolved_players', col: 'tournament_id', schema: 'padelgod' },
  { table: 'unresolved_matches', col: 'tournament_id', schema: 'padelgod' },
  { table: 'draw_snapshots', col: 'tournament_id', schema: 'padelgod' },
  { table: 'results_snapshots', col: 'tournament_id', schema: 'padelgod' },
  { table: 'oop_snapshots', col: 'tournament_id', schema: 'padelgod' },
  { table: 'entry_list_snapshots', col: 'tournament_id', schema: 'padelgod' },
  { table: 'widget_id_cache', col: 'tournament_id', schema: 'padelgod' },
]

/** Resolve a Supabase query builder for the right schema. */
function fk(t: { table: string; schema?: string }) {
  return t.schema ? supabase.schema(t.schema).from(t.table) : supabase.from(t.table)
}

// Fields where FIP is the PRIMARY source per source-priority.ts — when
// FIP has a value, it wins (overwrites padelapi's even when set). For
// padelapi-primary fields like `name` and `prize_money`, padelapi keeps
// its value and we don't list them here.
const FIP_PRIMARY_FIELDS = [
  'logo_url',
  'draw_size_md',
] as const

// FIP-only enrichment fields with no padelapi equivalent. Always copy
// FIP's value over when set.
const FIP_ONLY_FIELDS = [
  'url',
  'fip_slug',          // kept in sync with fip_id by the Phase 1 trigger
  'matchscorer_url',
  'draw_size_qd',
  'prize_money_fip',
] as const

const MERGE_FIELDS = [...FIP_PRIMARY_FIELDS, ...FIP_ONLY_FIELDS] as const

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
//
// Plan flow per cross-source duplicate pair:
//
//   1. Compute UPDATE payload for the padelapi survivor:
//        - FIP-primary fields (logo_url, draw_size_md): use FIP's value
//          when set (per source-priority.ts).
//        - FIP-only enrichments (matchscorer_url, fip_slug, etc.): copy
//          when FIP has them.
//        - fip_id: copy from FIP row's fip_slug if survivor's is null.
//        - entry_list_status: prefer FIP when padelapi's is the
//          uninformative 'not_applicable'.
//
//   2. List FK redirects across the 4 reference tables.
//
//   3. Inspect entity_external_ids rows on the FIP side. For each, check
//      whether a row with the same (source, external_id) already exists
//      on the padelapi survivor. If yes → drop the FIP-side row to avoid
//      the unique-constraint conflict. If no → redirect entity_id to
//      the survivor.
//
// Execution order (live mode only):
//   FK redirects → entity_external_ids handling → tournament UPDATE →
//   DELETE FIP tournament row.
//
// Why this order: padelapi survivor must already hold the fip_id
// (carried via UPDATE) before we DELETE the FIP row, but we can't
// UPDATE the survivor with the FIP row's fip_slug while the FIP row
// still has it (UNIQUE index on fip_id). Solution: redirect FKs first
// (cheap, safe) → handle external IDs → DELETE the FIP row first to
// release fip_slug → finally UPDATE survivor with merge fields. This
// matches the previous script's reasoning (delete-before-update) but
// adds the FK + sidecar steps in front.
async function main() {
  // Default to dry-run; require explicit --apply to mutate.
  const apply = process.argv.includes('--apply')
  const dryRun = !apply

  console.log(`\n${dryRun ? '[DRY RUN] ' : '[APPLY] '}Fetching tournaments...\n`)

  const { data: all, error } = await supabase
    .from('tournaments')
    .select('*')
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

  // Find cross-source duplicates: groups with both a padelapi-linked row
  // (`padelapi_id` populated) and a FIP-only row (only `fip_id` populated).
  // The `source` column is unreliable for this — old padelapi-imported
  // tournaments still report source='fip' after the discovery flow change.
  const duplicates: Array<{ padelapi: TournamentRow; fip: TournamentRow; key: string }> = []
  for (const [key, rows] of groups) {
    if (rows.length < 2) continue
    // Prefer the row that has a padelapi_id as the survivor — it's the
    // canonical id for live-scoring writes and the relay path. The FIP
    // row gets folded into it.
    const padelapi = rows.find(r => r.padelapi_id != null)
    const fip = rows.find(r => r !== padelapi && r.padelapi_id == null && r.fip_id != null)
    if (padelapi && fip) {
      duplicates.push({ padelapi, fip, key })
    }
  }

  console.log(`Found ${duplicates.length} cross-source duplicate groups\n`)
  if (duplicates.length === 0) {
    console.log('Nothing to merge. Exiting.')
    return
  }

  // Build the merge plan including FK redirect counts and external-ID handling
  console.log('=== Building merge plan ===\n')
  type ExternalIdAction =
    | { kind: 'redirect'; rowId: string; source: string; externalId: string }
    | { kind: 'drop'; rowId: string; source: string; externalId: string; reason: string }

  type PerPairPlan = {
    padelapiId: string
    fipId: string
    name: string
    year: string
    updates: Record<string, unknown>
    overrideEntryListStatus: boolean
    fkCounts: Record<string, number>
    extActions: ExternalIdAction[]
  }
  const plan: PerPairPlan[] = []

  for (const { padelapi, fip, key } of duplicates) {
    const updates: Record<string, unknown> = {}

    // Set fip_id on the surviving padelapi row. Prefer the new
    // `fip_id` column (Phase 1 canonical) and fall back to `fip_slug`
    // for older rows where only the legacy column is populated. We
    // intentionally avoid `external_id` here — it carries the
    // double-prefixed form that breaks downstream lookups.
    const fipKey = (fip.fip_id as string | null | undefined) ?? fip.fip_slug
    if (fipKey && !padelapi.fip_id) {
      updates.fip_id = fipKey
    }

    // FIP-primary fields: FIP wins when set.
    for (const field of FIP_PRIMARY_FIELDS) {
      const fipVal = fip[field]
      if (fipVal != null) updates[field] = fipVal
    }

    // FIP-only enrichments: copy when FIP has it. Padelapi keeps its
    // own value if the field is somehow set there (shouldn't happen
    // for these fields, but defensive).
    for (const field of FIP_ONLY_FIELDS) {
      const fipVal = fip[field]
      const padelVal = padelapi[field]
      if (fipVal != null && padelVal == null) {
        updates[field] = fipVal
      }
    }

    // entry_list_status: prefer FIP when padelapi's is 'not_applicable'.
    let overrideEntryListStatus = false
    if (
      padelapi.entry_list_status === 'not_applicable' &&
      fip.entry_list_status &&
      fip.entry_list_status !== 'not_applicable'
    ) {
      updates.entry_list_status = fip.entry_list_status
      overrideEntryListStatus = true
    }

    // FK reference counts (per pair, for visibility in the dry-run output)
    const fkCounts: Record<string, number> = {}
    for (const t of FK_TABLES) {
      const { count } = await fk(t)
        .select('*', { count: 'exact', head: true })
        .eq(t.col, fip.id)
      const label = `${t.schema ? t.schema + '.' : ''}${t.table}.${t.col}`
      fkCounts[label] = count ?? 0
    }

    // entity_external_ids — figure out per-row whether to redirect or drop
    const extActions: ExternalIdAction[] = []
    const { data: fipExt } = await supabase
      .from('entity_external_ids')
      .select('id, source, external_id')
      .eq('entity_type', 'tournament')
      .eq('entity_id', fip.id)
    if (fipExt && fipExt.length > 0) {
      const { data: padelExt } = await supabase
        .from('entity_external_ids')
        .select('source, external_id')
        .eq('entity_type', 'tournament')
        .eq('entity_id', padelapi.id)
      const survivorKeys = new Set(
        (padelExt ?? []).map(r => `${r.source}|${r.external_id}`),
      )
      for (const row of fipExt) {
        const k = `${row.source}|${row.external_id}`
        if (survivorKeys.has(k)) {
          extActions.push({
            kind: 'drop',
            rowId: row.id,
            source: row.source,
            externalId: row.external_id,
            reason: 'survivor already has this (source, external_id)',
          })
        } else {
          extActions.push({
            kind: 'redirect',
            rowId: row.id,
            source: row.source,
            externalId: row.external_id,
          })
        }
      }
    }

    plan.push({
      padelapiId: padelapi.id,
      fipId: fip.id,
      name: padelapi.name,
      year: key.split('|')[1],
      updates,
      overrideEntryListStatus,
      fkCounts,
      extActions,
    })
  }

  // Print the plan
  plan.forEach((p, i) => {
    console.log(`${i + 1}. ${p.name} (${p.year})`)
    console.log(`   keep:   ${p.padelapiId}`)
    console.log(`   delete: ${p.fipId}`)
    const fkSummary = Object.entries(p.fkCounts)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}=${n}`)
      .join(', ')
    console.log(`   FK redirects: ${fkSummary || '(none)'}`)
    if (p.extActions.length > 0) {
      console.log(`   external IDs:`)
      for (const a of p.extActions) {
        if (a.kind === 'redirect') {
          console.log(`     redirect ${a.source}=${a.externalId}`)
        } else {
          console.log(`     drop     ${a.source}=${a.externalId} (${a.reason})`)
        }
      }
    }
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
    console.log('[DRY RUN] No changes applied. Re-run with --apply to execute.\n')
    return
  }

  // Execute live
  console.log('=== Executing merges ===\n')
  let merged = 0
  let failed = 0
  for (const p of plan) {
    try {
      // 1. Redirect FK references on each table
      for (const t of FK_TABLES) {
        const label = `${t.schema ? t.schema + '.' : ''}${t.table}.${t.col}`
        if ((p.fkCounts[label] ?? 0) === 0) continue
        const { error: fkErr } = await fk(t)
          .update({ [t.col]: p.padelapiId })
          .eq(t.col, p.fipId)
        if (fkErr) {
          throw new Error(`${label} redirect failed — ${fkErr.message}`)
        }
      }

      // 2. Handle entity_external_ids — drop conflicts, redirect the rest
      for (const a of p.extActions) {
        if (a.kind === 'drop') {
          const { error: delExtErr } = await supabase
            .from('entity_external_ids')
            .delete()
            .eq('id', a.rowId)
          if (delExtErr) throw new Error(`drop external_id ${a.source}=${a.externalId} failed — ${delExtErr.message}`)
        } else {
          const { error: updExtErr } = await supabase
            .from('entity_external_ids')
            .update({ entity_id: p.padelapiId })
            .eq('id', a.rowId)
          if (updExtErr) throw new Error(`redirect external_id ${a.source}=${a.externalId} failed — ${updExtErr.message}`)
        }
      }

      // 3. Delete the FIP row to free up the fip_id slot for the survivor.
      //    All merge values were captured into `updates` in memory in step 1
      //    of plan-building, so we don't need the FIP row's data anymore.
      const { error: deleteErr } = await supabase
        .from('tournaments')
        .delete()
        .eq('id', p.fipId)
      if (deleteErr) throw new Error(`tournament delete failed — ${deleteErr.message}`)

      // 4. Update the padelapi survivor with the merged fields.
      if (Object.keys(p.updates).length > 0) {
        const { error: updateErr } = await supabase
          .from('tournaments')
          .update(p.updates)
          .eq('id', p.padelapiId)
        if (updateErr) {
          // FIP row is already deleted at this point. Log loudly so an
          // operator can re-apply the field updates manually.
          console.error(`  ✗ ${p.name} (${p.year}): survivor UPDATE failed AFTER FIP delete — ${updateErr.message}`)
          console.error(`    Survivor ${p.padelapiId} did NOT receive merge fields. Re-apply manually.`)
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

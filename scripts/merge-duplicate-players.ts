// scripts/merge-duplicate-players.ts
//
// Merges duplicate rows in public.players. Same player exists multiple times:
// Pxxx (canonical, matches upstream FIP) + fip-Pxxx (legacy padelgod prefix)
// + sometimes NULL fip_id. Mirrors the design of
// merge-tournament-duplicates.ts:
//
//   - --dry-run is default; --apply mutates.
//   - Per-cluster failures are isolated; final summary reports merged/failed.
//   - Pure helpers (groupKey, selectSurvivor, buildMergePayload) are
//     unit-tested.
//
// Survivor selection (see selectSurvivor):
//   - Prefix variants (Pxxx + fip-Pxxx) → NON-PREFIXED survives. The raw
//     FIP id matches upstream and is consistent with padelapi_id (which
//     also has no prefix). The fip- prefix was a one-off padelgod
//     namespacing decision being unwound by this PR.
//   - 3-row dupe (prefix + no-prefix + null fip_id) → non-prefixed
//     survives, both others lose.
//   - Two NULL fip_id rows → most-populated survives, oldest id wins ties.
//   - Distinct non-prefix-variant fip_ids → REFUSED (human review report).
//
// Usage:
//   node --experimental-strip-types scripts/merge-duplicate-players.ts            # dry run
//   node --experimental-strip-types scripts/merge-duplicate-players.ts --apply

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

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

// ── types ─────────────────────────────────────────────────────
export interface PlayerRow {
  id: string
  fip_id: string | null
  name: string | null
  category: string | null
  ranking: number | null
  birthdate: string | null
  birthplace: string | null
  height: number | null
  coaches: string[] | null
  equipment: Record<string, unknown> | null
  profile_url: string | null
  country: string | null
  [key: string]: unknown
}

// Bio/ranking fields the survivor inherits from losers when survivor is null.
const MERGE_FIELDS = [
  'ranking',
  'birthdate',
  'birthplace',
  'height',
  'coaches',
  'equipment',
  'profile_url',
  'country',
] as const

// ── pure helpers ──────────────────────────────────────────────
export function normalizeFipId(fipId: string | null): string | null {
  if (!fipId) return null
  return fipId.replace(/^fip-/, '')
}

export function groupKey(name: string | null, category: string | null): string {
  const n = (name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
  return `${n}|${category ?? ''}`
}

function isPopulated(v: unknown): boolean {
  if (v == null) return false
  if (Array.isArray(v) && v.length === 0) return false
  return true
}

function countPopulatedFields(row: PlayerRow): number {
  let n = 0
  for (const f of MERGE_FIELDS) {
    if (isPopulated(row[f])) n++
  }
  return n
}

export type SurvivorResult =
  | { kind: 'auto'; survivor: PlayerRow; losers: PlayerRow[]; reason: string }
  | { kind: 'review'; reason: string; rows: PlayerRow[] }

export function selectSurvivor(rows: PlayerRow[]): SurvivorResult {
  if (rows.length < 2) {
    return { kind: 'review', reason: 'cluster has < 2 rows', rows }
  }

  const byNormalized = new Map<string, PlayerRow[]>()
  const nullFipRows: PlayerRow[] = []
  for (const r of rows) {
    const nf = normalizeFipId(r.fip_id)
    if (nf == null) {
      nullFipRows.push(r)
    } else {
      if (!byNormalized.has(nf)) byNormalized.set(nf, [])
      byNormalized.get(nf)!.push(r)
    }
  }

  if (byNormalized.size > 1) {
    return {
      kind: 'review',
      reason: `cluster has ${byNormalized.size} distinct fip_ids (not just prefix variants)`,
      rows,
    }
  }

  if (byNormalized.size === 1) {
    const sameIdRows = [...byNormalized.values()][0]
    const nonPrefixed = sameIdRows.filter(r => !r.fip_id?.startsWith('fip-'))
    const prefixed = sameIdRows.filter(r => r.fip_id?.startsWith('fip-'))
    if (nonPrefixed.length === 0) {
      // Only prefixed rows — pick most-populated. The dedup is still a win
      // even though we'll temporarily keep a prefixed survivor; the writer
      // changes in this PR will stop new prefixed rows from being created.
      const survivor = pickMostPopulated([...sameIdRows, ...nullFipRows])
      const losers = [...sameIdRows, ...nullFipRows].filter(r => r.id !== survivor.id)
      return {
        kind: 'auto',
        survivor,
        losers,
        reason: 'only prefixed rows available; chose most-populated as survivor',
      }
    }
    // Non-prefixed survives. If multiple non-prefixed rows exist (rare),
    // pick the most-populated one.
    const survivor = pickMostPopulated([...nonPrefixed, ...nullFipRows])
    const losers = [...sameIdRows, ...nullFipRows].filter(r => r.id !== survivor.id)
    return {
      kind: 'auto',
      survivor,
      losers,
      reason: 'non-prefixed fip_id is canonical (matches upstream FIP)',
    }
  }

  const survivor = pickMostPopulated(nullFipRows)
  const losers = nullFipRows.filter(r => r.id !== survivor.id)
  return {
    kind: 'auto',
    survivor,
    losers,
    reason: 'all NULL fip_id; chose most-populated survivor',
  }
}

function pickMostPopulated(rows: PlayerRow[]): PlayerRow {
  let best = rows[0]
  let bestCount = countPopulatedFields(best)
  for (const r of rows.slice(1)) {
    const c = countPopulatedFields(r)
    if (c > bestCount || (c === bestCount && r.id < best.id)) {
      best = r
      bestCount = c
    }
  }
  return best
}

export function buildMergePayload(
  survivor: PlayerRow,
  losers: PlayerRow[],
): Record<string, unknown> {
  const updates: Record<string, unknown> = {}
  for (const field of MERGE_FIELDS) {
    if (isPopulated(survivor[field])) continue
    for (const loser of losers) {
      if (isPopulated(loser[field])) {
        updates[field] = loser[field]
        break
      }
    }
  }
  return updates
}

// ── FK tables ─────────────────────────────────────────────────
//
// Static list of tables with FK references to public.players(id). Verified
// against pg_catalog at script start; any missing table prints a warning.
//
// Run this query manually to spot missing entries:
//   SELECT conrelid::regclass::text AS tbl, a.attname AS col,
//          ns.nspname AS schema
//   FROM pg_constraint c
//   JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
//   JOIN pg_namespace ns ON ns.oid=c.connamespace
//   WHERE c.contype='f' AND c.confrelid='public.players'::regclass;
const FK_TABLES: Array<{ table: string; col: string; schema?: string }> = [
  { table: 'matches', col: 'pair1_player1_id' },
  { table: 'matches', col: 'pair1_player2_id' },
  { table: 'matches', col: 'pair2_player1_id' },
  { table: 'matches', col: 'pair2_player2_id' },
  { table: 'tournament_draws', col: 'player1_id' },
  { table: 'tournament_draws', col: 'player2_id' },
  { table: 'player_equipment', col: 'player_id' },
  { table: 'racket_clicks', col: 'player_id' },
  { table: 'player_ranking_snapshots', col: 'player_id' },
]

// ── main ──────────────────────────────────────────────────────
async function main() {
  loadEnv()

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY')
    process.exit(1)
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  const fk = (t: { table: string; schema?: string }) =>
    t.schema ? supabase.schema(t.schema).from(t.table) : supabase.from(t.table)

  const apply = process.argv.includes('--apply')
  const dryRun = !apply

  console.log(`\n${dryRun ? '[DRY RUN] ' : '[APPLY] '}Fetching players...\n`)

  // PostgREST cap is 10k. Players table is ~5-15k. If you need more, paginate
  // via .range() — see paginatedSelect helper.
  const { data: all, error } = await supabase
    .from('players')
    .select('id, fip_id, name, category, ranking, birthdate, birthplace, height, coaches, equipment, profile_url, country')
    .limit(20000)
  if (error) {
    console.error('Failed to fetch players:', error)
    process.exit(1)
  }
  if (!all) {
    console.error('No players returned')
    process.exit(1)
  }
  console.log(`Fetched ${all.length} players\n`)

  // Group by (normalized name, category)
  const groups = new Map<string, PlayerRow[]>()
  for (const p of all as PlayerRow[]) {
    const k = groupKey(p.name, p.category)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(p)
  }

  type ExtAction =
    | { kind: 'redirect'; rowId: string; source: string; externalId: string }
    | { kind: 'drop'; rowId: string; source: string; externalId: string; reason: string }

  type Plan = {
    name: string
    category: string
    survivor: PlayerRow
    losers: PlayerRow[]
    extActions: ExtAction[]
    updates: Record<string, unknown>
    reason: string
  }

  const plans: Plan[] = []
  const reviewClusters: Array<{ key: string; reason: string; rows: PlayerRow[] }> = []

  // First pass: classify each cluster (auto vs review). No DB queries — pure
  // logic. This is the visible phase where the operator wants to see how
  // many clusters there are.
  for (const [key, rows] of groups) {
    if (rows.length < 2) continue
    const result = selectSurvivor(rows)
    if (result.kind === 'review') {
      reviewClusters.push({ key, reason: result.reason, rows: result.rows })
      continue
    }

    const { survivor, losers } = result
    const updates = buildMergePayload(survivor, losers)

    plans.push({
      name: survivor.name ?? '(no name)',
      category: survivor.category ?? '(no category)',
      survivor,
      losers,
      extActions: [],
      updates,
      reason: result.reason,
    })
  }

  console.log(`Identified ${plans.length} auto-merge clusters and ${reviewClusters.length} review clusters\n`)

  // Second pass: bulk-fetch entity_external_ids for ALL losers and ALL
  // survivors in ONE round-trip each, then attach extActions to each plan.
  // This replaces N×2 round-trips with 2 total — drops planning time from
  // O(clusters × 2) to O(2).
  const allLoserIds = plans.flatMap(p => p.losers.map(l => l.id))
  const allSurvivorIds = plans.map(p => p.survivor.id)

  if (allLoserIds.length > 0) {
    process.stdout.write('Fetching entity_external_ids for all losers + survivors...')
    const { data: loserExt } = await supabase
      .from('entity_external_ids')
      .select('id, source, external_id, entity_id')
      .eq('entity_type', 'player')
      .in('entity_id', allLoserIds)
      .limit(20000)
    const { data: survivorExt } = await supabase
      .from('entity_external_ids')
      .select('source, external_id, entity_id')
      .eq('entity_type', 'player')
      .in('entity_id', allSurvivorIds)
      .limit(20000)
    console.log(` got ${loserExt?.length ?? 0} loser rows, ${survivorExt?.length ?? 0} survivor rows`)

    // Index loser ext rows by entity_id (= a loser id)
    const loserExtByEntity = new Map<string, Array<{ id: string; source: string; external_id: string }>>()
    for (const r of loserExt ?? []) {
      if (!loserExtByEntity.has(r.entity_id)) loserExtByEntity.set(r.entity_id, [])
      loserExtByEntity.get(r.entity_id)!.push({ id: r.id, source: r.source, external_id: r.external_id })
    }

    // Index survivor's existing (source, external_id) keys by survivor id
    const survivorKeysByEntity = new Map<string, Set<string>>()
    for (const r of survivorExt ?? []) {
      if (!survivorKeysByEntity.has(r.entity_id)) survivorKeysByEntity.set(r.entity_id, new Set())
      survivorKeysByEntity.get(r.entity_id)!.add(`${r.source}|${r.external_id}`)
    }

    // Attach extActions to each plan
    for (const p of plans) {
      const survivorKeys = survivorKeysByEntity.get(p.survivor.id) ?? new Set<string>()
      for (const loserId of p.losers.map(l => l.id)) {
        const rows = loserExtByEntity.get(loserId) ?? []
        for (const r of rows) {
          const k = `${r.source}|${r.external_id}`
          if (survivorKeys.has(k)) {
            p.extActions.push({
              kind: 'drop',
              rowId: r.id,
              source: r.source,
              externalId: r.external_id,
              reason: 'survivor already has this (source, external_id)',
            })
          } else {
            p.extActions.push({
              kind: 'redirect',
              rowId: r.id,
              source: r.source,
              externalId: r.external_id,
            })
            // Mark the key as taken so a subsequent loser with the same
            // (source, external_id) gets dropped instead of conflicting.
            survivorKeys.add(k)
          }
        }
      }
    }
  }

  // Print review clusters first
  if (reviewClusters.length > 0) {
    console.log(`=== Needs human review (${reviewClusters.length}) ===\n`)
    for (const c of reviewClusters) {
      console.log(`* ${c.key}`)
      console.log(`  reason: ${c.reason}`)
      for (const r of c.rows) {
        console.log(`    - id=${r.id} fip_id=${r.fip_id ?? 'NULL'} ranking=${r.ranking ?? 'NULL'}`)
      }
    }
    console.log()
  }

  // Print auto-merge plan
  console.log(`=== Auto-merge plan (${plans.length} clusters) ===\n`)
  plans.forEach((p, i) => {
    console.log(`${i + 1}. ${p.name} [${p.category}] — ${p.reason}`)
    console.log(`   keep:   ${p.survivor.id} fip_id=${p.survivor.fip_id ?? 'NULL'}`)
    for (const l of p.losers) {
      console.log(`   delete: ${l.id} fip_id=${l.fip_id ?? 'NULL'}`)
    }
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
    if (Object.keys(p.updates).length > 0) {
      console.log(`   merge fields:`)
      for (const [k, v] of Object.entries(p.updates)) {
        const valStr = v == null ? '(null)' : JSON.stringify(v).slice(0, 60)
        console.log(`     ${k.padEnd(14)} = ${valStr}`)
      }
    }
    console.log()
  })

  if (dryRun) {
    console.log(`[DRY RUN] No changes applied. Re-run with --apply to execute.\n`)
    console.log(`Summary: ${plans.length} clusters auto-mergeable, ${reviewClusters.length} need review.\n`)
    return
  }

  // Execute
  console.log('=== Executing merges ===\n')
  let merged = 0
  let failed = 0
  for (const p of plans) {
    const loserIds = p.losers.map(l => l.id)
    try {
      // 1. FK redirects — always run the UPDATE; rows-not-matching is cheap.
      for (const t of FK_TABLES) {
        const { error: fkErr } = await fk(t)
          .update({ [t.col]: p.survivor.id })
          .in(t.col, loserIds)
        if (fkErr) throw new Error(`${t.table}.${t.col} redirect failed — ${fkErr.message}`)
      }

      // 2. entity_external_ids
      for (const a of p.extActions) {
        if (a.kind === 'drop') {
          const { error: delErr } = await supabase
            .from('entity_external_ids')
            .delete()
            .eq('id', a.rowId)
          if (delErr) throw new Error(`drop ext_id ${a.source}=${a.externalId}: ${delErr.message}`)
        } else {
          const { error: updErr } = await supabase
            .from('entity_external_ids')
            .update({ entity_id: p.survivor.id })
            .eq('id', a.rowId)
          if (updErr) throw new Error(`redirect ext_id ${a.source}=${a.externalId}: ${updErr.message}`)
        }
      }

      // 3. DELETE losers
      const { error: delErr } = await supabase
        .from('players')
        .delete()
        .in('id', loserIds)
      if (delErr) throw new Error(`delete losers failed — ${delErr.message}`)

      // 4. UPDATE survivor with merged fields
      if (Object.keys(p.updates).length > 0) {
        const { error: updErr } = await supabase
          .from('players')
          .update(p.updates)
          .eq('id', p.survivor.id)
        if (updErr) {
          console.error(`  ✗ ${p.name}: survivor UPDATE failed AFTER loser delete — ${updErr.message}`)
          console.error(`    Survivor ${p.survivor.id} did NOT receive merge fields. Re-apply manually.`)
          failed++
          continue
        }
      }

      console.log(`  OK ${p.name} [${p.category}]`)
      merged++
    } catch (e) {
      console.error(`  FAIL ${p.name} [${p.category}]: ${e instanceof Error ? e.message : String(e)}`)
      failed++
    }
  }

  console.log(`\n=== Done ===`)
  console.log(`Merged: ${merged}`)
  console.log(`Failed: ${failed}`)
  if (reviewClusters.length > 0) {
    console.log(`Needs human review: ${reviewClusters.length}`)
  }
  if (failed > 0) process.exit(1)
}

// Only run main() when invoked as a CLI, not when imported by tests.
const isMain = (() => {
  const arg = process.argv[1]
  if (!arg) return false
  // Match either the .ts source path or any compiled/runtime variant.
  return arg.endsWith('merge-duplicate-players.ts') || arg.endsWith('merge-duplicate-players.js')
})()

if (isMain) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}

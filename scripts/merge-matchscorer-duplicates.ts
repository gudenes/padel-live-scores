// scripts/merge-matchscorer-duplicates.ts
//
// Merges tournament rows that share a matchscorer_url. The matchscorer
// code is the authoritative identity of a physical event — Crionet
// hosts ONE bracket per code, so two rows carrying the same code are
// by definition the same physical tournament.
//
// Distinct from `merge-tournament-duplicates.ts`:
//   - That script groups by normalized name + year (catches cross-source
//     padelapi+FIP pairs where the names agree under tokenization).
//   - THIS script groups by matchscorer_url (catches pairs where the
//     names DIFFER but the matchscorer code matches — e.g. sponsor
//     rebranded variants, full rebrands, anything the discovery-worker
//     `isPhysicalTwin` guard couldn't catch).
//
// Survivor selection per group (first criterion that breaks the tie wins):
//   1. Row with padelapi_id != null (cross-source canonical anchor)
//   2. Row with a padelgod.widget_id_cache mapping (Crionet anchor)
//   3. Row with more matches
//   4. Row with more tournament_draws
//   5. Oldest created_at (likely the first one discovered)
//
// Per pair operations:
//   1. Redirect FK references on all FK tables. For tables with
//      UNIQUE(tournament_id) (widget_id_cache), drop the loser's row
//      if the survivor already has one — otherwise the redirect would
//      conflict.
//   2. entity_external_ids: drop conflicts, redirect the rest.
//   3. Gap-fill the survivor from the loser for fields where the
//      survivor is null but the loser has data (fip_id, matchscorer_url,
//      logo_url, draw_size_md, draw_size_qd, prize_money_fip, etc.).
//   4. Delete the loser tournament row.
//
// Usage:
//   node --experimental-strip-types scripts/merge-matchscorer-duplicates.ts                    # dry-run
//   node --experimental-strip-types scripts/merge-matchscorer-duplicates.ts --apply            # actually write
//   node --experimental-strip-types scripts/merge-matchscorer-duplicates.ts --code FIP-2026-1601 --apply
//
// Safe defaults: dry-run unless --apply is explicit; per-pair failures
// are logged but don't halt the run.

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

// ── env loader ─────────────────────────────────────────────────
function loadEnv() {
  let dir = process.cwd()
  for (let i = 0; i < 6; i++) {
    const p = path.join(dir, '.env.local')
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq === -1) continue
        const key = trimmed.slice(0, eq).trim()
        const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
        if (!process.env[key]) process.env[key] = value
      }
      return p
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}
const envPath = loadEnv()
if (!envPath) {
  console.error('Could not find .env.local')
  process.exit(1)
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// FK tables that reference public.tournaments. Same list as the
// name-based merge script — kept in sync so a new FK doesn't get
// missed on either path.
//
//   - `unique: true` — UNIQUE(tournament_id) only. If both rows have a
//     row in this table, the loser's row is DROPPED instead of
//     redirected (constraint would fire on UPDATE).
//   - `compositeUnique: [...]` — UNIQUE(tournament_id, …other cols).
//     Per loser row, we check whether survivor has a row matching on
//     the OTHER cols of the unique key. Conflicts are DROPPED; the
//     rest are REDIRECTED.
const FK_TABLES: Array<{
  table: string
  col: string
  schema?: string
  unique?: boolean
  compositeUnique?: readonly string[]
}> = [
  { table: 'matches', col: 'tournament_id' },
  // UNIQUE(tournament_id, category, draw_position) — drop loser rows
  // whose (category, draw_position) collides with a survivor row.
  { table: 'tournament_draws', col: 'tournament_id', compositeUnique: ['category', 'draw_position'] },
  // PRIMARY KEY (tournament_id, court_name). ON DELETE CASCADE on the
  // FK, but we still want to redirect to preserve any unique court
  // metadata the loser had (display_order).
  { table: 'tournament_courts', col: 'tournament_id', compositeUnique: ['court_name'] },
  // UNIQUE (player_id, tournament_id, category). FK has no ON DELETE
  // clause → RESTRICT, so we MUST redirect or drop before tournament
  // delete.
  {
    table: 'player_tournament_earnings',
    col: 'tournament_id',
    compositeUnique: ['player_id', 'category'],
  },
  // ON DELETE CASCADE; FK col is `tournament_id` (no composite).
  { table: 'fip_court_streams', col: 'tournament_id' },
  // FK col is `resolved_tournament_id`; nullable, no ON DELETE clause →
  // RESTRICT. Has to be redirected.
  { table: 'fip_streams_unresolved', col: 'resolved_tournament_id' },
  { table: 'highlights', col: 'tournament_id' },
  { table: 'match_stats_unresolved', col: 'resolved_tournament_id' },
  { table: 'scrape_jobs', col: 'tournament_id', schema: 'padelgod' },
  // UNIQUE(tournament_id, widget_short_name, partner_short_name).
  {
    table: 'unresolved_players',
    col: 'tournament_id',
    schema: 'padelgod',
    compositeUnique: ['widget_short_name', 'partner_short_name'],
  },
  { table: 'unresolved_matches', col: 'tournament_id', schema: 'padelgod' },
  { table: 'shadow_diff', col: 'tournament_id', schema: 'padelgod' },
  { table: 'draw_snapshots', col: 'tournament_id', schema: 'padelgod' },
  { table: 'results_snapshots', col: 'tournament_id', schema: 'padelgod' },
  { table: 'oop_snapshots', col: 'tournament_id', schema: 'padelgod' },
  { table: 'entry_list_snapshots', col: 'tournament_id', schema: 'padelgod' },
  // tournament_id is PRIMARY KEY (UNIQUE) on widget_id_cache.
  { table: 'widget_id_cache', col: 'tournament_id', schema: 'padelgod', unique: true },
]

function fk(t: { table: string; schema?: string }) {
  return t.schema ? supabase.schema(t.schema).from(t.table) : supabase.from(t.table)
}

// Field gap-fills carried from loser to survivor. Survivor keeps any
// non-null value it already has — these are only written when survivor
// is null and loser has data. Padelapi-primary fields (name, country,
// level) are NOT in this list; the survivor's value wins.
const GAP_FILL_FIELDS = [
  'fip_id',
  'fip_slug',
  'matchscorer_url',
  'logo_url',
  'cover_image_url',
  'venue',
  'venue_address',
  'venue_type',
  'signup_fee_eur',
  'schedule_notes',
  'round_schedule',
  'draw_size_md',
  'draw_size_qd',
  'prize_money_fip',
  'prize_breakdown',
  'registration_status',
  'url',
] as const

interface TournamentRow {
  id: string
  name: string
  slug: string | null
  source: string | null
  padelapi_id: string | null
  fip_id: string | null
  level: string | null
  country: string | null
  matchscorer_url: string | null
  starts_at: string | null
  ends_at: string | null
  created_at: string | null
  [key: string]: unknown
}

interface PairCounts {
  matches: number
  tournamentDraws: number
  widgetIdCache: number
}

async function fkCount(t: { table: string; col: string; schema?: string }, tournamentId: string): Promise<number> {
  const { count } = await fk(t).select('*', { count: 'exact', head: true }).eq(t.col, tournamentId)
  return count ?? 0
}

async function gatherPairCounts(t: TournamentRow): Promise<PairCounts> {
  const [matches, draws, cache] = await Promise.all([
    fkCount({ table: 'matches', col: 'tournament_id' }, t.id),
    fkCount({ table: 'tournament_draws', col: 'tournament_id' }, t.id),
    fkCount({ table: 'widget_id_cache', col: 'tournament_id', schema: 'padelgod' }, t.id),
  ])
  return { matches, tournamentDraws: draws, widgetIdCache: cache }
}

// Returns the row that should survive the merge. Documented order:
//   1. padelapi_id != null
//   2. widget_id_cache row present
//   3. more matches
//   4. more tournament_draws
//   5. oldest created_at
function pickSurvivor(
  rows: Array<{ row: TournamentRow; counts: PairCounts }>,
): { survivor: TournamentRow; reason: string } {
  // 1. padelapi_id
  const withPadelapi = rows.filter(({ row }) => row.padelapi_id != null)
  if (withPadelapi.length === 1) {
    return { survivor: withPadelapi[0]!.row, reason: 'has padelapi_id' }
  }
  const pool = withPadelapi.length >= 1 ? withPadelapi : rows

  // 2. widget_id_cache present
  const withCache = pool.filter(({ counts }) => counts.widgetIdCache > 0)
  if (withCache.length === 1) {
    return { survivor: withCache[0]!.row, reason: 'has widget_id_cache mapping' }
  }
  const pool2 = withCache.length >= 1 ? withCache : pool

  // 3. more matches
  pool2.sort((a, b) => b.counts.matches - a.counts.matches)
  if (pool2[0]!.counts.matches > (pool2[1]?.counts.matches ?? -1)) {
    return { survivor: pool2[0]!.row, reason: `most matches (${pool2[0]!.counts.matches})` }
  }

  // 4. more tournament_draws
  pool2.sort((a, b) => b.counts.tournamentDraws - a.counts.tournamentDraws)
  if (pool2[0]!.counts.tournamentDraws > (pool2[1]?.counts.tournamentDraws ?? -1)) {
    return {
      survivor: pool2[0]!.row,
      reason: `most tournament_draws (${pool2[0]!.counts.tournamentDraws})`,
    }
  }

  // 5. oldest created_at
  pool2.sort((a, b) => {
    const ax = a.row.created_at ?? ''
    const bx = b.row.created_at ?? ''
    return ax.localeCompare(bx)
  })
  return { survivor: pool2[0]!.row, reason: `oldest created_at (${pool2[0]!.row.created_at})` }
}

type ExternalIdAction =
  | { kind: 'redirect'; rowId: string; source: string; externalId: string }
  | { kind: 'drop'; rowId: string; source: string; externalId: string; reason: string }

interface PerPairPlan {
  code: string
  survivorId: string
  survivorName: string
  loserId: string
  loserName: string
  survivorReason: string
  fkCounts: Record<string, number>
  fkUniqueConflicts: Array<{ label: string; loserRowId: string }>
  extActions: ExternalIdAction[]
  gapFills: Record<string, unknown>
}

async function buildPlan(
  code: string,
  survivor: TournamentRow,
  loser: TournamentRow,
  survivorReason: string,
): Promise<PerPairPlan> {
  // FK counts for the loser (these will be redirected)
  const fkCounts: Record<string, number> = {}
  const fkUniqueConflicts: Array<{ label: string; loserRowId: string }> = []
  for (const t of FK_TABLES) {
    const label = `${t.schema ? t.schema + '.' : ''}${t.table}.${t.col}`
    const count = await fkCount(t, loser.id)
    fkCounts[label] = count
    if (count === 0) continue

    if (t.unique) {
      // UNIQUE(tournament_id) — drop loser's row if survivor has one.
      const { count: survCount } = await fk(t)
        .select('*', { count: 'exact', head: true })
        .eq(t.col, survivor.id)
      if ((survCount ?? 0) > 0) {
        const { data: loserRows } = await fk(t).select('*').eq(t.col, loser.id).limit(1)
        const loserRow = (loserRows ?? [])[0] as { id?: string } | undefined
        if (loserRow?.id) {
          fkUniqueConflicts.push({ label, loserRowId: loserRow.id })
        }
      }
    } else if (t.compositeUnique && t.compositeUnique.length > 0) {
      // UNIQUE(tournament_id, …other). For each loser row, check
      // whether survivor already has a row matching on the OTHER cols
      // of the unique constraint. Conflict → drop. Non-conflict →
      // redirect (handled later in the live-execute path).
      const cols = t.compositeUnique
      const selectCols = ['id', ...cols].join(', ')
      const { data: loserRows } = await fk(t).select(selectCols).eq(t.col, loser.id)
      for (const lr of (loserRows ?? []) as Array<Record<string, unknown>>) {
        // Look up survivor side with the same other-col values.
        let probe = fk(t).select('id', { head: true, count: 'exact' }).eq(t.col, survivor.id)
        for (const c of cols) {
          const v = lr[c]
          // PostgREST treats `.eq(col, null)` as `col = null` (always
          // false) instead of `col IS NULL`. Use `.is()` for nulls so
          // the conflict detection actually fires when both sides have
          // a NULL in the constrained column.
          probe = v === null ? probe.is(c, null) : probe.eq(c, v as never)
        }
        const { count: collisionCount } = await probe
        if ((collisionCount ?? 0) > 0) {
          fkUniqueConflicts.push({ label, loserRowId: String(lr.id) })
        }
      }
    }
  }

  // entity_external_ids handling — same pattern as the name-based merge script
  const extActions: ExternalIdAction[] = []
  const { data: loserExt } = await supabase
    .from('entity_external_ids')
    .select('id, source, external_id')
    .eq('entity_type', 'tournament')
    .eq('entity_id', loser.id)
  if (loserExt && loserExt.length > 0) {
    const { data: survivorExt } = await supabase
      .from('entity_external_ids')
      .select('source, external_id')
      .eq('entity_type', 'tournament')
      .eq('entity_id', survivor.id)
    const survivorKeys = new Set((survivorExt ?? []).map((r) => `${r.source}|${r.external_id}`))
    for (const row of loserExt) {
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

  // Gap-fill fields: copy loser's value if survivor's is null
  const gapFills: Record<string, unknown> = {}
  for (const f of GAP_FILL_FIELDS) {
    const surv = survivor[f]
    const lose = loser[f]
    if ((surv == null || surv === '') && lose != null && lose !== '') {
      gapFills[f] = lose
    }
  }

  return {
    code,
    survivorId: survivor.id,
    survivorName: survivor.name,
    loserId: loser.id,
    loserName: loser.name,
    survivorReason,
    fkCounts,
    fkUniqueConflicts,
    extActions,
    gapFills,
  }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const dryRun = !apply

  // Optional --code filter
  const codeIdx = process.argv.indexOf('--code')
  const codeFilter = codeIdx !== -1 ? process.argv[codeIdx + 1] : null

  console.log(`\n${dryRun ? '[DRY RUN] ' : '[APPLY] '}Loading tournaments with matchscorer_url${codeFilter ? ` = ${codeFilter}` : ''}…\n`)

  let q = supabase
    .from('tournaments')
    .select('*')
    .not('matchscorer_url', 'is', null)
  if (codeFilter) q = q.eq('matchscorer_url', codeFilter)

  const { data: all, error } = await q
  if (error) {
    console.error('Fetch failed:', error)
    process.exit(1)
  }

  // Group by matchscorer_url
  const groups = new Map<string, TournamentRow[]>()
  for (const r of (all ?? []) as TournamentRow[]) {
    const k = r.matchscorer_url as string
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(r)
  }

  const dupes = [...groups.entries()].filter(([, rows]) => rows.length > 1)
  console.log(`Found ${dupes.length} matchscorer_url codes with >1 tournament\n`)
  if (dupes.length === 0) {
    console.log('Nothing to merge. Exiting.')
    return
  }

  // Build plan per pair
  const plan: PerPairPlan[] = []
  for (const [code, rows] of dupes) {
    if (rows.length > 2) {
      console.warn(
        `WARN: matchscorer_url=${code} has ${rows.length} rows (>2). Script merges loser→survivor pairwise; ` +
          `additional rows will need a follow-up run.`,
      )
    }
    // Gather counts for all rows in the group
    const withCounts: Array<{ row: TournamentRow; counts: PairCounts }> = []
    for (const r of rows) {
      const counts = await gatherPairCounts(r)
      withCounts.push({ row: r, counts })
    }
    const { survivor, reason } = pickSurvivor(withCounts)
    // For each non-survivor, build a merge plan against the survivor
    for (const { row: loser } of withCounts) {
      if (loser.id === survivor.id) continue
      plan.push(await buildPlan(code, survivor, loser, reason))
    }
  }

  // Print plan
  plan.forEach((p, i) => {
    console.log(`${i + 1}. matchscorer_url=${p.code}`)
    console.log(`   survivor (kept):   ${p.survivorId}  ${p.survivorName}`)
    console.log(`   reason:            ${p.survivorReason}`)
    console.log(`   loser (deleted):   ${p.loserId}  ${p.loserName}`)
    const fkSummary = Object.entries(p.fkCounts)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}=${n}`)
      .join(', ')
    console.log(`   FK to redirect:    ${fkSummary || '(none)'}`)
    if (p.fkUniqueConflicts.length > 0) {
      console.log(`   FK unique conflicts (loser row will be DROPPED instead of redirected):`)
      for (const c of p.fkUniqueConflicts) {
        console.log(`     ${c.label}  loser_row_id=${c.loserRowId}`)
      }
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
    if (Object.keys(p.gapFills).length > 0) {
      console.log(`   gap-fill on survivor:`)
      for (const [k, v] of Object.entries(p.gapFills)) {
        const valStr = JSON.stringify(v).slice(0, 60)
        console.log(`     ${k.padEnd(22)} = ${valStr}`)
      }
    } else {
      console.log(`   gap-fill on survivor: (none — survivor already has every field)`)
    }
    console.log()
  })

  if (dryRun) {
    console.log('[DRY RUN] No changes applied. Re-run with --apply to execute.\n')
    return
  }

  // Execute live, per pair
  console.log('=== Executing merges ===\n')
  let merged = 0
  let failed = 0

  for (const p of plan) {
    try {
      // 1. Redirect FK references. For UNIQUE / composite-UNIQUE
      //    tables, drop the loser rows that would conflict with the
      //    survivor's existing rows on the unique key before the
      //    redirect UPDATE fires.
      for (const t of FK_TABLES) {
        const label = `${t.schema ? t.schema + '.' : ''}${t.table}.${t.col}`
        if ((p.fkCounts[label] ?? 0) === 0) continue
        // Drop every conflict row identified during plan-building.
        const conflicts = p.fkUniqueConflicts.filter((c) => c.label === label)
        for (const c of conflicts) {
          const { error: dropErr } = await fk(t).delete().eq('id', c.loserRowId)
          if (dropErr) throw new Error(`${label} drop conflict failed — ${dropErr.message}`)
        }
        // Redirect everything still pointing at the loser.
        const { error: fkErr } = await fk(t).update({ [t.col]: p.survivorId }).eq(t.col, p.loserId)
        if (fkErr) throw new Error(`${label} redirect failed — ${fkErr.message}`)
      }

      // 2. entity_external_ids
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
            .update({ entity_id: p.survivorId })
            .eq('id', a.rowId)
          if (updExtErr) throw new Error(`redirect external_id ${a.source}=${a.externalId} failed — ${updExtErr.message}`)
        }
      }

      // 3. Delete loser tournament row to free the slug + fip_id slots.
      //    Do this BEFORE gap-filling the survivor, so any UNIQUE
      //    constraint on `slug` / `fip_id` doesn't fire if the gap-fill
      //    writes a value the loser still holds.
      const { error: deleteErr } = await supabase
        .from('tournaments')
        .delete()
        .eq('id', p.loserId)
      if (deleteErr) throw new Error(`tournament delete failed — ${deleteErr.message}`)

      // 4. Gap-fill survivor.
      if (Object.keys(p.gapFills).length > 0) {
        const { error: updateErr } = await supabase
          .from('tournaments')
          .update(p.gapFills)
          .eq('id', p.survivorId)
        if (updateErr) {
          console.error(
            `  ! ${p.code}: survivor gap-fill UPDATE failed AFTER loser delete — ${updateErr.message}`,
          )
          console.error(`    Survivor ${p.survivorId} did NOT receive gap fields. Re-apply manually.`)
          failed++
          continue
        }
      }

      console.log(`  ok ${p.code}  ${p.survivorName}  <-  ${p.loserName}`)
      merged++
    } catch (e) {
      console.error(`  X ${p.code}: ${e instanceof Error ? e.message : String(e)}`)
      failed++
    }
  }

  console.log(`\n=== Done ===\nMerged: ${merged}\nFailed: ${failed}`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

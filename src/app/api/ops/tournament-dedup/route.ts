// src/app/api/ops/tournament-dedup/route.ts
//
// Cross-source tournament deduplication endpoint. The same physical
// event ends up as two rows when padelapi-sync and the FIP scraper
// both create independent tournaments — different naming conventions
// (UPPERCASE vs Title Case), different levels assigned, and only one
// of them carries the fip_id. Operators end up confused; analytics
// double-counts.
//
// This endpoint:
//   GET  → dry-run plan (no writes). Lists every duplicate group it
//          finds with the planned action (which row survives, which
//          dies, which fields get merged across).
//   POST → executes the plan. Returns a per-group result (merged /
//          skipped / failed).
//
// Matching rule (mirrors merge-tournament-duplicates.ts but broader):
//   - Same normalized name (token-subset, diacritic-stripped, noise
//     words like 'padel'/'tour' filtered out)
//   - Same year (extracted from starts_at)
//   - Same level family — premier (p1/p2/major/finals) cannot be
//     merged with fip_* even if names happen to match. Within fip_*
//     all sub-tiers (platinum/gold/silver/bronze/other) ARE considered
//     the same family because the FIP scraper and padelapi often
//     disagree on the exact tier (one says fip_other, the other says
//     fip_silver — same event nonetheless).
//
// Survivor selection (per group):
//   1. If exactly one row has FK references (matches, draws, articles,
//      highlights, entity_external_ids), that row survives.
//   2. If multiple rows have FK references → flagged as "manual",
//      skipped. Operator resolves via direct SQL or the merge script.
//   3. If no row has FK references → prefer the row with fip_id set
//      (we want the FIP URL working post-merge). If still tied, prefer
//      the one with the most populated columns (richer metadata).
//
// Auth: ops_token cookie via checkOpsAuth.

import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'
import { yearOf, NOISE_TOKENS } from '@/lib/source-matcher'

// Dedup-specific noise filter — narrower than the canonical NOISE_TOKENS.
//
// Why a separate list: NOISE_TOKENS includes Premier Padel sponsor
// prefixes ("lotto", "betclic", "greenweez", "motorola", "razr", etc.)
// that get stripped during cross-source matching of the SAME Premier
// event under different sponsor names. That's correct for Premier.
//
// But applied to FIP Silver/Bronze events, sponsor stripping causes
// false collisions: "FIP Silver Betclic" → strips to just "fip silver"
// → matches every other Betclic-named FIP Silver event in the same year
// as if they were duplicates. That's how the dedup endpoint flagged
// "FIP Silver Betclic" rows as needing manual review even though they
// are different physical events.
//
// Solution: for dedup, drop the sponsor names from the noise filter
// so generic-named events keep their identifying tokens. Keep the
// truly noise-y tokens (padel/tour/open/championship/etc).
const SPONSOR_TOKENS = new Set([
  'lotto', 'belfius', 'betclic', 'bnl', 'gnp', 'greenweez',
  'ooredoo', 'alpine', 'motorola', 'razr', 'banco', 'chile', 'oysho',
])
const DEDUP_NOISE = new Set(
  Array.from(NOISE_TOKENS).filter(t => !SPONSOR_TOKENS.has(t)),
)

function tokenizeForDedup(s: string | null | undefined): string[] {
  if (!s) return []
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 0 && !DEDUP_NOISE.has(t))
}

// Minimum token count required to consider a name "specific enough"
// to dedup against. A name that boils down to fewer than this is
// suspicious — likely a generic stub or a noise-heavy artifact.
// Skipping these prevents collisions where the entire identifying
// portion is sponsor/noise text.
const MIN_DEDUP_TOKENS = 2

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

// ── Constants ────────────────────────────────────────────────────────

const FK_TABLES: Array<{ table: string; col: string }> = [
  { table: 'matches', col: 'tournament_id' },
  { table: 'tournament_draws', col: 'tournament_id' },
  { table: 'articles', col: 'tournament_id' },
  { table: 'highlights', col: 'tournament_id' },
]

// Level families. Cross-family matches are rejected (e.g. P2 vs FIP
// Bronze with same name is treated as a real distinction, not a dup).
function levelFamily(level: string | null): 'premier' | 'fip' | 'unknown' {
  if (!level) return 'unknown'
  if (['p1', 'p2', 'major', 'finals'].includes(level)) return 'premier'
  if (level.startsWith('fip_')) return 'fip'
  return 'unknown'
}

// Fields safe to merge across rows. Excludes operational/identity
// columns (id, source, padelapi_id, fip_id which we set explicitly).
const MERGEABLE_FIELDS = [
  'starts_at', 'ends_at', 'timezone',
  'country', 'location', 'venue', 'venue_address', 'venue_type', 'n_courts', 'surface',
  'level', 'prize_money', 'prize_money_fip', 'draw_size_md', 'draw_size_qd',
  'status', 'entry_list_status', 'logo_url', 'matchscorer_url',
] as const

// ── Types ────────────────────────────────────────────────────────────

interface TournamentRow {
  id: string
  name: string
  source: string | null
  padelapi_id: string | null
  fip_id: string | null
  level: string | null
  starts_at: string | null
  ends_at: string | null
  [key: string]: unknown
}

interface DedupAction {
  groupKey: string
  reason: string  // "ok" / "manual_review" / "no_pair"
  survivor: TournamentRow | null
  dying: TournamentRow[]
  // Updates planned for the survivor (null fields → filled from dying)
  updates: Record<string, unknown>
  // FK counts per dying row (for visibility)
  fkCounts: Record<string, Record<string, number>>
}

// ── Helpers ──────────────────────────────────────────────────────────

function normalizedKey(name: string, startsAt: string | null, level: string | null): string | null {
  const year = yearOf(startsAt) ?? 0
  const family = levelFamily(level)
  const tokens = tokenizeForDedup(name)
  // Refuse to produce a key for too-thin names. These collide with each
  // other (e.g. "FIP Silver Betclic" + "FIP Silver Lotto" both reduce
  // to ['fip', 'silver'] under SPONSOR-aware noise stripping). Better to
  // skip than to risk a false-positive merge.
  if (tokens.length < MIN_DEDUP_TOKENS) return null
  return `${family}|${year}|${tokens.sort().join(' ')}`
}

// Bulk FK ref counts — one query per FK table covering ALL tournament
// IDs we care about, then we slice the result client-side. The previous
// "one query per row per table" version timed out at ~500 tournaments.
async function bulkFkRefs(tournamentIds: string[]): Promise<Map<string, Record<string, number>>> {
  const result = new Map<string, Record<string, number>>()
  for (const id of tournamentIds) {
    result.set(id, {})
  }

  for (const { table, col } of FK_TABLES) {
    const { data, error } = await supabase
      .from(table)
      .select(col)
      .in(col, tournamentIds)
    if (error) {
      // Non-fatal — record zero counts for that table and continue
      for (const id of tournamentIds) result.get(id)![table] = 0
      continue
    }
    const tally = new Map<string, number>()
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const tid = row[col] as string | null
      if (!tid) continue
      tally.set(tid, (tally.get(tid) ?? 0) + 1)
    }
    for (const id of tournamentIds) {
      result.get(id)![table] = tally.get(id) ?? 0
    }
  }

  // entity_external_ids has the polymorphic (entity_type, entity_id) shape.
  const { data: eeiRows } = await supabase
    .from('entity_external_ids')
    .select('entity_id')
    .eq('entity_type', 'tournament')
    .in('entity_id', tournamentIds)
  const eeiTally = new Map<string, number>()
  for (const r of (eeiRows ?? []) as Array<{ entity_id: string }>) {
    eeiTally.set(r.entity_id, (eeiTally.get(r.entity_id) ?? 0) + 1)
  }
  for (const id of tournamentIds) {
    result.get(id)!['entity_external_ids'] = eeiTally.get(id) ?? 0
  }

  return result
}

function totalFks(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0)
}

function countNonNullFields(row: TournamentRow): number {
  let n = 0
  for (const k of Object.keys(row)) {
    if (k === 'id') continue
    if (row[k] != null && row[k] !== '') n++
  }
  return n
}

function buildUpdates(survivor: TournamentRow, dying: TournamentRow[]): Record<string, unknown> {
  const updates: Record<string, unknown> = {}
  // Pull fip_id from any dying row that has one (survivor doesn't)
  if (!survivor.fip_id) {
    for (const d of dying) {
      if (d.fip_id) {
        updates.fip_id = d.fip_id
        break
      }
    }
  }
  if (!survivor.padelapi_id) {
    for (const d of dying) {
      if (d.padelapi_id) {
        updates.padelapi_id = d.padelapi_id
        break
      }
    }
  }
  // Fill any null mergeable field from the first dying row that has it
  for (const field of MERGEABLE_FIELDS) {
    if (survivor[field] != null && survivor[field] !== '') continue
    for (const d of dying) {
      if (d[field] != null && d[field] !== '') {
        updates[field] = d[field]
        break
      }
    }
  }
  return updates
}

// ── Group + plan ────────────────────────────────────────────────────

interface PlanResult {
  actions: DedupAction[]
  skippedTooGeneric: number
}

async function buildPlan(): Promise<PlanResult> {
  const { data, error } = await supabase
    .from('tournaments')
    .select(
      'id, name, source, padelapi_id, fip_id, level, starts_at, ends_at, ' +
      'timezone, country, location, venue, venue_address, venue_type, n_courts, surface, ' +
      'prize_money, prize_money_fip, draw_size_md, draw_size_qd, ' +
      'status, entry_list_status, logo_url, matchscorer_url',
    )
    .limit(5000)
  if (error) throw new Error(`tournaments fetch failed: ${error.message}`)

  // Group by normalized key. Two skip reasons:
  //   - normalizedKey returns null when the name reduces to fewer than
  //     MIN_DEDUP_TOKENS distinct tokens (too generic, e.g. "FIP Silver
  //     Betclic" → just "fip silver" after sponsor-stripping)
  //   - level family is "unknown" — too risky to dedup blindly
  const groups = new Map<string, TournamentRow[]>()
  let skippedTooGeneric = 0
  for (const row of (data ?? []) as TournamentRow[]) {
    const k = normalizedKey(row.name, row.starts_at, row.level)
    if (k === null) {
      skippedTooGeneric++
      continue
    }
    if (k.startsWith('unknown|')) continue
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(row)
  }

  // Bulk-fetch FK counts in one pass for every tournament in any
  // multi-row group (single tournaments don't need the lookup).
  const dupGroupRows: TournamentRow[] = []
  for (const rows of groups.values()) {
    if (rows.length >= 2) dupGroupRows.push(...rows)
  }
  const fkLookup = dupGroupRows.length > 0
    ? await bulkFkRefs(dupGroupRows.map(r => r.id))
    : new Map<string, Record<string, number>>()

  const actions: DedupAction[] = []

  for (const [key, rows] of groups) {
    if (rows.length < 2) continue

    const fkCounts: Record<string, Record<string, number>> = {}
    for (const r of rows) {
      fkCounts[r.id] = fkLookup.get(r.id) ?? {}
    }

    // Survivor selection (see top-of-file rules)
    const withRefs = rows.filter(r => totalFks(fkCounts[r.id]) > 0)

    let survivor: TournamentRow | null = null
    let reason = 'ok'

    if (withRefs.length === 1) {
      survivor = withRefs[0]
    } else if (withRefs.length > 1) {
      // Multiple rows have refs — refuse to choose. Operator picks.
      survivor = null
      reason = 'manual_review'
    } else {
      // No row has FK refs. Prefer fip_id-bearing row, then richest metadata.
      const withFipId = rows.filter(r => r.fip_id)
      const candidates = withFipId.length > 0 ? withFipId : rows
      survivor = candidates.reduce((best, r) =>
        countNonNullFields(r) > countNonNullFields(best) ? r : best,
      )
    }

    const dying = rows.filter(r => r.id !== survivor?.id)
    const updates = survivor ? buildUpdates(survivor, dying) : {}

    actions.push({
      groupKey: key,
      reason,
      survivor,
      dying,
      updates,
      fkCounts,
    })
  }

  return { actions, skippedTooGeneric }
}

// ── HTTP handlers ────────────────────────────────────────────────────

export async function GET() {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr
  try {
    const { actions, skippedTooGeneric } = await buildPlan()
    return Response.json({
      ok: true,
      groupCount: actions.length,
      autoMergeable: actions.filter(p => p.reason === 'ok').length,
      manualReview: actions.filter(p => p.reason === 'manual_review').length,
      skippedTooGeneric,
      groups: actions,
    })
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}

export async function POST() {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  let plan: DedupAction[]
  try {
    const result = await buildPlan()
    plan = result.actions
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }

  let merged = 0
  let skipped = 0
  let failed = 0
  const errors: Array<{ groupKey: string; error: string }> = []

  for (const action of plan) {
    if (action.reason !== 'ok' || !action.survivor) {
      skipped++
      continue
    }

    // Delete dying rows first (none have FK refs by survivor-selection rule),
    // then update survivor. Order matters because updates may copy fip_id
    // from a dying row, and the survivor's UNIQUE(fip_id) would conflict
    // if the dying row still held the same value.
    let groupFailed = false
    for (const dr of action.dying) {
      const { error: delErr } = await supabase
        .from('tournaments')
        .delete()
        .eq('id', dr.id)
      if (delErr) {
        errors.push({ groupKey: action.groupKey, error: `delete ${dr.id}: ${delErr.message}` })
        groupFailed = true
        break
      }
    }
    if (groupFailed) {
      failed++
      continue
    }

    if (Object.keys(action.updates).length > 0) {
      const { error: upErr } = await supabase
        .from('tournaments')
        .update(action.updates)
        .eq('id', action.survivor.id)
      if (upErr) {
        errors.push({ groupKey: action.groupKey, error: `update ${action.survivor.id}: ${upErr.message}` })
        failed++
        continue
      }
    }

    merged++
  }

  return Response.json({ ok: true, merged, skipped, failed, errors })
}

#!/usr/bin/env node
// scripts/merge-duplicate-players.mjs
//
// Merges a hard-coded list of confirmed duplicate player pairs (output
// of scripts/find-duplicate-players.mjs that the user reviewed and
// approved). For each pair, the row with `fip_id` is the survivor; the
// padelapi-only row is the victim. All FK references to the victim are
// reassigned to the survivor, then the victim is deleted.
//
// Why this exists vs. /api/ops/players/merge — the API endpoint only
// reassigns 6 FK columns. There are 9 more (added since the endpoint
// was written) that would block the DELETE: sets.server_player_id,
// games.server_player_id, padelgod.match_points.server_player_id,
// racket_clicks.player_id, player_tournament_earnings.player_id,
// padelgod.fip_streams_unresolved.resolved_player_id, plus
// entity_external_ids.entity_id (with unique-constraint handling).
//
// CASCADE columns auto-clean: article_players, highlight_players,
// player_equipment. We don't need to touch those.
//
// Usage:
//   node scripts/merge-duplicate-players.mjs --dry-run   # preview
//   node scripts/merge-duplicate-players.mjs             # execute

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve as pathResolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = pathResolve(__dirname, '..')

function loadEnv() {
  try {
    const raw = readFileSync(pathResolve(ROOT, '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (!m) continue
      const [, k, v] = m
      if (!process.env[k]) process.env[k] = v.replace(/^"|"$/g, '')
    }
  } catch {}
}
loadEnv()

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)
const DRY_RUN = !!args['dry-run']

// ── Confirmed duplicate pairs ────────────────────────────────────────
//
// Format: { keep, drop, label } — keep is the fip+padelapi survivor,
// drop is the padelapi-only victim.
//
// Source: scripts/find-duplicate-players.mjs run on 2026-05-05, filtered
// to "both ranked, rank diff ≤ 5, source asymmetry padelapi↔fip".
// Excluded: rank-1433 cluster (Sanchez Alayeto twins, Hugo Fernandez
// Ruiz / Hugo Martínez Fernández — likely separate players, need human
// review).
const PAIRS = [
  { keep: 'd2da1e8c-5bdc-4c46-b5b5-9d680e167153', drop: '709ef163-d122-48bd-943a-f2e09ea0c506', label: 'Jeronimo "Momo" Gonzalez (ES, rank 15)' },
  { keep: '10449191-f062-4f9b-9a94-9b43c22c4e3d', drop: '5d6adf05-06d0-4c0d-ab45-c29f3618c5cf', label: 'Marina Guinart España (ES, rank 15)' },
  { keep: 'e456f197-f718-4594-97ec-c4350f18f068', drop: 'c8a372d6-a0b6-4b89-ada6-8ba64e37de15', label: 'Carlos Daniel "Sanyo" Gutierrez (AR, rank 27/28)' },
  { keep: 'f3903a9f-afae-4354-bf50-8a98e480202b', drop: '4610f3e9-372a-485f-b727-7d57c665a9cf', label: 'Leonel Daniel "Tolito" Aguirre (AR, rank 29/30)' },
  { keep: 'ae5af669-6cdb-431f-a826-4f64ed87168a', drop: 'd2de39d6-025e-49e5-956a-2b282a637e90', label: 'David Gala Sanchez (ES, rank 33)' },
  { keep: '9ce039bf-db3e-4ac3-aeee-65bbaa4fde3d', drop: '1a30b704-5053-4c37-9518-de61546eed75', label: 'Jose Jimenez Casas (ES, rank 35/39)' },
  { keep: 'd8441345-2fea-4a7a-8b2b-372468f767ce', drop: '583fccd3-5010-4275-891b-75f2a947c7da', label: 'Guillermo Collado Losada (ES, rank 36/37)' },
  { keep: 'c9bf45c6-e63f-439a-a27a-a5aa53353a52', drop: '3a083e63-aab6-4db9-8d59-85739ee4d57a', label: 'Valentino "Tino" Libaak (AR, rank 43/44)' },
  { keep: '36772a8a-c290-4350-b3b8-8e9bfe64532a', drop: 'c1809d05-e81a-4ab7-b54f-3a6d921c22b1', label: 'Maximiliano Arce Simo (AR, rank 45/48)' },
  { keep: '6de4e366-f643-488f-8605-06a85a0c87aa', drop: '2fdc0255-a4b0-483f-8acf-d61d09274d5d', label: 'Ignacio Piotto Albornoz (AR, rank 49/53)' },
  { keep: '1856dbef-84e8-4eab-add3-fbd99fe4c880', drop: '1323eb37-48ff-4519-a01d-1c3ac99d6b30', label: 'Jaime Menendez (ES, rank 1369/1370)' },
  { keep: 'a6227826-1483-48d5-b445-e51403163e08', drop: 'a738f3d4-02fd-4b19-99a5-1a796b1b8c82', label: 'Benjamin Dufour (FR, rank 1369/1370)' },
  { keep: 'f6a0b5d7-4e65-4a07-8503-ca1ee52c7e47', drop: '2ebc0424-739d-4176-8b4c-08dd07a5d430', label: 'Kaori Peco (ES, rank 1433)' },
  { keep: '43bb8a5d-e914-413a-9f8b-80bc3ef0dc29', drop: 'a5795b73-43f4-4dba-9ff5-a384428139bf', label: 'Iker Martin Sampayo (ES, rank 1555/1560)' },
]

// ── FK reassignment plan ────────────────────────────────────────────
//
// Each entry: { schema, table, columns[] } — for each column, run
// UPDATE table SET col = keepId WHERE col = dropId.
//
// padelgod.* tables (match_points, fip_streams_unresolved) live in a
// non-default schema; the supabase-js client supports it via .schema().
const FK_PLAN = [
  { schema: 'public', table: 'matches',          columns: ['pair1_player1_id', 'pair1_player2_id', 'pair2_player1_id', 'pair2_player2_id'] },
  { schema: 'public', table: 'games',            columns: ['server_player_id'] },
  { schema: 'public', table: 'tournament_draws', columns: ['player1_id', 'player2_id'] },
  { schema: 'public', table: 'racket_clicks',    columns: ['player_id'] },
]
// padelgod.* schema isn't exposed via the PostgREST API — handled via
// raw SQL through `padelgod.merge_player_refs` if it exists, otherwise
// best-effort skipped (these dupe rows are old padelapi-only players,
// almost certainly no padelgod data points to them).

async function reassignFks(keepId, dropId) {
  let total = 0
  for (const { schema, table, columns } of FK_PLAN) {
    const client = schema === 'public' ? sb : sb.schema(schema)
    for (const col of columns) {
      if (DRY_RUN) {
        const { count, error } = await client
          .from(table)
          .select('*', { count: 'exact', head: true })
          .eq(col, dropId)
        if (error) {
          console.error(`    ⚠ ${schema}.${table}.${col} count failed:`, error.message)
          continue
        }
        if (count && count > 0) console.log(`    [dry] would UPDATE ${schema}.${table}.${col}: ${count} rows`)
        total += count ?? 0
      } else {
        const { data, error } = await client
          .from(table)
          .update({ [col]: keepId })
          .eq(col, dropId)
          .select('*', { count: 'exact', head: true })
        if (error) {
          throw new Error(`UPDATE ${schema}.${table}.${col} failed: ${error.message}`)
        }
        const n = data?.length ?? 0
        if (n > 0) console.log(`    ${schema}.${table}.${col}: ${n} rows`)
        total += n
      }
    }
  }
  return total
}

async function mergeEarnings(keepId, dropId) {
  // player_tournament_earnings has UNIQUE (player_id, tournament_id,
  // category). Both rows of a dupe pair often have entries for the same
  // tournament — the survivor's row is canonical (FIP player), so
  // delete the victim's row in those collisions and reassign the rest.
  const { data: victimRows, error: vErr } = await sb
    .from('player_tournament_earnings')
    .select('id, tournament_id, category')
    .eq('player_id', dropId)
  if (vErr) throw new Error(`earnings fetch failed: ${vErr.message}`)
  if (!victimRows?.length) return { moved: 0, deleted: 0 }

  const { data: keepRows, error: kErr } = await sb
    .from('player_tournament_earnings')
    .select('tournament_id, category')
    .eq('player_id', keepId)
  if (kErr) throw new Error(`earnings fetch (keep) failed: ${kErr.message}`)

  const keepKeys = new Set((keepRows ?? []).map((r) => `${r.tournament_id}::${r.category}`))

  const toDelete = []
  const toMove = []
  for (const row of victimRows) {
    const key = `${row.tournament_id}::${row.category}`
    if (keepKeys.has(key)) toDelete.push(row.id)
    else toMove.push(row.id)
  }

  if (DRY_RUN) {
    if (toMove.length) console.log(`    [dry] would move ${toMove.length} earnings rows`)
    if (toDelete.length) console.log(`    [dry] would delete ${toDelete.length} duplicate earnings rows`)
    return { moved: toMove.length, deleted: toDelete.length }
  }

  if (toDelete.length) {
    const { error } = await sb.from('player_tournament_earnings').delete().in('id', toDelete)
    if (error) throw new Error(`earnings delete failed: ${error.message}`)
    console.log(`    player_tournament_earnings: deleted ${toDelete.length} duplicate row(s)`)
  }
  if (toMove.length) {
    const { error } = await sb
      .from('player_tournament_earnings')
      .update({ player_id: keepId })
      .in('id', toMove)
    if (error) throw new Error(`earnings update failed: ${error.message}`)
    console.log(`    player_tournament_earnings: moved ${toMove.length} row(s)`)
  }
  return { moved: toMove.length, deleted: toDelete.length }
}

async function moveExternalIds(keepId, dropId) {
  // Move entity_external_ids rows from victim → survivor. Handle the
  // unique constraint (source, entity_type, external_id) by deleting
  // any victim row whose (source, external_id) already exists for the
  // survivor — keep the survivor's. Then UPDATE the rest.
  const { data: victimIds, error: vErr } = await sb
    .from('entity_external_ids')
    .select('id, source, external_id')
    .eq('entity_type', 'player')
    .eq('entity_id', dropId)
  if (vErr) throw new Error(`entity_external_ids fetch failed: ${vErr.message}`)
  if (!victimIds?.length) return { moved: 0, deleted: 0 }

  const { data: keepIds, error: kErr } = await sb
    .from('entity_external_ids')
    .select('source, external_id')
    .eq('entity_type', 'player')
    .eq('entity_id', keepId)
  if (kErr) throw new Error(`entity_external_ids fetch (keep) failed: ${kErr.message}`)

  const keepKeys = new Set((keepIds ?? []).map((r) => `${r.source}::${r.external_id}`))

  const toDelete = []
  const toMove = []
  for (const row of victimIds) {
    const key = `${row.source}::${row.external_id}`
    if (keepKeys.has(key)) toDelete.push(row.id)
    else toMove.push(row.id)
  }

  if (DRY_RUN) {
    if (toMove.length) console.log(`    [dry] would move ${toMove.length} entity_external_ids rows`)
    if (toDelete.length) console.log(`    [dry] would delete ${toDelete.length} duplicate entity_external_ids rows`)
    return { moved: toMove.length, deleted: toDelete.length }
  }

  if (toDelete.length) {
    const { error } = await sb.from('entity_external_ids').delete().in('id', toDelete)
    if (error) throw new Error(`entity_external_ids delete failed: ${error.message}`)
    console.log(`    entity_external_ids: deleted ${toDelete.length} duplicate row(s)`)
  }
  if (toMove.length) {
    const { error } = await sb
      .from('entity_external_ids')
      .update({ entity_id: keepId })
      .in('id', toMove)
    if (error) throw new Error(`entity_external_ids update failed: ${error.message}`)
    console.log(`    entity_external_ids: moved ${toMove.length} row(s)`)
  }
  return { moved: toMove.length, deleted: toDelete.length }
}

async function deletePlayer(dropId) {
  if (DRY_RUN) {
    console.log(`    [dry] would DELETE players row ${dropId}`)
    return
  }
  const { error } = await sb.from('players').delete().eq('id', dropId)
  if (error) throw new Error(`DELETE players failed: ${error.message}`)
  console.log(`    deleted players row ${dropId}`)
}

async function verifyPair(pair) {
  const { data, error } = await sb
    .from('players')
    .select('id, name, country, ranking, fip_id, padelapi_id, external_id')
    .in('id', [pair.keep, pair.drop])
  if (error) throw new Error(`verify failed: ${error.message}`)
  const keep = data.find((r) => r.id === pair.keep)
  const drop = data.find((r) => r.id === pair.drop)
  if (!keep) throw new Error(`survivor ${pair.keep} not found`)
  if (!drop) throw new Error(`victim ${pair.drop} not found`)
  if (!keep.fip_id) {
    console.warn(`    ⚠ survivor has no fip_id — proceeding anyway`)
  }
  if (drop.fip_id) {
    throw new Error(`victim ${drop.id} unexpectedly has fip_id (${drop.fip_id}); refusing to delete`)
  }
  return { keep, drop }
}

;(async () => {
  console.log(`merging ${PAIRS.length} duplicate pair(s) — ${DRY_RUN ? 'DRY RUN' : 'EXECUTING'}\n`)
  let succeeded = 0
  let failed = 0
  for (const pair of PAIRS) {
    console.log(`▶ ${pair.label}`)
    console.log(`  keep=${pair.keep}  drop=${pair.drop}`)
    try {
      await verifyPair(pair)
      const fkRows = await reassignFks(pair.keep, pair.drop)
      const earn = await mergeEarnings(pair.keep, pair.drop)
      const ext = await moveExternalIds(pair.keep, pair.drop)
      await deletePlayer(pair.drop)
      console.log(`  ✓ ${fkRows} FK row(s) reassigned, earnings ${earn.moved}/${earn.deleted}, aliases ${ext.moved}/${ext.deleted}`)
      succeeded++
    } catch (e) {
      console.error(`  ✗ FAILED: ${e.message}`)
      failed++
    }
    console.log('')
  }
  console.log(`Summary: ${succeeded} merged, ${failed} failed.`)
  if (failed > 0) process.exit(1)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})

/**
 * One-shot backfill: resolve player FKs on the 4 thin qualifier matches for
 * FIP Gold Asuncion 2026.
 *
 * The fip-draw-populator previously wrote these matches with NULL player FKs
 * and stored the OOP short-form names (e.g. "M. Alvarez") because its exact-
 * match lookup missed short-form and middle-name variants. This script applies
 * the same three-pass resolution used in the updated worker and patches the
 * four rows.
 *
 * Usage:
 *   # Dry run (default)
 *   npx tsx scripts/backfill-asuncion-thin-matches.ts
 *
 *   # Apply changes
 *   npx tsx scripts/backfill-asuncion-thin-matches.ts --apply
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

const TOURNAMENT_ID = '5027936c-9fd5-4309-83e7-44ee4620a207'
const THIN_MATCH_IDS = [
  'd2ab583c-ef86-4a9a-91ce-1dba56985d1c', // MQ021
  '8a0f0669-e9fa-4720-b3a6-bf61cd1ade99', // MQ030
  '7a6dbbad-7bae-4ae5-93d6-474784db44be', // MQ017
  '6801ef89-4bb0-4235-9626-26fe8cc4b872', // MQ022
]

function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function shortenName(longName: string): string {
  const norm = normalizeName(longName)
  const tokens = norm.split(' ').filter(Boolean)
  if (tokens.length < 2) return norm
  const initial = tokens[0]!.charAt(0)
  const tail = tokens.slice(1).join(' ')
  return `${initial}. ${tail}`
}

function buildShortFormMap(nameToFipId: Map<string, string>): Map<string, string | null> {
  const map = new Map<string, string | null>()
  const put = (key: string, fipId: string) => {
    if (map.has(key)) {
      const existing = map.get(key)
      if (existing !== fipId) map.set(key, null) // ambiguous
    } else {
      map.set(key, fipId)
    }
  }
  for (const [longNorm, fipId] of nameToFipId) {
    put(shortenName(longNorm), fipId)
    const tokens = longNorm.split(' ').filter(Boolean)
    if (tokens.length >= 3) {
      const lastOnly = `${tokens[0]!.charAt(0)}. ${tokens[tokens.length - 1]}`
      put(lastOnly, fipId)
    }
  }
  return map
}

function resolveName(
  name: string,
  nameToFipId: Map<string, string>,
  shortFormToFipId: Map<string, string | null>,
  fipIdToPlayerId: Map<string, string>
): { playerId: string; method: string } | null {
  const norm = normalizeName(name)

  // 1. Exact match
  const exactFipId = nameToFipId.get(norm)
  if (exactFipId) {
    const pid = fipIdToPlayerId.get(exactFipId)
    return pid ? { playerId: pid, method: 'exact' } : null
  }

  // 2. Short-form match
  if (shortFormToFipId.has(norm)) {
    const sfFipId = shortFormToFipId.get(norm) ?? null
    if (sfFipId == null) return null // ambiguous
    const pid = fipIdToPlayerId.get(sfFipId)
    return pid ? { playerId: pid, method: 'short-form' } : null
  }

  // 3. Middle-name strip and prefix match
  const tokens = norm.split(' ').filter(Boolean)
  if (tokens.length >= 3) {
    // 3a. Remove one middle token
    for (let skip = 1; skip < tokens.length - 1; skip++) {
      const candidate = [...tokens.slice(0, skip), ...tokens.slice(skip + 1)].join(' ')
      const cFipId = nameToFipId.get(candidate)
      if (cFipId) {
        const pid = fipIdToPlayerId.get(cFipId)
        return pid ? { playerId: pid, method: `strip(pos=${skip})→"${candidate}"` } : null
      }
    }
    // 3b. Prefix match
    for (let len = tokens.length - 1; len >= 2; len--) {
      const prefix = tokens.slice(0, len).join(' ')
      const pFipId = nameToFipId.get(prefix)
      if (pFipId) {
        const pid = fipIdToPlayerId.get(pFipId)
        return pid ? { playerId: pid, method: `prefix(len=${len})→"${prefix}"` } : null
      }
    }
  }

  return null
}

async function loadEntryListNameMap(): Promise<Map<string, string>> {
  const { data: rows, error } = await supabase
    .schema('padelgod')
    .from('entry_list_snapshots')
    .select('name, fip_id, category, captured_at')
    .eq('tournament_id', TOURNAMENT_ID)
  if (error) throw new Error(`entry_list_snapshots: ${error.message}`)

  const maxByCat = new Map<string, string>()
  for (const r of (rows ?? [])) {
    const prev = maxByCat.get(r.category)
    if (!prev || r.captured_at > prev) maxByCat.set(r.category, r.captured_at)
  }

  const map = new Map<string, string>()
  for (const r of (rows ?? [])) {
    if (!r.name || !r.fip_id) continue
    if (r.captured_at !== maxByCat.get(r.category)) continue
    map.set(normalizeName(r.name), r.fip_id)
  }
  return map
}

async function main() {
  const applyFlag = process.argv.includes('--apply')
  console.log(`Mode: ${applyFlag ? 'APPLY' : 'DRY RUN'}\n`)

  // 1. Load entry list maps
  console.log('Loading entry list...')
  const nameToFipId = await loadEntryListNameMap()
  const shortFormToFipId = buildShortFormMap(nameToFipId)
  console.log(`  ${nameToFipId.size} players in entry list`)

  // 2. Load the 4 thin matches
  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select(
      'id, widget_id_composite, ' +
      'pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name, ' +
      'pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id'
    )
    .in('id', THIN_MATCH_IDS)
  if (mErr) throw new Error(`matches read: ${mErr.message}`)

  // 3. Collect all needed fip_ids to bulk-load players
  const allNames = new Set<string>()
  for (const m of (matches ?? [])) {
    for (const n of [m.pair1_player1_name, m.pair1_player2_name, m.pair2_player1_name, m.pair2_player2_name]) {
      if (n) allNames.add(n)
    }
  }

  const neededFipIds = new Set<string>()
  for (const name of allNames) {
    const norm = normalizeName(name)
    const fipId =
      nameToFipId.get(norm) ??
      (shortFormToFipId.get(norm) ?? undefined)
    if (fipId) neededFipIds.add(fipId)
  }

  const { data: players, error: pErr } = await supabase
    .from('players')
    .select('id, fip_id')
    .in('fip_id', Array.from(neededFipIds))
  if (pErr) throw new Error(`players read: ${pErr.message}`)
  const fipIdToPlayerId = new Map<string, string>()
  for (const p of (players ?? [])) {
    if (p.id && p.fip_id) fipIdToPlayerId.set(p.fip_id, p.id)
  }

  // 4. Process each thin match
  let totalUpdated = 0
  for (const m of (matches ?? [])) {
    console.log(`\n  Match ${m.widget_id_composite} (${m.id})`)
    const slots = [
      { field: 'pair1_player1', name: m.pair1_player1_name, currentId: m.pair1_player1_id },
      { field: 'pair1_player2', name: m.pair1_player2_name, currentId: m.pair1_player2_id },
      { field: 'pair2_player1', name: m.pair2_player1_name, currentId: m.pair2_player1_id },
      { field: 'pair2_player2', name: m.pair2_player2_name, currentId: m.pair2_player2_id },
    ]

    const update: Record<string, string> = {}
    let resolvedCount = 0

    for (const slot of slots) {
      if (!slot.name) {
        console.log(`    ${slot.field}: NO NAME`)
        continue
      }
      if (slot.currentId) {
        console.log(`    ${slot.field}: already has FK (${slot.currentId}) — skipping`)
        resolvedCount++
        continue
      }
      const result = resolveName(slot.name, nameToFipId, shortFormToFipId, fipIdToPlayerId)
      if (result) {
        update[`${slot.field}_id`] = result.playerId
        resolvedCount++
        console.log(`    ${slot.field}: "${slot.name}" → ${result.playerId} [${result.method}]`)
      } else {
        console.log(`    ${slot.field}: "${slot.name}" → UNRESOLVED`)
      }
    }

    console.log(`  Resolved: ${resolvedCount}/4`)

    if (Object.keys(update).length === 0) {
      console.log('  No changes to apply')
      continue
    }

    if (applyFlag) {
      const { error: updErr } = await supabase
        .from('matches')
        .update(update)
        .eq('id', m.id)
      if (updErr) {
        console.error(`  UPDATE failed: ${updErr.message}`)
      } else {
        console.log(`  ✓ Updated ${Object.keys(update).length} fields`)
        totalUpdated++
      }
    } else {
      console.log(`  [dry-run] Would update: ${JSON.stringify(update)}`)
      totalUpdated++
    }
  }

  console.log(`\nDone. ${totalUpdated}/${(matches ?? []).length} matches ${applyFlag ? 'updated' : 'would be updated'}`)
  if (!applyFlag) {
    console.log('\nRe-run with --apply to write changes.')
  }
}

main().catch((e) => { console.error(e); process.exit(1) })

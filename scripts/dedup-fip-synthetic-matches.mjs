// Pattern A dedup: delete rows whose `padelapi_id` is a synthetic
// `fip-<old-tournament-uuid>-<gender>-<round>-<player-shortnames>`
// string left over from the cross-source tournament merge.
//
// When we merged each FIP-sourced tournament row into its padelapi
// twin earlier, we redirected match.tournament_id from the deleted
// FIP UUID to the surviving padelapi UUID. That left every FIP-sourced
// match row sitting next to its real numeric-padelapi sibling for the
// same physical match — duplicates the UI shows as e.g. "Finals: 2
// rows of G. Rubio / I. Piotto vs A. Fernandez".
//
// This script:
//   1. Loads every match row whose padelapi_id starts with 'fip-'.
//   2. For each, finds the candidate sibling in the same
//      (tournament_id, category, normalized_round) group with a
//      numeric padelapi_id and an overlapping player set.
//   3. If a sibling exists → the fip- row is a confirmed duplicate.
//      Migrate any FIP-only fields (widget_id_composite, finished_at,
//      court when survivor's are null) onto the survivor and delete
//      the fip- row.
//   4. If NO sibling exists → log + skip. The fip- row is the only
//      copy of that match; deleting would lose data.
//
// Defaults to dry-run. Pass --apply to mutate.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

async function loadEnv() {
  const text = await fs.readFile(path.resolve('.env.local'), 'utf8')
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}

function normRound(raw) {
  if (!raw) return null
  const c = String(raw).trim().toLowerCase()
  const m = {
    r128: 'R128', 'round of 128': 'R128',
    r64: 'R64', 'round of 64': 'R64',
    r32: 'R32', 'round of 32': 'R32',
    r16: 'R16', 'round of 16': 'R16',
    qf: 'QF', quarter: 'QF', quarters: 'QF', quarterfinals: 'QF', 'quarter-finals': 'QF',
    sf: 'SF', semifinals: 'SF', 'semi-finals': 'SF',
    f: 'F', final: 'F', finals: 'F',
    q1: 'Q1', q2: 'Q2', q3: 'Q3',
  }
  return m[c] ?? null
}

/** Set of non-null player IDs across both pairs. */
function playerSet(m) {
  return new Set(
    [m.pair1_player1_id, m.pair1_player2_id, m.pair2_player1_id, m.pair2_player2_id]
      .filter(Boolean),
  )
}

/** Overlap = how many player IDs the two rows share (max 4). */
function overlap(a, b) {
  let n = 0
  for (const id of a) if (b.has(id)) n++
  return n
}

async function main() {
  await loadEnv()
  const apply = process.argv.includes('--apply')
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
  )

  console.log(`${apply ? '[APPLY]' : '[DRY RUN]'} Deduping synthetic fip-* match rows…\n`)

  // 1. All synthetic rows
  const { data: syntheticRows, error } = await s
    .from('matches')
    .select('*')
    .like('padelapi_id', 'fip-%')
  if (error) throw error
  console.log(`Synthetic rows found: ${syntheticRows.length}\n`)

  // 1a. Pre-compute: does the OLD tournament UUID embedded in each
  // synthetic ID still exist? If NO, the row is a confirmed orphan
  // from the cross-source tournament merge — even if we can't find
  // a player-overlap match below, the data is unrecoverable noise
  // (player IDs point at FIP-side player rows that may also be
  // orphaned, names are stored as '?', etc).
  const embeddedUuids = new Set()
  for (const r of syntheticRows) {
    const m = /^fip-([a-f0-9-]{36})-/.exec(r.padelapi_id ?? '')
    if (m) embeddedUuids.add(m[1])
  }
  const { data: liveTournaments } = await s
    .from('tournaments')
    .select('id')
    .in('id', [...embeddedUuids])
  const liveUuids = new Set((liveTournaments ?? []).map(t => t.id))
  console.log(`Embedded tournament UUIDs: ${embeddedUuids.size} (${liveUuids.size} still live, ${embeddedUuids.size - liveUuids.size} deleted by earlier merge)\n`)

  // 2. For each one, look up the (tournament, normalized round, category) bucket
  //    of numeric-padelapi candidates.
  let plan = []
  let unmatched = []
  const tournamentBuckets = new Map() // tournamentId → array of numeric rows

  // Pre-fetch all numeric padelapi rows for the tournaments involved
  const tournamentIds = [...new Set(syntheticRows.map(r => r.tournament_id))]
  for (const tid of tournamentIds) {
    const { data } = await s
      .from('matches')
      .select('*')
      .eq('tournament_id', tid)
      .not('padelapi_id', 'like', 'fip-%')
      .not('padelapi_id', 'is', null)
    tournamentBuckets.set(tid, data ?? [])
  }

  for (const synth of syntheticRows) {
    // Extract the embedded UUID and check whether that tournament
    // still exists. If it was deleted by the cross-source merge,
    // the synth row is a confirmed orphan — delete unconditionally.
    const m = /^fip-([a-f0-9-]{36})-/.exec(synth.padelapi_id ?? '')
    const embeddedUuid = m?.[1] ?? null
    const isOrphan = embeddedUuid != null && !liveUuids.has(embeddedUuid)

    const candidates = (tournamentBuckets.get(synth.tournament_id) ?? [])
      .filter(c => c.category === synth.category)
      .filter(c => normRound(c.round) === normRound(synth.round))

    if (candidates.length === 0) {
      // No siblings at all. If it's a confirmed orphan we still want
      // it gone — but we don't have a survivor to migrate fields to.
      if (isOrphan) {
        plan.push({ synth, survivor: null, overlap: 0, reason: 'orphan-no-sibling' })
      } else {
        unmatched.push(synth)
      }
      continue
    }

    const synthPlayers = playerSet(synth)
    let best = null
    let bestOverlap = 0
    for (const c of candidates) {
      const ov = overlap(synthPlayers, playerSet(c))
      if (ov > bestOverlap) { bestOverlap = ov; best = c }
    }

    if (best && bestOverlap >= 2) {
      // Strong match by player IDs.
      plan.push({ synth, survivor: best, overlap: bestOverlap, reason: 'player-overlap' })
    } else if (isOrphan && candidates.length > 0) {
      // No player overlap (different source-side player rows for the
      // same physical players) — but the synth's UUID is dead. Pick
      // the candidate with the same draw position if available,
      // otherwise just any candidate as survivor; the synth is gone
      // either way. If no candidate at all (handled above), we'd
      // already have logged it.
      plan.push({ synth, survivor: best ?? candidates[0], overlap: bestOverlap, reason: 'orphan-no-overlap' })
    } else {
      unmatched.push(synth)
    }
  }

  console.log(`Confirmed duplicates: ${plan.length}`)
  console.log(`Unmatched synthetic rows: ${unmatched.length}\n`)

  if (unmatched.length > 0) {
    console.log('Unmatched (will NOT be deleted — possibly the only copy):')
    for (const u of unmatched.slice(0, 20)) {
      console.log(`  ${u.id.slice(0, 8)}.. ${u.padelapi_id} round="${u.round}" cat=${u.category} status=${u.status}`)
    }
    if (unmatched.length > 20) console.log(`  …and ${unmatched.length - 20} more`)
    console.log()
  }

  // Migration spec: copy survivor-null fields from synth → survivor BEFORE delete
  const FIP_ONLY_FIELDS = ['widget_id_composite', 'finished_at', 'court']

  console.log('Sample plan (first 10):')
  for (const p of plan.slice(0, 10)) {
    const updates = []
    if (p.survivor) {
      for (const f of FIP_ONLY_FIELDS) {
        if (p.synth[f] != null && p.survivor[f] == null) {
          updates.push(`${f}=${String(p.synth[f]).slice(0, 30)}`)
        }
      }
    }
    const survSig = p.survivor ? `keep ${p.survivor.id.slice(0, 8)}` : 'no survivor'
    console.log(`  delete ${p.synth.id.slice(0, 8)}.. → ${survSig} [${p.reason}, overlap=${p.overlap}/4]${updates.length ? ' | migrate: ' + updates.join(', ') : ''}`)
  }
  if (plan.length > 10) console.log(`  …and ${plan.length - 10} more`)
  console.log()

  if (!apply) {
    console.log('[DRY RUN] No writes. Re-run with --apply to execute.')
    return
  }

  // Apply
  let deleted = 0
  let migrated = 0
  let failed = 0
  for (const p of plan) {
    try {
      // 1. Migrate fields if we have a survivor and it's null where
      //    synth has a value. orphan-no-sibling rows have no survivor;
      //    skip the migrate step.
      if (p.survivor) {
        const patch = {}
        for (const f of FIP_ONLY_FIELDS) {
          if (p.synth[f] != null && p.survivor[f] == null) patch[f] = p.synth[f]
        }
        if (Object.keys(patch).length > 0) {
          const { error: upErr } = await s
            .from('matches')
            .update(patch)
            .eq('id', p.survivor.id)
          if (upErr) throw new Error(`migrate failed: ${upErr.message}`)
          migrated++
        }
      }
      // 2. Delete the synthetic row
      const { error: delErr } = await s
        .from('matches')
        .delete()
        .eq('id', p.synth.id)
      if (delErr) throw new Error(`delete failed: ${delErr.message}`)
      deleted++
    } catch (e) {
      console.log(`  ✗ ${p.synth.id.slice(0, 8)}.. : ${e.message}`)
      failed++
    }
  }
  console.log(`\nDone. deleted=${deleted}  field-migrations=${migrated}  failed=${failed}  unmatched-skipped=${unmatched.length}`)
}

main().catch((e) => { console.error(e); process.exit(1) })

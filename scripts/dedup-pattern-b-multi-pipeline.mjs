// Pattern B dedup: matches duplicated across multiple padelgod ingest
// pipelines. Same physical match shows up under different
// `widget_id_composite` values (or with no source-id at all) because
// fip-draw-populator, results-writer, and oop-fetcher each create
// their own row and never reconcile.
//
// Distinguishing trait from Pattern A: NO synthetic `fip-` padelapi_id.
// All rows have either numeric padelapi, a widget composite, or
// nothing.
//
// Match-identity signature (since player IDs differ across pipelines):
//   canonical-last-name-tokens, sorted, joined with '|'
// E.g. "G. Rubio / I. Piotto Albornoz vs A. Fernandez / D. Tomas
// Perino" → "albornoz|fernandez|perino|rubio".
// Pipeline-A's "G. Rubio / I. Piotto" + same opposition would tokenise
// the same way once we strip first initials and collapse case.
//
// Survivor priority (richest data wins):
//   1. Has padelapi_id (numeric)             ← canonical source
//   2. Has widget_id_composite               ← FIP draw populator
//   3. Most-complete signal: sets count, finished_at, court, sched
// Field migration: any column that's null on the survivor gets
// copied from the duplicate.
// Children (sets, games): if survivor has none and duplicate has,
// reassign their match_id; otherwise hard-delete the duplicate's
// children before deleting the duplicate.
//
// Defaults to dry-run; pass --apply to mutate.

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

/** Strip first-initial-style prefixes ("M.", "G.", "Dr.") and the
 *  remainder before the LAST space — leaves the family name as the
 *  identifying token. Diacritics stripped + lowercased. */
function lastNameToken(rawName) {
  if (!rawName) return null
  let n = String(rawName).trim()
  if (!n) return null
  // Remove leading initials like "M." / "Dr." / "I."
  n = n.replace(/^(?:[A-Za-zÀ-ÿ]{1,3}\.\s*)+/, '').trim()
  if (!n) return null
  // Take everything after the LAST space (last name)
  const parts = n.split(/\s+/)
  let last = parts[parts.length - 1]
  // Strip diacritics
  last = last.normalize('NFD').replace(/[̀-ͯ]/g, '')
  // Strip non-letters
  last = last.replace(/[^a-zA-ZñÑ]/g, '').toLowerCase()
  return last || null
}

/** Build the 4-token signature for a match, in alphabetical order so
 *  pair1/pair2 swaps don't matter. Uses the FK-resolved player name
 *  when available, falls back to the inline pair*_player*_name
 *  column for thin rows. Returns null if fewer than 3 tokens are
 *  resolvable (too risky to merge on partial data). */
function matchSignature(match, playerNameById) {
  const tokens = []
  for (let pair = 1; pair <= 2; pair++) {
    for (let pos = 1; pos <= 2; pos++) {
      const id = match[`pair${pair}_player${pos}_id`]
      const inline = match[`pair${pair}_player${pos}_name`]
      const resolved = id ? playerNameById.get(id) : null
      const tok = lastNameToken(resolved ?? inline)
      if (tok) tokens.push(tok)
    }
  }
  if (tokens.length < 3) return null
  return tokens.sort().join('|')
}

/** Detect the "no real time" sentinel: padelapi sometimes stores
 *  scheduled_at as midnight UTC when only the date was known and the
 *  schedule_label string never got converted to a real time. Padelgod's
 *  oop-fetcher does the timezone conversion correctly. */
function hasRealScheduledAt(m) {
  if (!m.scheduled_at) return false
  const d = new Date(m.scheduled_at)
  if (Number.isNaN(d.getTime())) return false
  return !(d.getUTCHours() === 0 && d.getUTCMinutes() === 0)
}

/** Score a match's "completeness" — higher = better survivor. */
function completenessScore(m) {
  let s = 0
  if (m.padelapi_id && /^\d+$/.test(m.padelapi_id)) s += 1000
  if (m.widget_id_composite) s += 500
  // Big bonus for a "real" scheduled_at (not the midnight-UTC date-only
  // sentinel padelapi often produces for FIP tournaments). This tips
  // FIP cross-pipeline duplicates to the padelgod row, which gets the
  // timezone conversion right via oop-fetcher.
  if (m.scheduled_at) s += hasRealScheduledAt(m) ? 800 : 25
  if (m.finished_at) s += 100
  if (m.court) s += 20
  if (m.winner_pair) s += 10
  if (m.status === 'finished' || m.status === 'retired' || m.status === 'walkover') s += 5
  return s
}

const STRUCTURAL_LIMIT = { F: 1, SF: 2, QF: 4, R16: 8, R32: 16, R64: 32, R128: 64 }

async function main() {
  await loadEnv()
  const apply = process.argv.includes('--apply')
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
  )

  console.log(`${apply ? '[APPLY]' : '[DRY RUN]'} Pattern B match dedup\n`)

  // 1. Find tournaments with structural overrun (same shape as the
  //    audit script — duplicates are tournaments where the count of
  //    matches in (cat, round) exceeds the bracket size).
  const cutoff = new Date(Date.now() - 60 * 86400000).toISOString()
  const { data: tournaments } = await s
    .from('tournaments')
    .select('id, name')
    .gte('ends_at', cutoff)

  let totalGroups = 0
  let totalPlanned = 0
  let totalSkipped = 0
  const planByTournament = []

  for (const t of tournaments ?? []) {
    const { data: matches } = await s
      .from('matches')
      .select('*')
      .eq('tournament_id', t.id)
    if (!matches || matches.length === 0) continue

    // Pre-resolve player names for all FK refs in this tournament
    const playerIds = new Set()
    for (const m of matches) {
      for (const c of [m.pair1_player1_id, m.pair1_player2_id, m.pair2_player1_id, m.pair2_player2_id]) {
        if (c) playerIds.add(c)
      }
    }
    const playerNameById = new Map()
    if (playerIds.size > 0) {
      const { data: players } = await s
        .from('players')
        .select('id, name, display_name')
        .in('id', [...playerIds])
      for (const p of players ?? []) {
        playerNameById.set(p.id, p.display_name ?? p.name)
      }
    }

    // 2. Cluster matches into "same physical match" groups. Two
    //    signals in priority order:
    //      a. Name-token signature — sorted last-name tokens of the 4
    //         players. Handles inline pair*_player*_name AND FK-resolved
    //         names.
    //      b. Player-UUID overlap (≥3 of 4) — fallback for rows where
    //         the same person resolves to different player IDs across
    //         pipelines (e.g. "Piotto" vs "Piotto Albornoz" produce
    //         different last-name tokens but pair2 + pair1_p1 still
    //         share UUIDs).
    //
    //    Build candidate clusters via union-find over both signals.
    const eligible = matches.filter(
      (m) =>
        m.status !== 'bye' &&
        normRound(m.round) &&
        STRUCTURAL_LIMIT[normRound(m.round)],
    )

    // Union-find structure keyed by match.id
    const parent = new Map()
    const find = (x) => {
      let p = parent.get(x) ?? x
      if (p === x) return x
      const root = find(p)
      parent.set(x, root)
      return root
    }
    const union = (a, b) => {
      const ra = find(a), rb = find(b)
      if (ra !== rb) parent.set(ra, rb)
    }
    for (const m of eligible) parent.set(m.id, m.id)

    // Bucket by (cat, round) so we only compare within the same round
    const bucketRows = new Map()
    for (const m of eligible) {
      const bk = `${m.category}|${normRound(m.round)}`
      if (!bucketRows.has(bk)) bucketRows.set(bk, [])
      bucketRows.get(bk).push(m)
    }

    for (const [, rows] of bucketRows) {
      // Pre-compute signatures + UUID sets for each row
      const rowMeta = rows.map((m) => ({
        m,
        sig: matchSignature(m, playerNameById),
        ids: new Set(
          [m.pair1_player1_id, m.pair1_player2_id, m.pair2_player1_id, m.pair2_player2_id].filter(Boolean),
        ),
      }))

      // Pass A: same name-token signature → union
      const bySig = new Map()
      for (const r of rowMeta) {
        if (!r.sig) continue
        if (!bySig.has(r.sig)) bySig.set(r.sig, [])
        bySig.get(r.sig).push(r.m)
      }
      for (const [, group] of bySig) {
        for (let i = 1; i < group.length; i++) union(group[0].id, group[i].id)
      }

      // Pass B: ≥3 UUID overlap → union (handles cases where Pass A
      // missed because token spelling diverged)
      for (let i = 0; i < rowMeta.length; i++) {
        for (let j = i + 1; j < rowMeta.length; j++) {
          const a = rowMeta[i], b = rowMeta[j]
          if (find(a.m.id) === find(b.m.id)) continue
          let overlap = 0
          for (const id of a.ids) if (b.ids.has(id)) overlap++
          if (overlap >= 3) union(a.m.id, b.m.id)
        }
      }
    }

    // Materialise clusters from the union-find result
    const clustersByRoot = new Map()
    for (const m of eligible) {
      const root = find(m.id)
      if (!clustersByRoot.has(root)) clustersByRoot.set(root, [])
      clustersByRoot.get(root).push(m)
    }
    const duplicateClusters = [...clustersByRoot.values()].filter((g) => g.length > 1)
    const unsignable = 0
    if (duplicateClusters.length === 0) continue

    const tournamentPlan = { name: t.name, id: t.id, clusters: [] }

    for (const group of duplicateClusters) {
      // Pick survivor: highest completeness score, ties broken by the
      // newest updated_at (stable behaviour across re-runs).
      group.sort((a, b) => {
        const ds = completenessScore(b) - completenessScore(a)
        if (ds !== 0) return ds
        return (b.updated_at ?? '').localeCompare(a.updated_at ?? '')
      })
      const [survivor, ...dupes] = group

      // Field migration: copy non-null values from dupes onto survivor
      // when survivor's column is null. Multi-dupe: first non-null wins
      // (in dedup-already-sorted order).
      const migrate = {}
      const FIELDS = [
        'widget_id_composite',
        'padelapi_id',
        'finished_at',
        'scheduled_at',
        'court',
        'winner_pair',
        'status',
      ]
      for (const f of FIELDS) {
        if (survivor[f] != null) continue
        for (const d of dupes) {
          if (d[f] != null) { migrate[f] = d[f]; break }
        }
      }
      // Special case: survivor's scheduled_at is the midnight-UTC
      // date-only sentinel (no real time). If any dupe has a real time,
      // overwrite with the better value. This catches the padelapi-vs-
      // padelgod FIP case where the survivor selection still landed on
      // padelapi (e.g. dupe didn't have widget_id_composite either).
      if (survivor.scheduled_at && !hasRealScheduledAt(survivor)) {
        for (const d of dupes) {
          if (hasRealScheduledAt(d)) { migrate.scheduled_at = d.scheduled_at; break }
        }
      }

      // Children: if survivor has 0 sets, take sets from the dupe with
      // most sets. Otherwise we'll delete the dupes' sets/games.
      const setCounts = await Promise.all(
        group.map(g => s.from('sets').select('id', { count: 'exact', head: true }).eq('match_id', g.id).then(r => r.count ?? 0)),
      )
      const survivorSetCount = setCounts[0]
      let setMigrationFromId = null
      if (survivorSetCount === 0) {
        for (let i = 1; i < group.length; i++) {
          if (setCounts[i] > 0) { setMigrationFromId = group[i].id; break }
        }
      }

      tournamentPlan.clusters.push({
        survivor,
        dupes,
        migrate,
        setCounts,
        setMigrationFromId,
        signature: group[0] ? matchSignature(group[0], playerNameById) : null,
        round: normRound(survivor.round),
        category: survivor.category,
      })
      totalPlanned += dupes.length
      totalGroups++
    }

    if (tournamentPlan.clusters.length > 0) planByTournament.push(tournamentPlan)
    if (unsignable > 0) totalSkipped += unsignable
  }

  console.log(`Duplicate clusters across all tournaments: ${totalGroups}`)
  console.log(`Total rows to delete: ${totalPlanned}`)
  console.log(`Rows skipped (insufficient player data for signature): ${totalSkipped}\n`)

  // 4. Print plan
  for (const tp of planByTournament) {
    console.log(`⚠ ${tp.name}`)
    console.log(`  ${tp.id}`)
    for (const c of tp.clusters) {
      console.log(`  ${c.category} ${c.round} [${c.signature}]`)
      const sourceSig = (m) =>
        m.padelapi_id && /^\d+$/.test(m.padelapi_id) ? `padelapi=${m.padelapi_id}`
        : m.padelapi_id ? `padelapi=${m.padelapi_id.slice(0, 30)}…`
        : m.widget_id_composite ? `widget=${m.widget_id_composite}`
        : 'no source-id'
      console.log(`    keep   ${c.survivor.id.slice(0, 8)}.. round="${c.survivor.round}" ${sourceSig(c.survivor)} sets=${c.setCounts[0]} status=${c.survivor.status}`)
      c.dupes.forEach((d, i) => console.log(`    delete ${d.id.slice(0, 8)}.. round="${d.round}" ${sourceSig(d)} sets=${c.setCounts[i + 1]} status=${d.status}`))
      if (Object.keys(c.migrate).length > 0) {
        const ms = Object.entries(c.migrate).map(([k, v]) => `${k}=${String(v).slice(0, 20)}`).join(', ')
        console.log(`    migrate: ${ms}`)
      }
      if (c.setMigrationFromId) {
        console.log(`    sets: take from ${c.setMigrationFromId.slice(0, 8)}..`)
      }
    }
    console.log()
  }

  if (!apply) {
    console.log('[DRY RUN] No writes. Re-run with --apply to execute.')
    return
  }

  // 5. Apply
  // Per-cluster execution order matters: the survivor's field
  // migration (e.g., widget_id_composite=X) would race with the dupe
  // that still holds X — Postgres would reject with a UNIQUE
  // constraint violation. So:
  //   1. Migrate sets to survivor (when survivor has none and a dupe
  //      has them) before deleting that dupe.
  //   2. Delete each dupe's children (sets, games) and the dupe row.
  //   3. ONLY AFTER all dupes are gone, update the survivor with the
  //      migrated fields. The widget the dupe held is now free.
  let deleted = 0, migrated = 0, setsMigrated = 0, setsDeleted = 0, gamesDeleted = 0, failed = 0
  for (const tp of planByTournament) {
    for (const c of tp.clusters) {
      try {
        // 1. Migrate sets/games children if survivor has none
        if (c.setMigrationFromId) {
          const { error: setErr } = await s.from('sets').update({ match_id: c.survivor.id }).eq('match_id', c.setMigrationFromId)
          if (setErr) throw new Error(`sets migrate: ${setErr.message}`)
          const { error: gameErr } = await s.from('games').update({ match_id: c.survivor.id }).eq('match_id', c.setMigrationFromId)
          if (gameErr) throw new Error(`games migrate: ${gameErr.message}`)
          setsMigrated++
        }
        // 2. Delete each dupe's remaining children + the dupe row
        for (const d of c.dupes) {
          if (d.id !== c.setMigrationFromId) {
            const { error: setDelErr, count: setN } = await s.from('sets').delete({ count: 'exact' }).eq('match_id', d.id)
            if (setDelErr) throw new Error(`set delete: ${setDelErr.message}`)
            setsDeleted += setN ?? 0
            const { error: gameDelErr, count: gameN } = await s.from('games').delete({ count: 'exact' }).eq('match_id', d.id)
            if (gameDelErr) throw new Error(`game delete: ${gameDelErr.message}`)
            gamesDeleted += gameN ?? 0
          }
          const { error: matchErr } = await s.from('matches').delete().eq('id', d.id)
          if (matchErr) throw new Error(`match delete: ${matchErr.message}`)
          deleted++
        }
        // 3. NOW migrate fields onto the survivor — unique constraints
        //    are free because every dupe is gone.
        if (Object.keys(c.migrate).length > 0) {
          const { error } = await s.from('matches').update(c.migrate).eq('id', c.survivor.id)
          if (error) throw new Error(`survivor field migrate: ${error.message}`)
          migrated++
        }
      } catch (e) {
        console.log(`  ✗ cluster ${c.category} ${c.round} ${c.signature}: ${e.message}`)
        failed++
      }
    }
  }

  console.log(`\nDone.`)
  console.log(`  matches deleted:       ${deleted}`)
  console.log(`  field migrations:      ${migrated}`)
  console.log(`  sets migrated to surv: ${setsMigrated}`)
  console.log(`  sets deleted:          ${setsDeleted}`)
  console.log(`  games deleted:         ${gamesDeleted}`)
  console.log(`  failed clusters:       ${failed}`)
}

main().catch((e) => { console.error(e); process.exit(1) })

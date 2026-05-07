#!/usr/bin/env node
/**
 * dedup-slug-players — clean up the 838 slug-style padelapi_id duplicates
 * that PlayerResolver minted in 2026-03/04 before the synthesis fix shipped.
 *
 * For each candidate slug row, find the canonical record via:
 *   - Same category + country
 *   - Has a real source ID (numeric padelapi_id OR fip_id)
 *   - Token-subset similarity >= configurable threshold
 *   - Lastname-anchor match for initial-style names like "M Akkouch"
 *
 * If a canonical match exists:
 *   1. Register the slug row's display name as an alias on canonical
 *      (requires the 20260507_alias_partial_unique.sql migration applied)
 *   2. Migrate FKs: matches.pair*_player_id, tournament_draws.player1/2_id,
 *      entity_external_ids.entity_id, player_equipment, racket_clicks
 *   3. Delete the slug row
 *
 * Run modes:
 *   node scripts/dedup-slug-players.mjs                  # dry-run, all rows
 *   node scripts/dedup-slug-players.mjs --execute        # destructive, all rows
 *   node scripts/dedup-slug-players.mjs --limit 20       # dry-run, first 20
 *   node scripts/dedup-slug-players.mjs --player <uuid>  # single row (debug)
 *
 * Usage from worktree:
 *   cd /Users/GuDenes/Projects/padel-live-scores
 *   node .claude/worktrees/jovial-dhawan-292a5c/scripts/dedup-slug-players.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

// ── env ──
const env = Object.fromEntries(
  readFileSync('/Users/GuDenes/Projects/padel-live-scores/.env.local', 'utf8')
    .split('\n').filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }),
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

// ── args ──
const args = process.argv.slice(2)
const EXECUTE = args.includes('--execute')
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : null
const ONLY_PLAYER = args.includes('--player') ? args[args.indexOf('--player') + 1] : null
const SUBSET_THRESHOLD = 0.8

// ── name helpers (mirror src/lib/player-resolver.ts) ──
function normalize(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
}
function tokens(name) {
  return new Set(normalize(name).split(' ').filter(t => t.length > 1))
}
function subsetSimilarity(a, b) {
  const ta = tokens(a), tb = tokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let overlap = 0
  for (const t of ta) if (tb.has(t)) overlap++
  return overlap / Math.min(ta.size, tb.size)
}

// ── load all slug-style players ──
async function loadSlugRows() {
  const all = []
  let from = 0
  const pageSize = 1000
  const slugRe = /^[a-z][a-z0-9-]+$/, numericRe = /^\d+$/
  while (true) {
    const { data, error } = await sb
      .from('players')
      .select('id, name, padelapi_id, fip_id, external_id, country, category, created_at, total_matches, ranking, slug')
      .not('padelapi_id', 'is', null)
      .range(from, from + pageSize - 1)
    if (error) throw error
    for (const r of data) {
      const pid = r.padelapi_id ?? ''
      if (slugRe.test(pid) && !numericRe.test(pid)) all.push(r)
    }
    if (data.length < pageSize) break
    from += pageSize
  }
  return all
}

// ── load canonical pool: rows with a REAL source ID, indexed for fast lookup ──
async function loadCanonicalPool() {
  const all = []
  let from = 0
  const pageSize = 1000
  const numericRe = /^\d+$/
  while (true) {
    const { data, error } = await sb
      .from('players')
      .select('id, name, padelapi_id, fip_id, country, category, ranking')
      .range(from, from + pageSize - 1)
    if (error) throw error
    for (const p of data) {
      const hasFip = !!p.fip_id
      const hasNumericPid = !!p.padelapi_id && numericRe.test(p.padelapi_id)
      if (hasFip || hasNumericPid) all.push(p)
    }
    if (data.length < pageSize) break
    from += pageSize
  }
  // Index by category for faster scan
  const byCategory = new Map()
  for (const p of all) {
    if (!p.category) continue
    if (!byCategory.has(p.category)) byCategory.set(p.category, [])
    byCategory.get(p.category).push(p)
  }
  return { all, byCategory }
}

// ── matching strategy ──
function findCanonical(slugRow, pool) {
  const slugTokens = tokens(slugRow.name)
  if (slugTokens.size === 0) return null

  // Filter pool to same category, excluding the slug row itself (slug rows
  // with a fip_id qualify as canonical and would otherwise self-match).
  // Country prefers exact match, but if both sides are NULL we still allow
  // the match.
  const candidates = (pool.byCategory.get(slugRow.category) ?? []).filter(p => {
    if (p.id === slugRow.id) return false
    if (slugRow.country && p.country && slugRow.country !== p.country) return false
    return true
  })

  // Initial-style: only ONE meaningful token after filtering 1-letter tokens.
  // The token is the surname. Match if any candidate has it AND the leading
  // initial of the slug name (if any) matches a token starting with it.
  if (slugTokens.size === 1) {
    const surname = [...slugTokens][0]
    const initial = (slugRow.name.match(/^([A-Za-z])\s/) ?? [])[1]?.toLowerCase() ?? null
    const matches = candidates.filter(c => {
      const ct = tokens(c.name)
      if (!ct.has(surname)) return false
      if (initial) return [...ct].some(t => t.startsWith(initial) && t !== surname)
      return true
    })
    if (matches.length === 0) return null
    // Prefer fip_id over numeric padelapi only, then highest ranking (most likely the canonical).
    matches.sort((a, b) => {
      const aHasFip = a.fip_id ? 1 : 0
      const bHasFip = b.fip_id ? 1 : 0
      if (aHasFip !== bHasFip) return bHasFip - aHasFip
      return (a.ranking ?? 9999) - (b.ranking ?? 9999)
    })
    return { canonical: matches[0], score: matches.length === 1 ? 1 : 0.9, reason: `initial-style surname=${surname} initial=${initial ?? '-'} (${matches.length} candidates)` }
  }

  // Multi-token: subset similarity. We require slug tokens to be a subset of
  // candidate tokens (slug shorter or equal). If slug has MORE tokens than
  // candidate, also try the reverse — common case: slug is the long FIP
  // legal name, canonical is the short stage name.
  let best = null, bestScore = 0, reason = ''
  for (const c of candidates) {
    const candTokens = tokens(c.name)
    if (candTokens.size === 0) continue
    const sim = subsetSimilarity(slugRow.name, c.name)
    if (sim >= SUBSET_THRESHOLD && sim > bestScore) {
      bestScore = sim
      best = c
      reason = `subset sim=${sim.toFixed(2)} slug=${slugTokens.size} cand=${candTokens.size}`
    }
  }
  if (!best) return null
  return { canonical: best, score: bestScore, reason }
}

// ── FK migration helpers ──
//
// "Authoritative" tables get UPDATE — the row encodes a real fact about the
// player (who played which match, who owns which racket). "Derived" tables
// get DELETE — the row is recomputed by a backfill or a sync job, so we
// can safely drop slug-side rows; the next backfill regenerates them on
// canonical with correct values (and avoids composite-PK collisions).
async function migrateFks(slugId, canonicalId) {
  // Authoritative — UPDATE
  for (const col of ['pair1_player1_id', 'pair1_player2_id', 'pair2_player1_id', 'pair2_player2_id']) {
    const { error } = await sb.from('matches').update({ [col]: canonicalId }).eq(col, slugId)
    if (error) throw new Error(`matches.${col} migrate failed: ${error.message}`)
  }
  for (const col of ['player1_id', 'player2_id']) {
    const { error } = await sb.from('tournament_draws').update({ [col]: canonicalId }).eq(col, slugId)
    if (error) throw new Error(`tournament_draws.${col} migrate failed: ${error.message}`)
  }
  for (const tbl of ['player_equipment', 'racket_clicks']) {
    const { error } = await sb.from(tbl).update({ player_id: canonicalId }).eq('player_id', slugId)
    if (error) throw new Error(`${tbl} migrate failed: ${error.message}`)
  }
  // games.server_player_id — set on live-tracked matches; UPDATE if any.
  {
    const { error } = await sb.from('games').update({ server_player_id: canonicalId }).eq('server_player_id', slugId)
    if (error) throw new Error(`games.server_player_id migrate failed: ${error.message}`)
  }
  // entity_external_ids: re-point any non-alias rows. Alias rows are handled
  // separately by migrateAliasRows + registerAlias.
  {
    const { error } = await sb
      .from('entity_external_ids')
      .update({ entity_id: canonicalId })
      .eq('entity_type', 'player')
      .eq('entity_id', slugId)
      .neq('source', 'alias')
    if (error) throw new Error(`entity_external_ids migrate failed: ${error.message}`)
  }

  // Derived — DELETE slug-side rows. The next backfill regenerates them on
  // canonical (idempotent by composite unique).
  // - player_tournament_earnings: rebuilt by scripts/backfill-player-earnings.ts
  //   from finished matches. After our FK migration above, all of slug's
  //   matches now belong to canonical, so the next backfill computes correct
  //   per-player totals on canonical.
  // - article_players, highlight_players: junction tables for content tagging
  //   (currently empty in production). Cascade-on-delete is the existing
  //   semantic; we just trigger it explicitly so the player delete doesn't
  //   block.
  for (const tbl of ['player_tournament_earnings', 'article_players', 'highlight_players']) {
    const { error } = await sb.from(tbl).delete().eq('player_id', slugId)
    if (error) throw new Error(`${tbl} delete failed: ${error.message}`)
  }
}

async function registerAlias(canonicalId, rawName) {
  const { error } = await sb
    .from('entity_external_ids')
    .upsert({
      entity_type: 'player',
      entity_id: canonicalId,
      source: 'alias',
      external_id: rawName,
      metadata: { normalized: normalize(rawName) },
      last_seen_at: new Date().toISOString(),
    }, { onConflict: 'source,entity_type,external_id' })
  if (error) throw new Error(`alias register failed (${rawName}): ${error.message}`)
}

async function migrateAliasRows(slugId, canonicalId) {
  // Move any alias rows attached to the slug record over to canonical, so
  // we don't lose previously-recorded variants. With the partial-unique
  // index, multiple alias rows per (entity, 'alias') are allowed — but a
  // collision on (source, entity_type, external_id) is still possible if
  // both rows store the same raw name. Drop the slug-side row in that case.
  const { data: slugAliases } = await sb
    .from('entity_external_ids')
    .select('id, external_id, metadata, first_seen_at')
    .eq('entity_type', 'player')
    .eq('entity_id', slugId)
    .eq('source', 'alias')
  for (const a of slugAliases ?? []) {
    // Use UPDATE so we keep the row's first_seen_at audit trail.
    const { error } = await sb
      .from('entity_external_ids')
      .update({ entity_id: canonicalId })
      .eq('id', a.id)
    if (error && error.code === '23505') {
      // Existing row on canonical with the same external_id — delete the slug-side dup.
      await sb.from('entity_external_ids').delete().eq('id', a.id)
    } else if (error) {
      throw new Error(`alias move failed: ${error.message}`)
    }
  }
}

// ── main ──
async function main() {
  console.log(`Mode: ${EXECUTE ? 'EXECUTE (writes will happen)' : 'DRY RUN (no writes)'}`)
  console.log(`Threshold (multi-token subset): ${SUBSET_THRESHOLD}`)

  const slugRows = ONLY_PLAYER
    ? (await sb.from('players').select('id, name, padelapi_id, fip_id, external_id, country, category, created_at, total_matches, ranking, slug').eq('id', ONLY_PLAYER)).data
    : await loadSlugRows()

  console.log(`Loaded ${slugRows.length} slug-style player rows`)

  const limited = LIMIT ? slugRows.slice(0, LIMIT) : slugRows
  console.log(`Processing ${limited.length}`)

  console.log('Loading canonical pool...')
  const pool = await loadCanonicalPool()
  console.log(`Canonical pool: ${pool.all.length} (men=${pool.byCategory.get('men')?.length ?? 0}, women=${pool.byCategory.get('women')?.length ?? 0})`)

  const stats = { merged: 0, selfClean: 0, leftAlone: 0, errors: 0 }
  const planLines = []

  for (const slug of limited) {
    const match = findCanonical(slug, pool)
    if (match) {
      const { canonical, reason } = match
      const line = `MERGE   ${slug.id.slice(0, 8)} '${slug.name}' (${slug.country ?? '--'}/${slug.category}) → ${canonical.id.slice(0, 8)} '${canonical.name}' [${reason}]`
      planLines.push(line)
      stats.merged++

      if (EXECUTE) {
        try {
          await migrateAliasRows(slug.id, canonical.id)
          await registerAlias(canonical.id, slug.name)
          await migrateFks(slug.id, canonical.id)
          const { error: delErr } = await sb.from('players').delete().eq('id', slug.id)
          if (delErr) throw new Error(`delete failed: ${delErr.message}`)
        } catch (err) {
          stats.errors++
          planLines[planLines.length - 1] = `ERROR   ${slug.id.slice(0, 8)} '${slug.name}' → ${canonical.id.slice(0, 8)} (${err.message})`
        }
      }
    } else if (slug.fip_id) {
      // Row has a real fip_id — it's a legit player record that just inherited
      // a slug-style padelapi_id during the regression window. NULL out the
      // synthetic padelapi_id (and external_id, kept in sync via trigger) so
      // the row stops appearing as a "fake padelapi" entry. Keep the row.
      planLines.push(`CLEAN   ${slug.id.slice(0, 8)} '${slug.name}' (${slug.country ?? '--'}/${slug.category}) fip=${slug.fip_id} — clearing padelapi_id='${slug.padelapi_id}'`)
      stats.selfClean++
      if (EXECUTE) {
        try {
          const { error } = await sb
            .from('players')
            .update({ padelapi_id: null, external_id: null })
            .eq('id', slug.id)
          if (error) throw new Error(`self-clean failed: ${error.message}`)
        } catch (err) {
          stats.errors++
          planLines[planLines.length - 1] = `ERROR   ${slug.id.slice(0, 8)} self-clean (${err.message})`
        }
      }
    } else {
      stats.leftAlone++
      planLines.push(`LEAVE   ${slug.id.slice(0, 8)} ${slug.country ?? '--'} ${slug.category} '${slug.name}' (no canonical match, no fip_id)`)
    }
  }

  // Print plan (truncate if huge)
  const showAll = limited.length <= 60
  for (const line of planLines.slice(0, showAll ? planLines.length : 30)) console.log(line)
  if (!showAll) {
    console.log(`... (${planLines.length - 30} more rows)`)
  }

  console.log('\n──────── summary ────────')
  console.log(`Total processed: ${limited.length}`)
  console.log(`Mergeable (slug → canonical, alias added): ${stats.merged}`)
  console.log(`Self-clean (legit row, slug padelapi_id cleared): ${stats.selfClean}`)
  console.log(`Left alone (no canonical match, no fip_id): ${stats.leftAlone}`)
  if (EXECUTE) console.log(`Errors: ${stats.errors}`)
  if (!EXECUTE) console.log('\n(Re-run with --execute to apply.)')
}

main().catch(err => { console.error(err); process.exit(1) })

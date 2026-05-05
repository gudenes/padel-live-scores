#!/usr/bin/env node
// scripts/find-duplicate-players.mjs
//
// Read-only scan of `public.players` for likely duplicates left over from
// the padelapi → FIP migration. Mirrors the rules-based logic in
// /api/ops/duplicate-scan but tightens the rank-diff threshold to 5
// (per the criteria: "same surname, same country, similar position in
// the ranking").
//
// Match criteria for a candidate pair (broadened from the original
// duplicate-scan endpoint to handle Spanish double-surname names that
// the FIP/padelapi pipelines write inconsistently — "David Gala
// Sanchez" (FIP) vs "David Gala" (padelapi) was being missed because
// the last token differed):
//
//   1. Same country (ISO 2-letter, exact)
//   2. First name matches: either same token OR one side is a single
//      letter that matches the other's first letter ("J Diestro" =
//      "Jose Antonio Diestro")
//   3. At least ONE surname token (any non-first token, normalized) is
//      shared between the two names. Catches:
//         - "David Gala Sanchez" ↔ "David Gala"     (gala matches)
//         - "Guillermo Collado Losada" ↔ "Guillermo Collado"
//         - "D Gala Sanchez" ↔ "David Gala Sanchez"
//      Rejects:
//         - "Tolito Aguirre" ↔ "Leonel Daniel Aguirre" (first names differ)
//   4. If both ranked: |rankA - rankB| ≤ MAX_RANK_DIFF
//      Else: kept as candidate (one side likely un-migrated)
//
// Usage:
//   node scripts/find-duplicate-players.mjs
//   node scripts/find-duplicate-players.mjs --category=men
//   node scripts/find-duplicate-players.mjs --category=women
//   node scripts/find-duplicate-players.mjs --max-rank-diff=10 --min-rank-only
//
// Reads from .env.local (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_KEY).
// Output is a plain table grouped by country, sorted by rank.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve as pathResolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = pathResolve(__dirname, '..')

// ── env loader (avoids the dotenv dep) ─────────────────────────────
function loadEnv() {
  try {
    const raw = readFileSync(pathResolve(ROOT, '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (!m) continue
      const [, k, v] = m
      if (!process.env[k]) process.env[k] = v.replace(/^"|"$/g, '')
    }
  } catch {
    // .env.local optional — env may already be set
  }
}
loadEnv()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ── args ────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)
const CATEGORY = args.category ?? null // 'men' | 'women' | null (both)
const MAX_RANK_DIFF = parseInt(args['max-rank-diff'] ?? '5', 10)
const MIN_RANK_ONLY = !!args['min-rank-only']

// ── name + country normalization ────────────────────────────────────
function normalize(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function nameTokens(name) {
  // Single-letter first-name initials ("J Diestro") are kept; everything
  // else of length 1 is dropped. The first token is the given name; all
  // remaining tokens are candidate surnames (Spanish double-surname
  // common, "Adrián Rodríguez Rodríguez-Manzaneque" etc).
  const all = normalize(name).split(' ').filter((t) => t.length >= 1)
  if (all.length === 0) return { first: '', surnames: new Set() }
  if (all.length === 1) return { first: all[0], surnames: new Set() }
  return { first: all[0], surnames: new Set(all.slice(1).filter((t) => t.length >= 2)) }
}

function firstNamesMatch(a, b) {
  if (!a || !b) return false
  if (a === b) return true
  // Initial-vs-full match: "J" ↔ "Jose"
  if (a.length === 1 && b.startsWith(a)) return true
  if (b.length === 1 && a.startsWith(b)) return true
  return false
}

function shareAnySurname(a, b) {
  for (const s of a) if (b.has(s)) return true
  return false
}

// ── paginated fetch (PostgREST 10k cap is fine; we have ~200k+) ─────
async function fetchAllPlayers() {
  const PAGE = 1000
  const out = []
  let from = 0
  while (true) {
    let q = supabase
      .from('players')
      .select('id, name, country, ranking, points, category, fip_id, external_id, padelapi_id')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (CATEGORY) q = q.eq('category', CATEGORY)
    const { data, error } = await q
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return out
}

// ── pairing — bucket by (country, surname-token) for O(n + bucket²) ─
// Each player is indexed under EVERY surname token they have, so a
// double-surname player ("David Gala Sanchez") lands in both the
// "gala" bucket and the "sanchez" bucket. We dedupe pair keys after.
function findCandidatePairs(players) {
  const buckets = new Map()
  for (const p of players) {
    if (!p.country || !p.name) continue
    const tok = nameTokens(p.name)
    if (tok.surnames.size === 0) continue
    for (const s of tok.surnames) {
      const key = `${p.country}::${s}`
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key).push({ p, tok })
    }
  }

  const seenPairs = new Set()
  const pairs = []
  for (const [, list] of buckets) {
    if (list.length < 2) continue
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]
        const b = list[j]
        const pairKey = [a.p.id, b.p.id].sort().join('|')
        if (seenPairs.has(pairKey)) continue

        // Always require same category (men vs men, women vs women) —
        // protects against cross-gender surname collisions.
        if (a.p.category && b.p.category && a.p.category !== b.p.category) continue
        // (Surname overlap is guaranteed by bucketing.)
        if (!shareAnySurname(a.tok.surnames, b.tok.surnames)) continue

        const aRanked = a.p.ranking !== null && a.p.ranking !== undefined
        const bRanked = b.p.ranking !== null && b.p.ranking !== undefined
        const firstMatch = firstNamesMatch(a.tok.first, b.tok.first)

        let entry = null
        if (firstMatch) {
          if (aRanked && bRanked) {
            const diff = Math.abs(a.p.ranking - b.p.ranking)
            if (diff > MAX_RANK_DIFF) continue
            entry = { a: a.p, b: b.p, reason: `rank diff ${diff}`, sortKey: Math.min(a.p.ranking, b.p.ranking) }
          } else if (!MIN_RANK_ONLY) {
            const reason = aRanked || bRanked ? 'one ranked, one unranked' : 'both unranked'
            entry = { a: a.p, b: b.p, reason, sortKey: a.p.ranking ?? b.p.ranking ?? 999_999 }
          }
        } else {
          // Different first names — possible nickname collision
          // ("Tolito" / "Leonel Daniel" Aguirre). Tight criteria to
          // suppress false positives:
          //   1. Both ranked
          //   2. Rank diff ≤ 3 (tighter than the main threshold)
          //   3. One side's surname set is a subset of the other's
          //   4. **Source asymmetry**: one side must be padelapi-only,
          //      the other must have fip_id. Migration dupes always
          //      look like this (the un-migrated padelapi record vs
          //      the FIP-resolved real player). Two fip+padelapi rows
          //      are almost always genuinely different people sharing
          //      a surname (siblings, common surname, etc).
          if (!aRanked || !bRanked) continue
          const diff = Math.abs(a.p.ranking - b.p.ranking)
          if (diff > Math.min(MAX_RANK_DIFF, 3)) continue
          const aSub = [...a.tok.surnames].every((s) => b.tok.surnames.has(s))
          const bSub = [...b.tok.surnames].every((s) => a.tok.surnames.has(s))
          if (!aSub && !bSub) continue
          const aHasFip = !!a.p.fip_id
          const bHasFip = !!b.p.fip_id
          if (aHasFip === bHasFip) continue
          entry = {
            a: a.p, b: b.p,
            reason: `nickname? rank diff ${diff} (different first names, padelapi↔fip asymmetry)`,
            sortKey: Math.min(a.p.ranking, b.p.ranking),
          }
        }
        if (entry) {
          seenPairs.add(pairKey)
          pairs.push(entry)
        }
      }
    }
  }
  pairs.sort((x, y) => x.sortKey - y.sortKey)
  return pairs
}

// ── output ──────────────────────────────────────────────────────────
function fmtRank(r) {
  return r === null || r === undefined ? '—' : String(r).padStart(4, ' ')
}
function fmtPoints(p) {
  return p === null || p === undefined ? '—' : String(p)
}
function sourceTag(p) {
  const tags = []
  if (p.fip_id) tags.push('fip')
  if (p.padelapi_id || p.external_id) tags.push('padelapi')
  return tags.length ? tags.join('+') : 'no-src'
}

function printPair({ a, b, reason }) {
  const country = a.country ?? '??'
  console.log(
    `[${country}] ${reason}\n` +
      `  A  ${fmtRank(a.ranking)}  ${a.name.padEnd(35)} pts=${fmtPoints(a.points).padStart(5)}  ${sourceTag(a).padEnd(12)} ${a.id}\n` +
      `  B  ${fmtRank(b.ranking)}  ${b.name.padEnd(35)} pts=${fmtPoints(b.points).padStart(5)}  ${sourceTag(b).padEnd(12)} ${b.id}`,
  )
}

;(async () => {
  console.log(
    `Scanning players… (category=${CATEGORY ?? 'both'}, max rank diff=${MAX_RANK_DIFF}, ` +
      `min-rank-only=${MIN_RANK_ONLY})\n`,
  )
  const players = await fetchAllPlayers()
  console.log(`Loaded ${players.length} players.\n`)

  const pairs = findCandidatePairs(players)
  if (pairs.length === 0) {
    console.log('No candidate duplicates found.')
    return
  }

  const byCategory = { 'rank diff': 0, nickname: 0, 'one ranked, one unranked': 0, 'both unranked': 0 }
  for (const p of pairs) {
    if (p.reason.startsWith('nickname?')) byCategory.nickname++
    else if (p.reason.startsWith('rank diff')) byCategory['rank diff']++
    else if (p.reason.includes('one ranked')) byCategory['one ranked, one unranked']++
    else byCategory['both unranked']++
  }

  console.log(`Found ${pairs.length} candidate duplicate pair(s):`)
  console.log(
    `  - ${byCategory['rank diff']} both-ranked, same first name (strongest signal)\n` +
      `  - ${byCategory.nickname} both-ranked, DIFFERENT first names — possible nickname (manual/AI review)\n` +
      `  - ${byCategory['one ranked, one unranked']} one-ranked, one-unranked\n` +
      `  - ${byCategory['both unranked']} both-unranked\n`,
  )

  console.log('━'.repeat(100))
  for (const pair of pairs) {
    printPair(pair)
    console.log('─'.repeat(100))
  }

  console.log(
    `\nReview the list, then merge survivors via the ops dashboard:\n` +
      `  https://padelnachos.com/ops?token=$CRON_SECRET → Players tab → Search by name → Merge\n` +
      `\nTo verify a specific candidate before merging, paste either UUID into the Players tab search.`,
  )
})().catch((e) => {
  console.error(e)
  process.exit(1)
})

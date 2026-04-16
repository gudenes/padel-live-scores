// scripts/backfill-tiebreak-scores.ts
//
// Sweeps finished matches whose set_score is a bare "7-6" or "6-7" (no
// tb bracket) and refetches the authoritative score from padelapi.org's
// /api/matches/{id} endpoint, which returns the proper "7-6(X)" format.
// Without the bracket, the UI can't render the loser's tiebreak points
// as a superscript.
//
// Usage:
//   npx tsx scripts/backfill-tiebreak-scores.ts --dry-run
//   npx tsx scripts/backfill-tiebreak-scores.ts
//   npx tsx scripts/backfill-tiebreak-scores.ts --limit 20

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!
const PADELAPI_TOKEN = process.env.PADELAPI_TOKEN!

if (!SUPABASE_URL || !SUPABASE_KEY || !PADELAPI_TOKEN) {
  console.error('Missing env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY, PADELAPI_TOKEN')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const LIMIT_IDX = args.indexOf('--limit')
const LIMIT = LIMIT_IDX >= 0 ? parseInt(args[LIMIT_IDX + 1] ?? '500') : 500

async function fetchMatchDetail(externalId: string): Promise<{ score: Array<{ team_1: string; team_2: string }> | null } | null> {
  try {
    const res = await fetch(`https://padelapi.org/api/matches/${externalId}`, {
      headers: { Authorization: `Bearer ${PADELAPI_TOKEN}` },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function main() {
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Scanning for finished matches with bare 7-6/6-7 set scores (limit=${LIMIT})...`)

  // Find candidate matches — pull matches whose tiebreak sets need bracket repair
  const { data: stuckSets, error } = await supabase
    .from('sets')
    .select('match_id, set_number, set_score, matches:match_id(external_id, status, finished_at)')
    .in('set_score', ['7-6', '6-7'])
    .order('match_id')

  if (error) {
    console.error('Query failed:', error)
    process.exit(1)
  }

  // Group by match_id and filter to finished matches with padelapi-sourced
  // IDs (skip FIP and other non-padelapi sources — they won't resolve)
  const byMatch = new Map<string, { externalId: string; stuckSets: number[] }>()
  type Row = { match_id: string; set_number: number; matches: { external_id: string; status: string } | Array<{ external_id: string; status: string }> | null }
  for (const row of (stuckSets ?? []) as unknown as Row[]) {
    // PostgREST can return the embedded relation either as a single object
    // (when the FK resolves to one row) or as an array. Handle both.
    const m = Array.isArray(row.matches) ? row.matches[0] : row.matches
    if (!m || m.status !== 'finished' || !m.external_id) continue
    if (!/^\d+$/.test(m.external_id)) continue // skip fip-* etc.
    const existing: { externalId: string; stuckSets: number[] } =
      byMatch.get(row.match_id) ?? { externalId: m.external_id, stuckSets: [] }
    existing.stuckSets.push(row.set_number)
    byMatch.set(row.match_id, existing)
  }

  const matches = Array.from(byMatch.entries()).slice(0, LIMIT)
  console.log(`Found ${byMatch.size} matches to fix${matches.length < byMatch.size ? ` (processing ${matches.length} this run)` : ''}`)

  let fixed = 0
  let skipped = 0
  let apiFailed = 0
  let noChange = 0

  for (const [matchId, info] of matches) {
    const detail = await fetchMatchDetail(info.externalId)

    if (!detail?.score || !Array.isArray(detail.score)) {
      apiFailed++
      console.log(`  ✗ padelapi_id=${info.externalId} — no score in detail endpoint`)
      continue
    }

    // For each stuck set, check if detail has the bracket form
    let updatedAny = false
    for (const setNum of info.stuckSets) {
      const detailSet = detail.score[setNum - 1]
      if (!detailSet) continue

      const apiScore = `${detailSet.team_1}-${detailSet.team_2}`
      // Only update if detail has the bracket form
      if (!apiScore.includes('(')) {
        continue
      }

      if (DRY_RUN) {
        console.log(`  [DRY] padelapi_id=${info.externalId} set${setNum}: "7-6" → "${apiScore}"`)
        updatedAny = true
      } else {
        const { error: updErr } = await supabase
          .from('sets')
          .update({ set_score: apiScore, score_source: 'api' })
          .eq('match_id', matchId)
          .eq('set_number', setNum)
        if (updErr) {
          console.error(`  ✗ padelapi_id=${info.externalId} set${setNum}: update failed`, updErr)
        } else {
          console.log(`  ✓ padelapi_id=${info.externalId} set${setNum}: "${apiScore}"`)
          updatedAny = true
        }
      }
    }

    if (updatedAny) fixed++
    else noChange++

    // Throttle — padelapi has 10 req/min limit
    await new Promise(r => setTimeout(r, 100))
  }

  console.log('')
  console.log(`Done${DRY_RUN ? ' (dry run)' : ''}.`)
  console.log(`  Fixed:      ${fixed}`)
  console.log(`  No change:  ${noChange} (detail endpoint didn't have bracket form)`)
  console.log(`  API failed: ${apiFailed}`)
  console.log(`  Skipped:    ${skipped}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

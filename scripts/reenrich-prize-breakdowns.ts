/**
 * Re-enrich prize_breakdown on tournaments where the stored value is missing
 * OR corrupted.
 *
 * Two candidate sets (both gated on fip_id IS NOT NULL AND ends_at >= 2024):
 *   1. prize_breakdown IS NULL — the original Phase 1 PR 3 bucket-C target
 *      (parser previously missed a parseable page).
 *   2. prize_breakdown is ×100-INFLATED — written by the legacy comma-strip
 *      parser ("807,50" → 80750). Detected via isBreakdownInflated(). The
 *      fixed parsePrizeBreakdown() now produces correct decimal values, so
 *      we re-scrape and overwrite.
 *
 * Fetches each FIP event page, runs the fixed parsePrizeBreakdown(), writes
 * the result. For set 2, only overwrites when the fresh parse is itself NOT
 * inflated (guards against re-writing garbage if a page regressed).
 *
 * Idempotent: rows whose parser returns null on this run are left untouched.
 *
 * Throttled to 1 req/sec to be polite to padelfip.com.
 *
 * Note: imports parsePrizeBreakdown / isBreakdownInflated from
 * src/lib/prize-breakdown-parser.ts (a mirror of
 * padelgod/src/parsers/fip-event-page-detail.ts) because the top-level
 * tsconfig excludes padelgod/ and the cross-package import doesn't resolve.
 *
 * Usage:
 *   npx tsx scripts/reenrich-prize-breakdowns.ts            # dry run
 *   npx tsx scripts/reenrich-prize-breakdowns.ts --apply    # write
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parsePrizeBreakdown, isBreakdownInflated } from '../src/lib/prize-breakdown-parser'

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
  { auth: { persistSession: false } },
)

const APPLY = process.argv.includes('--apply')
const THROTTLE_MS = 1000  // be polite

type CandidateReason = 'null' | 'inflated'

type Row = {
  id: string
  name: string
  level: string | null
  fip_id: string
  prize_breakdown: unknown
  reason: CandidateReason
}

function fipUrl(fipId: string): string {
  // fip_id is the slug like 'fip-bronze-qatar-doha-ii'. The hyphen-prefixed
  // 'fip-' is part of the slug; URL is /events/<slug>/.
  //
  // Defensive: a few rows carry a malformed double prefix
  // ('fip-fip-platinum-ville-de-marseille-2026') from a discovery glitch,
  // which 404s. Collapse it — no legitimate slug starts with 'fip-fip-'.
  const slug = fipId.replace(/^fip-fip-/, 'fip-')
  return `https://www.padelfip.com/events/${slug}/`
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (PadelNachos backfill)' } })
    if (!r.ok) return null
    return await r.text()
  } catch {
    return null
  }
}

type DbRow = { id: string; name: string; level: string | null; fip_id: string; prize_breakdown: unknown }

async function loadCandidates(): Promise<Row[]> {
  // Set 1 — missing breakdowns.
  const { data: nullData, error: nullErr } = await supabase
    .from('tournaments')
    .select('id, name, level, fip_id, prize_breakdown')
    .is('prize_breakdown', null)
    .not('fip_id', 'is', null)
    .gte('ends_at', '2024-01-01')
    .order('ends_at', { ascending: false })
    .limit(5000)
    .returns<DbRow[]>()
  if (nullErr) throw new Error(`null-set read: ${nullErr.message}`)

  // Set 2 — non-null breakdowns (filter to inflated in JS; can't compare
  // jsonb numerics easily in PostgREST). Bounded well under the 10k cap.
  const { data: nonNullData, error: nonNullErr } = await supabase
    .from('tournaments')
    .select('id, name, level, fip_id, prize_breakdown')
    .not('prize_breakdown', 'is', null)
    .not('fip_id', 'is', null)
    .gte('ends_at', '2024-01-01')
    .order('ends_at', { ascending: false })
    .limit(5000)
    .returns<DbRow[]>()
  if (nonNullErr) throw new Error(`non-null-set read: ${nonNullErr.message}`)

  const out: Row[] = []
  for (const r of nullData ?? []) out.push({ ...r, reason: 'null' })
  for (const r of nonNullData ?? []) {
    const bd = r.prize_breakdown as Parameters<typeof isBreakdownInflated>[0]
    if (isBreakdownInflated(bd, r.level)) out.push({ ...r, reason: 'inflated' })
  }
  return out
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`)

  const rows = await loadCandidates()
  const nNull = rows.filter(r => r.reason === 'null').length
  const nInflated = rows.filter(r => r.reason === 'inflated').length
  console.log(`Candidates: ${rows.length}  (NULL=${nNull}, INFLATED=${nInflated})\n`)

  if (rows.length === 0) {
    console.log('Nothing to do.')
    return
  }

  let parsed = 0
  let stillMissing = 0
  let fetchFails = 0
  let stillInflated = 0  // inflated row whose fresh parse is ALSO inflated — skip
  const planned: { id: string; name: string; level: string | null; reason: CandidateReason; before: unknown; breakdown: unknown }[] = []
  const failedSamples: { id: string; name: string; reason: string }[] = []

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!
    if (i > 0) await new Promise(res => setTimeout(res, THROTTLE_MS))

    const html = await fetchHtml(fipUrl(r.fip_id))
    if (html == null) {
      fetchFails++
      if (failedSamples.length < 10) failedSamples.push({ id: r.id, name: r.name, reason: 'fetch failed' })
      continue
    }

    const breakdown = parsePrizeBreakdown(html)
    if (breakdown == null) {
      stillMissing++
      if (failedSamples.length < 10) failedSamples.push({ id: r.id, name: r.name, reason: 'parser returned null' })
      continue
    }

    // Guard: never overwrite a corrupted row with another corrupted parse.
    if (isBreakdownInflated(breakdown as Parameters<typeof isBreakdownInflated>[0], r.level)) {
      stillInflated++
      if (failedSamples.length < 10) failedSamples.push({ id: r.id, name: r.name, reason: 'fresh parse STILL inflated — skipped' })
      continue
    }

    parsed++
    planned.push({ id: r.id, name: r.name, level: r.level, reason: r.reason, before: r.prize_breakdown, breakdown })
    if (i % 20 === 0) console.log(`  [${i + 1}/${rows.length}] parsed=${parsed} stillMissing=${stillMissing} stillInflated=${stillInflated} fetchFails=${fetchFails}`)
  }

  // Report
  console.log(`\n=== Summary ===`)
  console.log(`Total candidates:    ${rows.length}`)
  console.log(`Parser hits:         ${parsed}  (will write)`)
  console.log(`Parser still null:   ${stillMissing}  (FIP page genuinely lacks breakdown)`)
  console.log(`Fresh-still-inflated:${stillInflated}  (skipped — page didn't yield a clean parse)`)
  console.log(`Fetch failures:      ${fetchFails}  (404, network errors)`)

  // Show the before→after for the inflated corrections (the interesting ones).
  const corrections = planned.filter(p => p.reason === 'inflated')
  if (corrections.length > 0) {
    console.log(`\nInflated → corrected (${corrections.length}):`)
    for (const p of corrections) {
      const b = p.before as Record<string, unknown> | null
      const a = p.breakdown as Record<string, unknown>
      console.log(`  ${p.name}`)
      console.log(`    winner ${b?.winner} → ${a.winner} | finalist ${b?.finalist} → ${a.finalist} | sf ${b?.sf} → ${a.sf} | qf ${b?.qf} → ${a.qf}`)
    }
  }

  if (failedSamples.length > 0) {
    console.log(`\nFailure samples (first 10):`)
    for (const s of failedSamples) console.log(`  [${s.id.slice(0, 8)}] ${s.name} — ${s.reason}`)
  }

  if (!APPLY) {
    console.log('\nDRY RUN. Re-run with --apply to write.')
    return
  }

  console.log(`\nWriting ${planned.length} rows...`)
  let written = 0
  for (const p of planned) {
    const { error: uErr } = await supabase
      .from('tournaments')
      .update({ prize_breakdown: p.breakdown })
      .eq('id', p.id)
    if (uErr) {
      console.error(`  WRITE FAIL [${p.id.slice(0, 8)}] ${p.name}: ${uErr.message}`)
      continue
    }
    written++
  }
  console.log(`\nWrote ${written} rows.`)
}

main().catch(e => { console.error(e); process.exit(1) })

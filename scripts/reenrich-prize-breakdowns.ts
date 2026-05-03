/**
 * Re-enrich prize_breakdown on tournaments where the FIP page has the data
 * but the previous parser run missed it (Phase 1 PR 3 bucket-C target).
 *
 * Loads tournaments with prize_breakdown IS NULL AND fip_id IS NOT NULL
 * AND ends_at >= 2024-01-01, fetches each FIP event page, runs the
 * fixed parsePrizeBreakdown(), writes the result.
 *
 * Idempotent: rows whose parser still returns null on this run are
 * left untouched (no clobbering of nulls — same null in, same null
 * out).
 *
 * Throttled to 1 req/sec to be polite to padelfip.com.
 *
 * Note: imports parsePrizeBreakdown from src/lib/prize-breakdown-parser.ts
 * (a mirror of padelgod/src/parsers/fip-event-page-detail.ts) because the
 * top-level tsconfig excludes padelgod/ and the cross-package import doesn't
 * resolve under tsc.
 *
 * Usage:
 *   npx tsx scripts/reenrich-prize-breakdowns.ts            # dry run
 *   npx tsx scripts/reenrich-prize-breakdowns.ts --apply    # write
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parsePrizeBreakdown } from '../src/lib/prize-breakdown-parser'

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

type Row = {
  id: string
  name: string
  level: string | null
  fip_id: string
}

function fipUrl(fipId: string): string {
  // fip_id is the slug like 'fip-bronze-qatar-doha-ii'. The hyphen-prefixed
  // 'fip-' is part of the slug; URL is /events/<slug>/.
  return `https://www.padelfip.com/events/${fipId}/`
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

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`)

  const { data, error } = await supabase
    .from('tournaments')
    .select('id, name, level, fip_id')
    .is('prize_breakdown', null)
    .not('fip_id', 'is', null)
    .gte('ends_at', '2024-01-01')
    .order('ends_at', { ascending: false })
    .limit(2000)
    .returns<Row[]>()

  if (error) throw new Error(`tournaments read: ${error.message}`)
  const rows = data ?? []
  console.log(`Candidate tournaments (prize_breakdown IS NULL, has fip_id, since 2024): ${rows.length}\n`)

  if (rows.length === 0) {
    console.log('Nothing to do.')
    return
  }

  let parsed = 0
  let stillMissing = 0
  let fetchFails = 0
  const planned: { id: string; name: string; level: string | null; breakdown: unknown }[] = []
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

    parsed++
    planned.push({ id: r.id, name: r.name, level: r.level, breakdown })
    if (i % 20 === 0) console.log(`  [${i + 1}/${rows.length}] parsed=${parsed} stillMissing=${stillMissing} fetchFails=${fetchFails}`)
  }

  // Report
  console.log(`\n=== Summary ===`)
  console.log(`Total candidates:    ${rows.length}`)
  console.log(`Parser hits:         ${parsed}  (will write)`)
  console.log(`Parser still null:   ${stillMissing}  (FIP page genuinely lacks breakdown — bucket B/C-no-breakdown)`)
  console.log(`Fetch failures:      ${fetchFails}  (404, network errors)`)

  // Per-level breakdown of the parser hits
  const byLevel: Record<string, number> = {}
  for (const p of planned) byLevel[p.level ?? 'unknown'] = (byLevel[p.level ?? 'unknown'] ?? 0) + 1
  console.log(`\nHits by level:`)
  for (const [lvl, n] of Object.entries(byLevel).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(4)}  ${lvl}`)
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

/**
 * Audit tournaments missing prize_breakdown to inform Phase 2 design.
 *
 * Scope: tournaments with ends_at >= 2024-01-01 AND prize_breakdown IS NULL.
 *
 * Buckets (used for triage in PR 3):
 *   B — no FIP page at all (fip_id IS NULL).
 *       Premier-only / exhibition / amateur events. The FIP enricher
 *       can never fix these; Phase 2 needs a fallback (e.g. distribute
 *       the total prize_money_eur per a tier-default ratio).
 *
 *   C — FIP page exists AND prize_money_fip is set (>100), but the
 *       enricher couldn't pull the breakdown specifically. The page is
 *       there, the scraper picked up the total, but the breakdown
 *       parser missed. Likely a layout-variant issue. Fixable in the
 *       enricher.
 *
 *   A — FIP page exists but prize_money_fip is also missing — the
 *       enricher never successfully ran on this tournament, OR the
 *       FIP page itself lacks all prize data. Either way, the right
 *       fix is to re-run the enricher on this set and see what it
 *       picks up. Anything still missing after re-run effectively
 *       collapses to bucket B.
 *
 * Read-only. No DB writes, no live HTTP fetches.
 *
 * Usage:
 *   npx tsx scripts/audit-prize-breakdown-gaps.ts
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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

type Row = {
  id: string
  name: string
  level: string | null
  fip_id: string | null
  prize_money_fip: number | null
  prize_money_eur: number | null
  ends_at: string | null
}

type Bucket = 'A' | 'B' | 'C'

function classify(r: Row): Bucket {
  if (r.fip_id == null) return 'B'                              // no FIP page
  if (r.prize_money_fip != null && r.prize_money_fip > 100) return 'C'  // scraper got total but missed breakdown
  return 'A'                                                     // enricher never succeeded
}

async function main() {
  // Only completed tournaments since 2024 — same scope as the prize-eur backfill
  const { data, error } = await supabase
    .from('tournaments')
    .select('id, name, level, fip_id, prize_money_fip, prize_money_eur, ends_at')
    .gte('ends_at', '2024-01-01')
    .lt('ends_at', new Date().toISOString())
    .is('prize_breakdown', null)
    .order('ends_at', { ascending: false })
    .limit(5000)
    .returns<Row[]>()

  if (error) throw new Error(`tournaments read: ${error.message}`)
  const rows = data ?? []

  // Counters
  const byBucket: Record<Bucket, Row[]> = { A: [], B: [], C: [] }
  for (const r of rows) byBucket[classify(r)].push(r)

  console.log(`Completed tournaments since 2024 missing prize_breakdown: ${rows.length}\n`)

  for (const b of ['A', 'B', 'C'] as const) {
    const list = byBucket[b]
    console.log(`Bucket ${b}: ${list.length} tournaments`)

    // Per-level breakdown
    const byLevel: Record<string, number> = {}
    for (const r of list) byLevel[r.level ?? 'unknown'] = (byLevel[r.level ?? 'unknown'] ?? 0) + 1
    const sorted = Object.entries(byLevel).sort((a, b) => b[1] - a[1])
    console.log(`  by level: ${sorted.map(([k, v]) => `${k}=${v}`).join(', ')}`)

    // Coverage on the prize_money_eur column (already populated by PR 2)
    const withEur = list.filter(r => r.prize_money_eur != null).length
    console.log(`  with prize_money_eur populated: ${withEur} / ${list.length}`)

    // Sample 5 for spot-checking
    console.log(`  samples:`)
    for (const r of list.slice(0, 5)) {
      const fipUrl = r.fip_id ? `https://www.padelfip.com/events/${r.fip_id}/` : '(no FIP page)'
      console.log(`    [${r.level ?? '?'.padEnd(12)}] ${r.name} (ends ${r.ends_at?.slice(0, 10) ?? '?'}) — ${fipUrl}`)
    }
    console.log()
  }

  // Roll-up: what fraction of total earnings-relevant tournaments are blocked by each bucket?
  const { count: totalCompletedSince2024 } = await supabase
    .from('tournaments')
    .select('id', { count: 'exact', head: true })
    .gte('ends_at', '2024-01-01')
    .lt('ends_at', new Date().toISOString())

  const { count: withBreakdown } = await supabase
    .from('tournaments')
    .select('id', { count: 'exact', head: true })
    .gte('ends_at', '2024-01-01')
    .lt('ends_at', new Date().toISOString())
    .not('prize_breakdown', 'is', null)

  console.log(`──────────────────────────────────────────────`)
  console.log(`Phase 2 coverage roll-up`)
  console.log(`──────────────────────────────────────────────`)
  console.log(`Completed since 2024:                  ${totalCompletedSince2024}`)
  console.log(`  has prize_breakdown:                 ${withBreakdown} (${Math.round(100 * (withBreakdown ?? 0) / (totalCompletedSince2024 ?? 1))}%)`)
  console.log(`  bucket A (re-run enricher):          ${byBucket.A.length}`)
  console.log(`  bucket B (no FIP page — needs fallback): ${byBucket.B.length}`)
  console.log(`  bucket C (scraper miss — fix parser):    ${byBucket.C.length}`)
  console.log()
  console.log(`Phase 2 design implications:`)
  console.log(`  - bucket B size dictates whether earnings can be exact (small B) or needs distribution heuristic (large B)`)
  console.log(`  - bucket C size estimates effort to get to >95% coverage by fixing the enricher`)
  console.log(`  - bucket A is pure re-run — no engineering needed`)
}

main().catch(e => { console.error(e); process.exit(1) })
